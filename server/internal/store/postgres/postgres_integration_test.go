//go:build integration

package postgres_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ricoberger/new-shores/server/internal/content"
	"github.com/ricoberger/new-shores/server/internal/sim"
	"github.com/ricoberger/new-shores/server/internal/store"
	"github.com/ricoberger/new-shores/server/internal/store/postgres"
	"github.com/ricoberger/new-shores/server/internal/testenv"
)

func catalogue(t *testing.T) *content.Catalogue { return testenv.Catalogue(t) }

func discard() *slog.Logger { return slog.New(slog.NewTextHandler(io.Discard, nil)) }

func newWorld(t *testing.T, st *postgres.Store, age time.Duration) (string, store.WorldID) {
	return testenv.NewWorld(t, st, age)
}

func newStore(t *testing.T) (*postgres.Store, *pgxpool.Pool) {
	t.Helper()
	_, pool := testenv.Database(t)
	return postgres.New(pool, catalogue(t), discard()), pool
}

func TestMigrateTwiceIsANoOp(t *testing.T) {
	_, pool := testenv.EmptyDatabase(t)
	ctx := context.Background()
	// Concurrent first runs apply every migration exactly once.
	var wg sync.WaitGroup
	applied := make([][]string, 4)
	errs := make([]error, 4)
	for i := range 4 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			applied[i], errs[i] = postgres.Migrate(ctx, pool, discard())
		}()
	}
	wg.Wait()
	total := 0
	for i := range 4 {
		if errs[i] != nil {
			t.Fatal(errs[i])
		}
		total += len(applied[i])
	}
	if total != 1 {
		t.Fatalf("applied %d migrations in total, want 1", total)
	}
	again, err := postgres.Migrate(ctx, pool, discard())
	if err != nil || len(again) != 0 {
		t.Fatalf("second run applied %v, %v", again, err)
	}
	if err := postgres.CheckMigrations(ctx, pool); err != nil {
		t.Fatal(err)
	}
	for _, table := range []string{"players", "worlds", "scheduled_events", "sessions", "auth_tokens", "schema_migrations"} {
		var ok bool
		if err := pool.QueryRow(ctx, "SELECT to_regclass($1) IS NOT NULL", table).Scan(&ok); err != nil || !ok {
			t.Errorf("table %s missing (%v)", table, err)
		}
	}
}

func TestCheckMigrationsFailsOnEmptyDatabase(t *testing.T) {
	_, pool := testenv.EmptyDatabase(t)
	if err := postgres.CheckMigrations(context.Background(), pool); err == nil {
		t.Fatal("CheckMigrations succeeded on an empty database")
	}
}

func TestEnvelopeRoundTripThroughJSONB(t *testing.T) {
	st, pool := newStore(t)
	_, id := newWorld(t, st, time.Hour)
	ctx := context.Background()
	var before []byte
	// Build some state: a sawmill and an advance of one hour.
	_, err := st.Update(ctx, id, func(w *sim.World, _ int64, now time.Time) (bool, error) {
		if _, err := sim.Advance(w, catalogue(t), now); err != nil {
			return false, err
		}
		if err := sim.Apply(w, catalogue(t), sim.PlaceBuilding{IslandID: "start", Type: "sawmill", X: 10, Y: 5, Rotation: 180}); err != nil {
			return false, err
		}
		var err error
		before, err = sim.Encode(w, catalogue(t).Region.Version)
		return true, err
	})
	if err != nil {
		t.Fatal(err)
	}
	var state []byte
	var schemaVersion int
	var lastEval time.Time
	if err := pool.QueryRow(ctx, "SELECT state, schema_version, last_evaluated_at FROM worlds WHERE id = $1", string(id)).Scan(&state, &schemaVersion, &lastEval); err != nil {
		t.Fatal(err)
	}
	w, cv, _, err := sim.Decode(state, catalogue(t))
	if err != nil {
		t.Fatal(err)
	}
	after, err := sim.Encode(w, cv)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(before, after) {
		t.Fatalf("envelope changed through JSONB:\n%s\n%s", before, after)
	}
	if schemaVersion != sim.SchemaVersion || !lastEval.Equal(w.LastEvaluatedAt) {
		t.Fatalf("schema_version %d, last_evaluated_at %s vs %s", schemaVersion, lastEval, w.LastEvaluatedAt)
	}
}

func TestRowLockSerialisesUpdates(t *testing.T) {
	st, _ := newStore(t)
	_, id := newWorld(t, st, 0)
	ctx := context.Background()
	const n = 25
	var wg sync.WaitGroup
	errs := make(chan error, n)
	for range n {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := st.Update(ctx, id, func(w *sim.World, _ int64, _ time.Time) (bool, error) {
				w.NextBuildingID++ // a counter no rule touches
				return true, nil
			})
			errs <- err
		}()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}
	v, err := st.Version(ctx, id)
	if err != nil || v != n {
		t.Fatalf("version %d, %v; want %d", v, err, n)
	}
	_, _ = st.Update(ctx, id, func(w *sim.World, version int64, _ time.Time) (bool, error) {
		if w.NextBuildingID != 2+n { // the dev world placed its warehouse (ID 1)
			t.Errorf("counter %d, want %d (lost update)", w.NextBuildingID, 2+n)
		}
		return false, nil
	})
}

