//go:build integration && testevents

package events_test

import (
	"bytes"
	"context"
	"errors"
	"io"
	"log/slog"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/prometheus/client_golang/prometheus/testutil"

	"github.com/ricoberger/new-shores/server/internal/devworld"
	"github.com/ricoberger/new-shores/server/internal/events"
	"github.com/ricoberger/new-shores/server/internal/sim"
	"github.com/ricoberger/new-shores/server/internal/store"
	"github.com/ricoberger/new-shores/server/internal/store/postgres"
	"github.com/ricoberger/new-shores/server/internal/telemetry"
	"github.com/ricoberger/new-shores/server/internal/testenv"
)

type recorder struct {
	mu  sync.Mutex
	ids []store.WorldID
}

func (r *recorder) Publish(_ context.Context, id store.WorldID) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.ids = append(r.ids, id)
}

func (r *recorder) count() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return len(r.ids)
}

func setup(t *testing.T) *postgres.Store {
	t.Helper()
	_, pool := testenv.Database(t)
	return postgres.New(pool, testenv.Catalogue(t), slog.New(slog.NewTextHandler(io.Discard, nil)))
}

func worker(t *testing.T, st *postgres.Store, freshness time.Duration, pub events.Publisher, logs io.Writer) *events.Worker {
	t.Helper()
	if logs == nil {
		logs = io.Discard
	}
	return &events.Worker{
		Store: st, Registry: events.DefaultRegistry(freshness), Catalogue: testenv.Catalogue(t),
		Publisher: pub, Logger: slog.New(slog.NewTextHandler(logs, nil)), PollInterval: 50 * time.Millisecond,
	}
}

func createdAt(t *testing.T, st *postgres.Store, id store.WorldID) time.Time {
	t.Helper()
	var at time.Time
	if _, err := st.Update(context.Background(), id, func(w *sim.World, _ int64, _ time.Time) (bool, error) {
		at = w.LastEvaluatedAt
		return false, nil
	}); err != nil {
		t.Fatal(err)
	}
	return at
}

func credit(world store.WorldID, good string, milli int64) events.TestCredit {
	return events.TestCredit{WorldID: world, IslandID: "start", Good: good, AmountMilli: milli}
}

// stock returns the stock of a good after advancing to the delivered time.
func stock(t *testing.T, st *postgres.Store, id store.WorldID, good string) int64 {
	t.Helper()
	var s int64
	_, err := st.Update(context.Background(), id, func(w *sim.World, _ int64, now time.Time) (bool, error) {
		if _, err := sim.Advance(w, testenv.Catalogue(t), now); err != nil {
			return false, err
		}
		ds, err := sim.Display(w, testenv.Catalogue(t), now)
		if err != nil {
			return false, err
		}
		s = ds.Islands[0].Inventory[good].Stock
		return false, nil
	})
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func statusCounts(t *testing.T, st *postgres.Store) map[string]int {
	t.Helper()
	rows, err := st.Pool().Query(context.Background(), "SELECT status, count(*) FROM scheduled_events GROUP BY status")
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	out := map[string]int{}
	for rows.Next() {
		var s string
		var n int
		if err := rows.Scan(&s, &n); err != nil {
			t.Fatal(err)
		}
		out[s] = n
	}
	return out
}

// drain runs n workers until no event is pending (or the timeout).
func drain(t *testing.T, st *postgres.Store, workers []*events.Worker, timeout time.Duration, during func(ctx context.Context)) {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	var wg sync.WaitGroup
	for _, w := range workers {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_ = w.Run(ctx)
		}()
	}
	if during != nil {
		wg.Add(1)
		go func() {
			defer wg.Done()
			during(ctx)
		}()
	}
	deadline := time.Now().Add(timeout)
	for statusCounts(t, st)["pending"] > 0 {
		if time.Now().After(deadline) {
			cancel()
			wg.Wait()
			t.Fatalf("events still pending after %s: %v", timeout, statusCounts(t, st))
		}
		time.Sleep(50 * time.Millisecond)
	}
	cancel()
	wg.Wait()
}

