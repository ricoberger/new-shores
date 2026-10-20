package postgres

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/ricoberger/new-shores/server/internal/sim"
	"github.com/ricoberger/new-shores/server/internal/store"
)

// NewEvent is a scheduled event to insert.
type NewEvent struct {
	DueAt    time.Time
	Kind     string
	WorldIDs []store.WorldID
	Payload  json.RawMessage
}

// InsertEvent inserts a pending scheduled event. The caller must hold the
// row lock of every world in WorldIDs in tx: the pending-event cap of
// world updates (WorldNow) is race-free only under this rule. Inserting
// wakes the workers (trigger + NOTIFY on commit).
func InsertEvent(ctx context.Context, tx pgx.Tx, e NewEvent) (int64, error) {
	if len(e.WorldIDs) == 0 {
		return 0, fmt.Errorf("event %s: no worlds", e.Kind)
	}
	ids := make([]string, len(e.WorldIDs))
	for i, id := range e.WorldIDs {
		if !validUUID(string(id)) {
			return 0, fmt.Errorf("event %s: bad world ID %q", e.Kind, id)
		}
		ids[i] = string(id)
	}
	payload := e.Payload
	if len(payload) == 0 {
		payload = json.RawMessage(`{}`)
	}
	var id int64
	err := tx.QueryRow(ctx, `INSERT INTO scheduled_events (due_at, kind, world_ids, payload, next_attempt_at)
VALUES ($1, $2, $3::text[]::uuid[], $4, $1) RETURNING id`,
		e.DueAt.UTC().Truncate(time.Millisecond), e.Kind, ids, []byte(payload)).Scan(&id)
	if err != nil {
		return 0, fmt.Errorf("insert event %s: %w", e.Kind, err)
	}
	return id, nil
}

// PendingDueKeys returns the identities (store.DueKey) of the pending
// due-moment events (ship_built, ship_arrived) of a world, except the
// event exclude (0 = none). Call it while holding the world's row lock.
func PendingDueKeys(ctx context.Context, q Querier, id store.WorldID, exclude int64) (map[string]bool, error) {
	rows, err := q.Query(ctx, `SELECT kind, payload, due_at FROM scheduled_events
WHERE status = 'pending' AND world_ids @> ARRAY[$1::uuid] AND kind = ANY($2) AND id <> $3`,
		string(id), []string{sim.DueShipBuilt, sim.DueShipArrived}, exclude)
	if err != nil {
		return nil, fmt.Errorf("pending due events: %w", err)
	}
	defer rows.Close()
	keys := map[string]bool{}
	for rows.Next() {
		var (
			kind    string
			payload []byte
			due     time.Time
		)
		if err := rows.Scan(&kind, &payload, &due); err != nil {
			return nil, fmt.Errorf("pending due events: %w", err)
		}
		if k, ok := store.DueKey(kind, payload, due); ok {
			keys[k] = true
		}
	}
	return keys, rows.Err()
}

// ReconcileDueEvents inserts a pending event for every due moment of the
// world (sim.DueEvents) that has none, inside tx (R-49): after it, every
// due moment has exactly one pending event with its kind, payload identity
// and due time. Existing pending events are never duplicated; stale ones
// (a scrapped ship, a cancelled order) are left to their no-op handler.
// The caller holds the world's row lock (InsertEvent contract). exclude is
// an event being processed in tx (it is about to be marked done).
func ReconcileDueEvents(ctx context.Context, tx pgx.Tx, id store.WorldID, w *sim.World, exclude int64) (int, error) {
	if len(sim.DueEvents(w)) == 0 {
		return 0, nil
	}
	keys, err := PendingDueKeys(ctx, tx, id, exclude)
	if err != nil {
		return 0, err
	}
	missing := store.MissingDueEvents(w, keys)
	for _, ev := range missing {
		if _, err := InsertEvent(ctx, tx, NewEvent{DueAt: ev.At, Kind: ev.Kind, WorldIDs: []store.WorldID{id}, Payload: store.DuePayload(ev)}); err != nil {
			return 0, err
		}
	}
	return len(missing), nil
}