func TestVersionMonotonicAndReadOnlyUpdates(t *testing.T) {
	st, _ := newStore(t)
	_, id := newWorld(t, st, 0)
	ctx := context.Background()
	last := int64(0)
	for i := range 6 {
		mutate := i%2 == 0
		v, err := st.Update(ctx, id, func(*sim.World, int64, time.Time) (bool, error) { return mutate, nil })
		if err != nil {
			t.Fatal(err)
		}
		if (mutate && v != last+1) || (!mutate && v != last) {
			t.Fatalf("step %d: version %d after %d", i, v, last)
		}
		last = v
	}
	boom := errors.New("boom")
	v, err := st.Update(ctx, id, func(w *sim.World, _ int64, _ time.Time) (bool, error) {
		w.Gold = 1
		return true, boom
	})
	if !errors.Is(err, boom) || v != last {
		t.Fatalf("failing fn: %d, %v", v, err)
	}
	_, _ = st.Update(ctx, id, func(w *sim.World, _ int64, _ time.Time) (bool, error) {
		if w.Gold == 1 {
			t.Error("failed update was committed")
		}
		return false, nil
	})
}

func TestUnknownWorld(t *testing.T) {
	st, _ := newStore(t)
	ctx := context.Background()
	for _, id := range []store.WorldID{"00000000-0000-0000-0000-000000000000", "not-a-uuid", ""} {
		if _, err := st.Update(ctx, id, func(*sim.World, int64, time.Time) (bool, error) { return true, nil }); !errors.Is(err, store.ErrWorldNotFound) {
			t.Errorf("Update(%q): %v", id, err)
		}
		if _, err := st.Version(ctx, id); !errors.Is(err, store.ErrWorldNotFound) {
			t.Errorf("Version(%q): %v", id, err)
		}
	}
}

// TestSchemaVersionMismatchFailsLoudly: a stored envelope with another
// schema version and no registered migration fails with ErrSchemaVersion
// and the row is left untouched (never reset).
func TestSchemaVersionMismatchFailsLoudly(t *testing.T) {
	st, pool := newStore(t)
	_, id := newWorld(t, st, 0)
	ctx := context.Background()
	for _, v := range []int{0, sim.SchemaVersion + 1} {
		if _, err := pool.Exec(ctx, "UPDATE worlds SET state = jsonb_set(state, '{schema_version}', to_jsonb($2::int)) WHERE id = $1", string(id), v); err != nil {
			t.Fatal(err)
		}
		var before []byte
		_ = pool.QueryRow(ctx, "SELECT state::text FROM worlds WHERE id = $1", string(id)).Scan(&before)
		_, err := st.Update(ctx, id, func(*sim.World, int64, time.Time) (bool, error) { return true, nil })
		if !errors.Is(err, sim.ErrSchemaVersion) {
			t.Fatalf("schema %d: err = %v, want ErrSchemaVersion", v, err)
		}
		var after []byte
		_ = pool.QueryRow(ctx, "SELECT state::text FROM worlds WHERE id = $1", string(id)).Scan(&after)
		if !bytes.Equal(before, after) {
			t.Fatalf("schema %d: row changed", v)
		}
	}
}

// TestPendingEventCapsWorldTime: the time delivered to Update is capped at
// the earliest pending event of the world; failed and done events and
// other worlds' events do not cap.
func TestPendingEventCapsWorldTime(t *testing.T) {
	st, pool := newStore(t)
	_, id := newWorld(t, st, 2*time.Hour)
	_, other := newWorld(t, st, 2*time.Hour)
	ctx := context.Background()
	var created time.Time
	_, _ = st.Update(ctx, id, func(w *sim.World, _ int64, _ time.Time) (bool, error) {
		created = w.LastEvaluatedAt
		return false, nil
	})
	due := created.Add(time.Hour)
	insert := func(world store.WorldID, at time.Time) int64 {
		var evID int64
		err := postgres.InTx(ctx, pool, func(tx pgx.Tx) error {
			if _, err := st.LockWorld(ctx, tx, world); err != nil {
				return err
			}
			var err error
			evID, err = postgres.InsertEvent(ctx, tx, postgres.NewEvent{DueAt: at, Kind: "advance_to", WorldIDs: []store.WorldID{world}, Payload: json.RawMessage(`{}`)})
			return err
		})
		if err != nil {
			t.Fatal(err)
		}
		return evID
	}
	evID := insert(id, due)
	insert(other, created.Add(time.Minute))
	nowOf := func() time.Time {
		var got time.Time
		if _, err := st.Update(ctx, id, func(_ *sim.World, _ int64, now time.Time) (bool, error) {
			got = now
			return false, nil
		}); err != nil {
			t.Fatal(err)
		}
		return got
	}
	if got := nowOf(); !got.Equal(due) {
		t.Fatalf("capped now = %s, want due %s", got, due)
	}
	if _, err := pool.Exec(ctx, "UPDATE scheduled_events SET status = 'failed' WHERE id = $1", evID); err != nil {
		t.Fatal(err)
	}
	if got := nowOf(); !got.After(due.Add(59 * time.Minute)) {
		t.Fatalf("now = %s after the event failed, want the database clock", got)
	}
	var next time.Time
	_ = pool.QueryRow(ctx, "SELECT next_attempt_at FROM scheduled_events WHERE id = $1", evID).Scan(&next)
	if !next.Equal(due) {
		t.Fatalf("next_attempt_at %s, want the default due_at %s", next, due)
	}
}

// TestConcurrentAdvancesNeverGoBackwards: concurrent updates that advance
// the world to the delivered time never see a time before the previous
// holder's evaluation (the clock is read after the row lock is held).
func TestConcurrentAdvancesNeverGoBackwards(t *testing.T) {
	st, _ := newStore(t)
	_, id := newWorld(t, st, 0)
	ctx := context.Background()
	const n = 40
	var wg sync.WaitGroup
	errs := make(chan error, n)
	for range n {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := st.Update(ctx, id, func(w *sim.World, _ int64, now time.Time) (bool, error) {
				if _, err := sim.Advance(w, catalogue(t), now); err != nil {
					return false, err
				}
				return true, nil
			})
			errs <- err
		}()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatalf("concurrent advance: %v", err)
		}
	}
}