// TestExactlyOnceWithTwoWorkers: 240 test_credit events over 20 worlds are
// drained by two concurrent workers; every credit is applied exactly once.
func TestExactlyOnceWithTwoWorkers(t *testing.T) {
	st := setup(t)
	const worlds, perWorld = 20, 12
	ids := make([]store.WorldID, worlds)
	for i := range ids {
		_, ids[i] = testenv.NewWorld(t, st, time.Hour)
	}
	base := createdAt(t, st, ids[0]).Add(time.Minute)
	for i := range worlds * perWorld {
		id := ids[i%worlds]
		testenv.InsertEvent(t, st, base.Add(time.Duration(i)*time.Second), events.KindTestCredit, []store.WorldID{id},
			events.TestCreditPayload{Credits: []events.TestCredit{credit(id, "wood", 1000)}})
	}
	pub := &recorder{}
	drain(t, st, []*events.Worker{worker(t, st, time.Hour, pub, nil), worker(t, st, time.Hour, pub, nil)}, time.Minute, nil)
	if c := statusCounts(t, st); c["done"] != worlds*perWorld || c["failed"] != 0 {
		t.Fatalf("statuses %v", c)
	}
	for _, id := range ids {
		if got := stock(t, st, id, "wood"); got != perWorld*1000 {
			t.Errorf("world %s: wood %d milli, want %d (duplicate or lost processing)", id, got, perWorld*1000)
		}
	}
	if pub.count() != worlds*perWorld {
		t.Errorf("published %d changes, want %d", pub.count(), worlds*perWorld)
	}
	var attempts int
	_ = st.Pool().QueryRow(context.Background(), "SELECT coalesce(sum(attempts), 0) FROM scheduled_events").Scan(&attempts)
	if attempts != 0 {
		t.Errorf("%d failed attempts", attempts)
	}
}

// TestEventAppliesAtDueAt: an event processed late yields the same state
// as a headless Advance(due_at) + credit + Advance(now).
func TestEventAppliesAtDueAt(t *testing.T) {
	st := setup(t)
	cat := testenv.Catalogue(t)
	_, id := testenv.NewWorld(t, st, 2*time.Hour)
	created := createdAt(t, st, id)
	due := created.Add(30*time.Minute + 123*time.Millisecond)
	testenv.InsertEvent(t, st, due, events.KindTestCredit, []store.WorldID{id},
		events.TestCreditPayload{Credits: []events.TestCredit{credit(id, "planks", 5000)}})
	n, err := worker(t, st, time.Hour, nil, nil).RunOnce(context.Background())
	if err != nil || n != 1 {
		t.Fatalf("RunOnce = %d, %v", n, err)
	}
	var (
		got []byte
		now time.Time
	)
	_, err = st.Update(context.Background(), id, func(w *sim.World, _ int64, at time.Time) (bool, error) {
		if !w.LastEvaluatedAt.Equal(due) {
			t.Errorf("stored world evaluated at %s, want due_at %s", w.LastEvaluatedAt, due)
		}
		now = at
		if _, err := sim.Advance(w, cat, at); err != nil {
			return false, err
		}
		var err error
		got, err = sim.Encode(w, cat.Region.Version)
		return false, err
	})
	if err != nil {
		t.Fatal(err)
	}
	w, err := devworld.NewFixture(cat, devworld.FixtureDefault, created)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := sim.Advance(w, cat, due); err != nil {
		t.Fatal(err)
	}
	if err := sim.AddStock(w, cat, "start", "planks", 5000, nil); err != nil {
		t.Fatal(err)
	}
	if _, err := sim.Advance(w, cat, now); err != nil {
		t.Fatal(err)
	}
	want, _ := sim.Encode(w, cat.Region.Version)
	if !bytes.Equal(got, want) {
		t.Fatalf("late event differs from Advance(due)+credit+Advance(now):\n%s\n%s", got, want)
	}
}

// TestTwoWorldEventsDoNotDeadlock: test_credit events on [B, A] run
// concurrently with commands on A and B without deadlocks.
func TestTwoWorldEventsDoNotDeadlock(t *testing.T) {
	st := setup(t)
	_, a := testenv.NewWorld(t, st, time.Hour)
	_, b := testenv.NewWorld(t, st, time.Hour)
	base := createdAt(t, st, a).Add(time.Minute)
	const n = 40
	for i := range n {
		testenv.InsertEvent(t, st, base.Add(time.Duration(i)*time.Second), events.KindTestCredit, []store.WorldID{b, a},
			events.TestCreditPayload{Credits: []events.TestCredit{credit(b, "wood", 1000), credit(a, "wood", 2000)}})
	}
	var cmdErrs []error
	var mu sync.Mutex
	commands := func(ctx context.Context) {
		var wg sync.WaitGroup
		for _, id := range []store.WorldID{a, b, a, b} {
			wg.Add(1)
			go func() {
				defer wg.Done()
				for i := 0; i < 30 && ctx.Err() == nil; i++ {
					_, err := st.Update(ctx, id, func(w *sim.World, _ int64, now time.Time) (bool, error) {
						if _, err := sim.Advance(w, testenv.Catalogue(t), now); err != nil {
							return false, err
						}
						w.NextBuildingID++
						return true, nil
					})
					if err != nil && ctx.Err() == nil {
						mu.Lock()
						cmdErrs = append(cmdErrs, err)
						mu.Unlock()
					}
				}
			}()
		}
		wg.Wait()
	}
	var logs testenv.SyncBuffer
	drain(t, st, []*events.Worker{worker(t, st, time.Hour, nil, &logs), worker(t, st, time.Hour, nil, &logs)}, time.Minute, commands)
	for _, err := range cmdErrs {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "40P01" {
			t.Fatalf("deadlock: %v", err)
		}
		t.Fatalf("command failed: %v", err)
	}
	if c := statusCounts(t, st); c["done"] != n {
		t.Fatalf("statuses %v\n%s", c, logs.String())
	}
	if strings.Contains(logs.String(), "deadlock") {
		t.Fatalf("deadlock in worker logs:\n%s", logs.String())
	}
	if got := stock(t, st, a, "wood"); got != n*2000 {
		t.Errorf("A wood %d", got)
	}
	if got := stock(t, st, b, "wood"); got != n*1000 {
		t.Errorf("B wood %d", got)
	}
}

