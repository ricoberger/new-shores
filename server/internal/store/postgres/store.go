package postgres

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ricoberger/new-shores/server/internal/sim"
	"github.com/ricoberger/new-shores/server/internal/store"
	"github.com/ricoberger/new-shores/server/internal/telemetry"
)

// Store implements store.Store on PostgreSQL: one transaction per Update
// that locks the world row (SELECT … FOR UPDATE).
type Store struct {
	pool           *pgxpool.Pool
	contentVersion string
	logger         *slog.Logger
}

var _ store.Store = (*Store)(nil)

// New returns the store. contentVersion is the version of the loaded
// catalogue, written into every envelope.
func New(pool *pgxpool.Pool, contentVersion string, logger *slog.Logger) *Store {
	return &Store{pool: pool, contentVersion: contentVersion, logger: logger}
}

// Pool returns the connection pool.
func (s *Store) Pool() *pgxpool.Pool { return s.pool }

// ContentVersion returns the content version written into envelopes.
func (s *Store) ContentVersion() string { return s.contentVersion }

// LockedWorld is a world row locked by the current transaction.
type LockedWorld struct {
	ID      store.WorldID
	World   *sim.World
	Version int64
}

// LockWorld locks the world row (FOR UPDATE) and decodes its envelope.
// Unknown or malformed IDs are store.ErrWorldNotFound; an envelope without
// a schema migration path fails with sim.ErrSchemaVersion (logged with the
// world ID).
func (s *Store) LockWorld(ctx context.Context, tx pgx.Tx, id store.WorldID) (*LockedWorld, error) {
	if !validUUID(string(id)) {
		return nil, store.ErrWorldNotFound
	}
	var (
		state   []byte
		version int64
	)
	err := tx.QueryRow(ctx, "SELECT state, version FROM worlds WHERE id = $1 FOR UPDATE", string(id)).Scan(&state, &version)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, store.ErrWorldNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("lock world: %w", err)
	}
	w, cv, err := sim.Decode(state)
	if err != nil {
		if errors.Is(err, sim.ErrSchemaVersion) {
			s.logger.Error("world envelope has an unsupported schema version", "world_id", string(id), "error", err)
		}
		return nil, fmt.Errorf("world %s: %w", id, err)
	}
	if cv != s.contentVersion {
		telemetry.ContentVersionMismatch.Inc()
		s.logger.Debug("world content version differs from the catalogue", "world_id", string(id), "stored", cv, "loaded", s.contentVersion)
	}
	return &LockedWorld{ID: id, World: w, Version: version}, nil
}

// SaveWorld writes the locked world back and increments its version.
func (s *Store) SaveWorld(ctx context.Context, tx pgx.Tx, lw *LockedWorld) error {
	state, err := sim.Encode(lw.World, s.contentVersion)
	if err != nil {
		return fmt.Errorf("encode world: %w", err)
	}
	err = tx.QueryRow(ctx, `UPDATE worlds
SET state = $2, schema_version = $3, version = version + 1, last_evaluated_at = $4, updated_at = statement_timestamp()
WHERE id = $1
RETURNING version`, string(lw.ID), state, sim.SchemaVersion, lw.World.LastEvaluatedAt).Scan(&lw.Version)
	if err != nil {
		return fmt.Errorf("save world: %w", err)
	}
	return nil
}

// WorldNow returns the world time of an update of the world: the database
// clock (milliseconds, UTC), read once per update right after the row lock
// was acquired, capped at the earliest due_at of a pending scheduled event
// that lists the world. The world is therefore never advanced past a due
// event by the API path; only the worker applies events, at their due
// time. Call it while holding the world's row lock (events are only
// inserted under that lock).
//
// The clock is statement_timestamp() of this statement, not now(): now()
// is the transaction start, which precedes the wait for the row lock, so a
// transaction that started earlier but got the lock later would see a
// time before the previous holder's evaluation (sim.ErrTimeBackwards under
// concurrent requests). The statement runs after the lock is held, so its
// timestamp is after the previous holder's commit; it is read once and
// delivered to the callback, so every read of one update sees the same
// instant.
func WorldNow(ctx context.Context, q Querier, id store.WorldID) (time.Time, error) {
	var (
		now time.Time
		due *time.Time
	)
	err := q.QueryRow(ctx, `SELECT date_trunc('milliseconds', statement_timestamp()),
  (SELECT min(due_at) FROM scheduled_events WHERE status = 'pending' AND world_ids @> ARRAY[$1::uuid])`, string(id)).Scan(&now, &due)
	if err != nil {
		return time.Time{}, fmt.Errorf("world time: %w", err)
	}
	now = now.UTC()
	if due != nil {
		if d := due.UTC().Truncate(time.Millisecond); d.Before(now) {
			now = d
		}
	}
	return now, nil
}

// Update implements store.Store.
func (s *Store) Update(ctx context.Context, id store.WorldID, fn store.UpdateFunc) (int64, error) {
	var version int64
	err := InTx(ctx, s.pool, func(tx pgx.Tx) error {
		lw, err := s.LockWorld(ctx, tx, id)
		if err != nil {
			return err
		}
		version = lw.Version
		now, err := WorldNow(ctx, tx, id)
		if err != nil {
			return err
		}
		mutated, err := fn(lw.World, lw.Version, now)
		if err != nil {
			return err
		}
		if !mutated {
			return nil
		}
		if err := s.SaveWorld(ctx, tx, lw); err != nil {
			return err
		}
		version = lw.Version
		return nil
	})
	if err != nil && errors.Is(err, sim.ErrTimeBackwards) {
		telemetry.TimeBackwards.Inc()
	}
	return version, err
}

// Version implements store.Store.
func (s *Store) Version(ctx context.Context, id store.WorldID) (int64, error) {
	if !validUUID(string(id)) {
		return 0, store.ErrWorldNotFound
	}
	var v int64
	err := s.pool.QueryRow(ctx, "SELECT version FROM worlds WHERE id = $1", string(id)).Scan(&v)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, store.ErrWorldNotFound
	}
	return v, err
}

// CreateWorld inserts a world for the player at version 0.
func (s *Store) CreateWorld(ctx context.Context, tx pgx.Tx, playerID, region string, w *sim.World) (store.WorldID, error) {
	state, err := sim.Encode(w, s.contentVersion)
	if err != nil {
		return "", fmt.Errorf("encode world: %w", err)
	}
	var id string
	err = tx.QueryRow(ctx, `INSERT INTO worlds (player_id, region, state, schema_version, last_evaluated_at, updated_at)
VALUES ($1, $2, $3, $4, $5, now()) RETURNING id::text`, playerID, region, state, sim.SchemaVersion, w.LastEvaluatedAt).Scan(&id)
	if err != nil {
		return "", fmt.Errorf("create world: %w", err)
	}
	return store.WorldID(id), nil
}

// WorldOfPlayer returns the player's world in a region.
func WorldOfPlayer(ctx context.Context, q Querier, playerID, region string) (store.WorldID, error) {
	var id string
	err := q.QueryRow(ctx, "SELECT id::text FROM worlds WHERE player_id = $1 AND region = $2", playerID, region).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", store.ErrWorldNotFound
	}
	return store.WorldID(id), err
}
