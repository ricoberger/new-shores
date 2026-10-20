package postgres

import (
	"context"
	"embed"
	"fmt"
	"io/fs"
	"log/slog"
	"slices"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

//go:embed migrations/*.sql
var migrationFiles embed.FS

// migrationLockID is the key of the advisory lock that serialises
// concurrent migration runs (several instances starting at once).
const migrationLockID int64 = 0x6e735f6d6967

// migration is one embedded SQL file "NNNN_name.sql".
type migration struct {
	version int
	name    string
	sql     string
}

func migrations() ([]migration, error) {
	entries, err := fs.ReadDir(migrationFiles, "migrations")
	if err != nil {
		return nil, err
	}
	var out []migration
	for _, e := range entries {
		name := e.Name()
		prefix, _, ok := strings.Cut(name, "_")
		if !ok || !strings.HasSuffix(name, ".sql") {
			return nil, fmt.Errorf("migration %q: want NNNN_name.sql", name)
		}
		v, err := strconv.Atoi(prefix)
		if err != nil || v <= 0 {
			return nil, fmt.Errorf("migration %q: bad version", name)
		}
		body, err := migrationFiles.ReadFile("migrations/" + name)
		if err != nil {
			return nil, err
		}
		out = append(out, migration{version: v, name: name, sql: string(body)})
	}
	slices.SortFunc(out, func(a, b migration) int { return a.version - b.version })
	for i := 1; i < len(out); i++ {
		if out[i].version == out[i-1].version {
			return nil, fmt.Errorf("duplicate migration version %d", out[i].version)
		}
	}
	return out, nil
}

// Migrate applies the embedded migrations that are not applied yet, in
// version order, each in its own transaction, and returns the names of the
// applied files. Concurrent runs are serialised by an advisory lock, so
// every migration is applied exactly once.
func Migrate(ctx context.Context, pool *pgxpool.Pool, logger *slog.Logger) ([]string, error) {
	all, err := migrations()
	if err != nil {
		return nil, err
	}
	conn, err := pool.Acquire(ctx)
	if err != nil {
		return nil, err
	}
	defer conn.Release()
	if _, err := conn.Exec(ctx, "SELECT pg_advisory_lock($1)", migrationLockID); err != nil {
		return nil, fmt.Errorf("migration lock: %w", err)
	}
	defer func() {
		// Unlock on a fresh context: ctx may be cancelled already.
		_, _ = conn.Exec(context.WithoutCancel(ctx), "SELECT pg_advisory_unlock($1)", migrationLockID)
	}()
	if _, err := conn.Exec(ctx, `CREATE TABLE IF NOT EXISTS schema_migrations (
  version    int PRIMARY KEY,
  name       text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
)`); err != nil {
		return nil, fmt.Errorf("schema_migrations: %w", err)
	}
	done, err := appliedVersions(ctx, conn)
	if err != nil {
		return nil, err
	}
	var applied []string
	for _, m := range all {
		if done[m.version] {
			continue
		}
		err := pgx.BeginFunc(ctx, conn, func(tx pgx.Tx) error {
			if _, err := tx.Exec(ctx, m.sql); err != nil {
				return err
			}
			_, err := tx.Exec(ctx, "INSERT INTO schema_migrations (version, name) VALUES ($1, $2)", m.version, m.name)
			return err
		})
		if err != nil {
			return applied, fmt.Errorf("migration %s: %w", m.name, err)
		}
		logger.Info("migration applied", "migration", m.name)
		applied = append(applied, m.name)
	}
	return applied, nil
}

// CheckMigrations fails when an embedded migration is not applied yet
// (the server refuses to start against an outdated schema).
func CheckMigrations(ctx context.Context, pool *pgxpool.Pool) error {
	all, err := migrations()
	if err != nil {
		return err
	}
	conn, err := pool.Acquire(ctx)
	if err != nil {
		return err
	}
	defer conn.Release()
	done, err := appliedVersions(ctx, conn)
	if err != nil {
		return fmt.Errorf("database schema not migrated (run `server migrate` or set MIGRATE_ON_START=true): %w", err)
	}
	for _, m := range all {
		if !done[m.version] {
			return fmt.Errorf("migration %s is not applied (run `server migrate` or set MIGRATE_ON_START=true)", m.name)
		}
	}
	return nil
}

func appliedVersions(ctx context.Context, conn *pgxpool.Conn) (map[int]bool, error) {
	rows, err := conn.Query(ctx, "SELECT version FROM schema_migrations")
	if err != nil {
		return nil, err
	}
	versions, err := pgx.CollectRows(rows, pgx.RowTo[int])
	if err != nil {
		return nil, err
	}
	done := map[int]bool{}
	for _, v := range versions {
		done[v] = true
	}
	return done, nil
}