// TestBackoffThenFailed: an unregistered kind fails every attempt; attempts
// grow, next_attempt_at backs off 2^attempts s, due_at never changes and
// the fifth failure marks the event failed.
func TestBackoffThenFailed(t *testing.T) {
	st := setup(t)
	_, id := testenv.NewWorld(t, st, time.Hour)
	due := createdAt(t, st, id).Add(time.Minute)
	evID := testenv.InsertEvent(t, st, due, "no_such_kind", []store.WorldID{id}, map[string]any{})
	w := worker(t, st, time.Hour, nil, nil)
	ctx := context.Background()
	for attempt := 1; attempt <= events.MaxAttempts; attempt++ {
		if _, err := w.RunOnce(ctx); err != nil {
			t.Fatal(err)
		}
		var (
			attempts     int
			status, last string
			gotDue, next time.Time
			updated      time.Time
		)
		err := st.Pool().QueryRow(ctx, `SELECT attempts, status, last_error, due_at, next_attempt_at, updated_at
FROM scheduled_events WHERE id = $1`, evID).Scan(&attempts, &status, &last, &gotDue, &next, &updated)
		if err != nil {
			t.Fatal(err)
		}
		if attempts != attempt || !gotDue.Equal(due) || !strings.Contains(last, "unregistered event kind") {
			t.Fatalf("attempt %d: attempts %d due %s error %q", attempt, attempts, gotDue, last)
		}
		if wantDelay := time.Duration(1<<attempt) * time.Second; next.Sub(updated) != wantDelay {
			t.Fatalf("attempt %d: backoff %s, want %s", attempt, next.Sub(updated), wantDelay)
		}
		wantStatus := "pending"
		if attempt == events.MaxAttempts {
			wantStatus = "failed"
		}
		if status != wantStatus {
			t.Fatalf("attempt %d: status %s, want %s", attempt, status, wantStatus)
		}
		// Make the next attempt due now instead of waiting.
		if _, err := st.Pool().Exec(ctx, "UPDATE scheduled_events SET next_attempt_at = now() WHERE id = $1", evID); err != nil {
			t.Fatal(err)
		}
	}
	if n, _ := w.RunOnce(ctx); n != 0 {
		t.Fatalf("a failed event was claimed again")
	}
}

// TestAdvanceToChains: every processed advance_to schedules the next one a
// freshness interval after its due_at; exactly one is pending per world.
func TestAdvanceToChains(t *testing.T) {
	st := setup(t)
	_, id := testenv.NewWorld(t, st, 150*time.Minute)
	created := createdAt(t, st, id)
	testenv.InsertEvent(t, st, created.Add(time.Hour), events.KindAdvanceTo, []store.WorldID{id}, map[string]any{})
	pub := &recorder{}
	w := worker(t, st, time.Hour, pub, nil)
	for range 4 {
		if _, err := w.RunOnce(context.Background()); err != nil {
			t.Fatal(err)
		}
	}
	rows, err := st.Pool().Query(context.Background(), "SELECT due_at, status FROM scheduled_events WHERE kind = 'advance_to' ORDER BY due_at")
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var got []string
	for rows.Next() {
		var due time.Time
		var status string
		_ = rows.Scan(&due, &status)
		got = append(got, due.Sub(created).String()+" "+status)
	}
	want := []string{"1h0m0s done", "2h0m0s done", "3h0m0s pending"}
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Fatalf("advance_to chain %v, want %v", got, want)
	}
	if pub.count() != 2 {
		t.Fatalf("published %d", pub.count())
	}
	var version int64
	_ = st.Pool().QueryRow(context.Background(), "SELECT version FROM worlds WHERE id = $1", string(id)).Scan(&version)
	if version != 2 {
		t.Fatalf("version %d after two events, want 2", version)
	}
}

