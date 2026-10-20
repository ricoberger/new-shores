// Package postgres is the PostgreSQL implementation of store.Store plus the
// queries of accounts, sessions, auth tokens and scheduled events
// (docs/ARCHITECTURE.md §4.2/§4.3). Queries are hand-written pgx/v5 calls;
// migrations are embedded SQL files applied by Migrate.
//
// World time is the database clock, truncated to milliseconds and read
// once per update after the world's row lock is held (see WorldNow), so
// all instances share one clock and every read inside one update sees the
// same instant.
package postgres

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Querier is implemented by *pgxpool.Pool, *pgxpool.Conn and pgx.Tx.
type Querier interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// Open connects a pool and pings the database.
func Open(ctx context.Context, url string) (*pgxpool.Pool, error) {
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		return nil, fmt.Errorf("DATABASE_URL: %w", err)
	}
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, err
	}
	pingCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	if err := pool.Ping(pingCtx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("ping database: %w", err)
	}
	return pool, nil
}

// InTx runs fn in a transaction that is committed when fn returns nil and
// rolled back otherwise.
func InTx(ctx context.Context, pool *pgxpool.Pool, fn func(tx pgx.Tx) error) error {
	return pgx.BeginFunc(ctx, pool, fn)
}

// DBNow returns the transaction timestamp of the database, truncated to
// milliseconds, in UTC.
func DBNow(ctx context.Context, q Querier) (time.Time, error) {
	var now time.Time
	if err := q.QueryRow(ctx, "SELECT date_trunc('milliseconds', now())").Scan(&now); err != nil {
		return time.Time{}, err
	}
	return now.UTC(), nil
}

// isUniqueViolation reports a unique-constraint violation of the named
// constraint or index.
func isUniqueViolation(err error, constraint string) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505" && pgErr.ConstraintName == constraint
}

// validUUID reports whether s is a canonical UUID string, so that malformed
// IDs are "not found" rather than SQL errors.
func validUUID(s string) bool {
	if len(s) != 36 {
		return false
	}
	for i, r := range s {
		switch i {
		case 8, 13, 18, 23:
			if r != '-' {
				return false
			}
		default:
			if !isHex(r) {
				return false
			}
		}
	}
	return true
}

func isHex(r rune) bool {
	return r >= '0' && r <= '9' || r >= 'a' && r <= 'f' || r >= 'A' && r <= 'F'
}