// TestWorldPastDueFails: a world already evaluated past the event's due_at
// is a bug; the event fails with an explicit error.
func TestWorldPastDueFails(t *testing.T) {
	st := setup(t)
	_, id := testenv.NewWorld(t, st, 0)
	evID := testenv.InsertEvent(t, st, createdAt(t, st, id).Add(-time.Minute), events.KindAdvanceTo, []store.WorldID{id}, map[string]any{})
	if _, err := worker(t, st, time.Hour, nil, nil).RunOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	var last string
	_ = st.Pool().QueryRow(context.Background(), "SELECT last_error FROM scheduled_events WHERE id = $1", evID).Scan(&last)
	if !strings.Contains(last, "past the event's due_at") {
		t.Fatalf("last_error %q", last)
	}
}

// TestPendingGaugeWhileDraining: events_pending is sampled during a long
// drain, not only when the worker becomes idle.
func TestPendingGaugeWhileDraining(t *testing.T) {
	st := setup(t)
	ids := make([]store.WorldID, 10)
	for i := range ids {
		_, ids[i] = testenv.NewWorld(t, st, time.Hour)
	}
	base := createdAt(t, st, ids[0]).Add(time.Minute)
	const total = 300
	for i := range total {
		id := ids[i%len(ids)]
		testenv.InsertEvent(t, st, base.Add(time.Duration(i)*time.Millisecond), events.KindTestCredit, []store.WorldID{id},
			events.TestCreditPayload{Credits: []events.TestCredit{credit(id, "wood", 1000)}})
	}
	telemetry.EventsPending.Set(0)
	w := worker(t, st, time.Hour, nil, nil)
	w.PollInterval = 20 * time.Millisecond
	w.BatchSize = 5
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		defer close(done)
		_ = w.Run(ctx)
	}()
	observed := 0.0
	for statusCounts(t, st)["pending"] > total/3 {
		observed = max(observed, testutil.ToFloat64(telemetry.EventsPending))
		time.Sleep(5 * time.Millisecond)
	}
	cancel()
	<-done
	if observed <= 0 {
		t.Fatal("events_pending stayed 0 while the worker drained a backlog")
	}
}

// TestProcessingTimeReadAfterWorldLocks: the processing time of an event
// (lag metric, updated_at) is read after the world locks are held, so a
// wait for a world lock is part of it (now() would be the earlier
// transaction start).
func TestProcessingTimeReadAfterWorldLocks(t *testing.T) {
	st := setup(t)
	_, id := testenv.NewWorld(t, st, time.Hour)
	evID := testenv.InsertEvent(t, st, createdAt(t, st, id).Add(time.Minute), events.KindAdvanceTo, []store.WorldID{id}, map[string]any{})
	ctx := context.Background()
	holder, err := st.Pool().Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := st.LockWorld(ctx, holder, id); err != nil {
		t.Fatal(err)
	}
	done := make(chan struct{})
	go func() {
		defer close(done)
		_, _ = worker(t, st, time.Hour, nil, nil).RunOnce(ctx)
	}()
	// Wait until the worker is observably blocked on the world lock (not a
	// fixed sleep: a late-scheduled worker must not pass by luck).
	deadline := time.Now().Add(10 * time.Second)
	for {
		var waiting int
		if err := st.Pool().QueryRow(ctx, `SELECT count(*) FROM pg_stat_activity
WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%FROM worlds WHERE id = $1 FOR UPDATE%'`).Scan(&waiting); err != nil {
			t.Fatal(err)
		}
		if waiting > 0 {
			break
		}
		if time.Now().After(deadline) {
			_ = holder.Rollback(ctx)
			<-done
			t.Fatal("the worker never waited for the world lock")
		}
		time.Sleep(10 * time.Millisecond)
	}
	time.Sleep(200 * time.Millisecond) // make the lock wait measurable
	var released time.Time
	if err := holder.QueryRow(ctx, "SELECT clock_timestamp()").Scan(&released); err != nil {
		t.Fatal(err)
	}
	if err := holder.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	<-done
	var status string
	var updated time.Time
	if err := st.Pool().QueryRow(ctx, "SELECT status, updated_at FROM scheduled_events WHERE id = $1", evID).Scan(&status, &updated); err != nil {
		t.Fatal(err)
	}
	if status != "done" || updated.Before(released.Truncate(time.Millisecond)) {
		t.Fatalf("status %s, processing time %s before the world lock was released at %s", status, updated, released)
	}
}
