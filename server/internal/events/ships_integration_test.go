//go:build integration && testevents

package events_test

import (
	"bytes"
	"context"
	"log/slog"
	"strings"
	"testing"
	"time"

	"github.com/ricoberger/new-shores/server/internal/devworld"
	"github.com/ricoberger/new-shores/server/internal/events"
	"github.com/ricoberger/new-shores/server/internal/sim"
	"github.com/ricoberger/new-shores/server/internal/store"
	"github.com/ricoberger/new-shores/server/internal/store/postgres"
	"github.com/ricoberger/new-shores/server/internal/testenv"
)

// pendingEvent is a pending scheduled event row.
type pendingEvent struct {
	kind    string
	due     time.Time
	payload string
}

func pendingEvents(t *testing.T, st *postgres.Store, id store.WorldID) []pendingEvent {
	t.Helper()
	rows, err := st.Pool().Query(context.Background(), `SELECT kind, due_at, payload::text FROM scheduled_events
WHERE status = 'pending' AND world_ids @> ARRAY[$1::uuid] ORDER BY due_at, id`, string(id))
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var out []pendingEvent
	for rows.Next() {
		var e pendingEvent
		if err := rows.Scan(&e.kind, &e.due, &e.payload); err != nil {
			t.Fatal(err)
		}
		e.due = e.due.UTC()
		out = append(out, e)
	}
	return out
}

// checkReconciled asserts that the pending ship events of the stored world
// are exactly its due moments.
func checkReconciled(t *testing.T, st *postgres.Store, id store.WorldID) []sim.DueEvent {
	t.Helper()
	var due []sim.DueEvent
	if _, err := st.Update(context.Background(), id, func(w *sim.World, _ int64, _ time.Time) (bool, error) {
		due = sim.DueEvents(w)
		return false, nil
	}); err != nil {
		t.Fatal(err)
	}
	var ships []pendingEvent
	for _, e := range pendingEvents(t, st, id) {
		if store.IsDueKind(e.kind) {
			ships = append(ships, e)
		}
	}
	if len(ships) != len(due) {
		t.Fatalf("pending ship events %+v, due moments %+v", ships, due)
	}
	for i, d := range due {
		if k, ok := store.DueKey(ships[i].kind, []byte(ships[i].payload), ships[i].due); !ok || k != store.DueEventKey(d) {
			t.Fatalf("pending %+v, due %+v", ships[i], d)
		}
	}
	return due
}

// shippingWorld is the dev world at created with a connected shipyard.
func shippingWorld(t *testing.T, created time.Time) *sim.World {
	t.Helper()
	cat := testenv.Catalogue(t)
	w, err := devworld.NewDev(cat, created)
	if err != nil {
		t.Fatal(err)
	}
	var tiles []sim.Pos
	for y := 4; y <= 33; y++ {
		tiles = append(tiles, sim.Pos{X: 2, Y: y})
	}
	for x := 3; x <= 14; x++ {
		tiles = append(tiles, sim.Pos{X: x, Y: 33})
	}
	if err := sim.AddStock(w, cat, "start", "sails", 10_000, nil); err != nil {
		t.Fatal(err)
	}
	// The dev world has no bonus since the balancing pass: planks for two
	// shipyards, two sloops and a cargo.
	if err := sim.AddStock(w, cat, "start", "planks", 100_000, nil); err != nil {
		t.Fatal(err)
	}
	for _, cmd := range []sim.Command{
		sim.PlaceRoad{IslandID: "start", Type: "road_dirt", Tiles: tiles},
		sim.PlaceBuilding{IslandID: "start", Type: "shipyard", X: 5, Y: 34, Rotation: 180},
		sim.PlaceBuilding{IslandID: "start", Type: "shipyard", X: 14, Y: 34, Rotation: 180},
	} {
		if err := sim.Apply(w, cat, cmd); err != nil {
			t.Fatalf("%#v: %v", cmd, err)
		}
	}
	return w
}

func dbNow(t *testing.T, st *postgres.Store) time.Time {
	t.Helper()
	now, err := postgres.DBNow(context.Background(), st.Pool())
	if err != nil {
		t.Fatal(err)
	}
	return now
}

// TestCommandSchedulesDueEventInSameCommit (R-50): a command that creates
// an order commits the world and its pending ship_built event together;
// read-only requests do not duplicate it; an update whose event insertion
// fails rolls the world back.
func TestCommandSchedulesDueEventInSameCommit(t *testing.T) {
	st := setup(t)
	cat := testenv.Catalogue(t)
	id := testenv.StoreWorld(t, st, shippingWorld(t, dbNow(t, st)))
	order := func() (int64, error) {
		return st.Update(context.Background(), id, func(w *sim.World, _ int64, now time.Time) (bool, error) {
			if _, err := sim.Advance(w, cat, now); err != nil {
				return false, err
			}
			return true, sim.Apply(w, cat, sim.OrderShip{IslandID: "start", BuildingID: 2, ShipType: "sloop"})
		})
	}

	// A failing insertion (constraint) rolls the order back.
	ctx := context.Background()
	if _, err := st.Pool().Exec(ctx, "ALTER TABLE scheduled_events ADD CONSTRAINT test_no_ships CHECK (kind <> 'ship_built')"); err != nil {
		t.Fatal(err)
	}
	if _, err := order(); err == nil || !strings.Contains(err.Error(), "test_no_ships") {
		t.Fatalf("order with failing insertion: %v", err)
	}
	if v, _ := st.Version(ctx, id); v != 0 {
		t.Fatalf("version %d after a rolled-back update", v)
	}
	if due := checkReconciled(t, st, id); len(due) != 0 {
		t.Fatalf("rolled-back order left due moments %+v", due)
	}
	if _, err := st.Pool().Exec(ctx, "ALTER TABLE scheduled_events DROP CONSTRAINT test_no_ships"); err != nil {
		t.Fatal(err)
	}

	if _, err := order(); err != nil {
		t.Fatal(err)
	}
	due := checkReconciled(t, st, id)
	if len(due) != 1 || due[0].Kind != sim.DueShipBuilt {
		t.Fatalf("due = %+v", due)
	}
	for range 3 { // read-only requests
		_, _ = st.Update(ctx, id, func(w *sim.World, _ int64, now time.Time) (bool, error) {
			_, err := sim.Advance(w, cat, now)
			return false, err
		})
	}
	checkReconciled(t, st, id)
}

// TestShipEventsWithTwoWorkers (R-68): a world whose route ship arrived
// and whose shipyard finished an hour ago (offline) is caught up by two
// concurrent workers: every ship event is processed exactly once at its
// due_at, each arrival schedules the next one, the second sloop is built
// once, and the stored world is byte-identical to one Advance straight to
// the last due_at (late processing equals on-time processing).
func TestShipEventsWithTwoWorkers(t *testing.T) {
	st := setup(t)
	cat := testenv.Catalogue(t)
	t0 := dbNow(t, st).Add(-time.Hour)
	w := shippingWorld(t, t0)
	w.Gold = 100_000_000 // no insolvency during the hour
	apply := func(cmd sim.Command) {
		t.Helper()
		if err := sim.Apply(w, cat, cmd); err != nil {
			t.Fatalf("%#v: %v", cmd, err)
		}
	}
	advance := func(d time.Duration) {
		t.Helper()
		if _, err := sim.Advance(w, cat, w.LastEvaluatedAt.Add(d)); err != nil {
			t.Fatal(err)
		}
	}
	apply(sim.OrderShip{IslandID: "start", BuildingID: 2, ShipType: "sloop"})
	advance(2 * time.Minute)
	apply(sim.ManualShipment{ShipID: 1, ToIslandID: "island2", Cargo: []sim.CargoAmount{{Good: "planks", Amount: 50_000}}})
	advance(2*time.Minute + 20*time.Second)
	apply(sim.FoundIsland{ShipID: 1, IslandID: "island2", BuildingType: "trading_post", X: 2, Y: 0})
	apply(sim.CreateRoute{Stops: []sim.Stop{
		{IslandID: "start", Load: []sim.LoadRule{{Good: "planks", MaxAmount: 20_000}}},
		{IslandID: "island2", Unload: []string{"planks"}},
	}})
	apply(sim.AssignShip{ShipID: 1, RouteID: 1})
	apply(sim.OrderShip{IslandID: "start", BuildingID: 3, ShipType: "sloop"})
	initial := w.Clone()
	id := testenv.StoreWorld(t, st, w)
	if due := checkReconciled(t, st, id); len(due) != 2 {
		t.Fatalf("due = %+v", due)
	}

	// Process every ship event that is due now with two workers.
	pub := &recorder{}
	workers := []*events.Worker{worker(t, st, time.Hour, pub, nil), worker(t, st, time.Hour, pub, nil)}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{}, len(workers))
	for _, wk := range workers {
		go func() {
			_ = wk.Run(ctx)
			done <- struct{}{}
		}()
	}
	deadline := time.Now().Add(time.Minute)
	for {
		var due int
		_ = st.Pool().QueryRow(context.Background(), "SELECT count(*) FROM scheduled_events WHERE status = 'pending' AND due_at <= now()").Scan(&due)
		if due == 0 {
			break
		}
		if time.Now().After(deadline) {
			cancel()
			t.Fatalf("ship events still due: %v", statusCounts(t, st))
		}
		time.Sleep(50 * time.Millisecond)
	}
	cancel()
	for range workers {
		<-done
	}

	var built, arrived, failed int
	var lastDue time.Time
	rows, err := st.Pool().Query(context.Background(), "SELECT kind, status, due_at, attempts FROM scheduled_events")
	if err != nil {
		t.Fatal(err)
	}
	for rows.Next() {
		var kind, status string
		var due time.Time
		var attempts int
		if err := rows.Scan(&kind, &status, &due, &attempts); err != nil {
			t.Fatal(err)
		}
		if status == "done" {
			if due.After(lastDue) {
				lastDue = due.UTC()
			}
			switch kind {
			case events.KindShipBuilt:
				built++
			case events.KindShipArrived:
				arrived++
			}
		}
		if status == "failed" || attempts > 0 {
			failed++
		}
	}
	rows.Close()
	if built != 1 || arrived < 20 || failed != 0 {
		t.Fatalf("done ship_built %d, ship_arrived %d, failed/retried %d", built, arrived, failed)
	}
	if pub.count() != built+arrived {
		t.Errorf("published %d, processed %d", pub.count(), built+arrived)
	}
	// One pending arrival: the follow-up of the last processed one.
	due := checkReconciled(t, st, id)
	if len(due) != 1 || due[0].Kind != sim.DueShipArrived || !due[0].At.After(lastDue) {
		t.Fatalf("pending after catch-up: %+v (last done %s)", due, lastDue)
	}

	var stored []byte
	_, err = st.Update(context.Background(), id, func(w *sim.World, _ int64, _ time.Time) (bool, error) {
		if !w.LastEvaluatedAt.Equal(lastDue) || len(w.Ships) != 2 {
			t.Errorf("stored world at %s with %d ships, want %s and 2", w.LastEvaluatedAt, len(w.Ships), lastDue)
		}
		var err error
		stored, err = sim.Encode(w, cat.Region.Version)
		return false, err
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := sim.Advance(initial, cat, lastDue); err != nil {
		t.Fatal(err)
	}
	want, _ := sim.Encode(initial, cat.Region.Version)
	if !bytes.Equal(stored, want) {
		t.Fatal("the world caught up by the workers differs from one Advance to the last due_at")
	}
}

// TestRequestStopsAtShipEvent (R-68, D-043): a request never advances a
// world past its pending ship event; the worker applies it.
func TestRequestStopsAtShipEvent(t *testing.T) {
	st := setup(t)
	cat := testenv.Catalogue(t)
	t0 := dbNow(t, st).Add(-10 * time.Minute)
	w := shippingWorld(t, t0)
	if err := sim.Apply(w, cat, sim.OrderShip{IslandID: "start", BuildingID: 2, ShipType: "sloop"}); err != nil {
		t.Fatal(err)
	}
	id := testenv.StoreWorld(t, st, w)
	due := t0.Truncate(time.Millisecond).Add(2 * time.Minute)
	_, err := st.Update(context.Background(), id, func(w *sim.World, _ int64, now time.Time) (bool, error) {
		if !now.Equal(due) {
			t.Errorf("request time %s, want the pending ship_built at %s", now, due)
		}
		return false, nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if n, err := worker(t, st, time.Hour, nil, nil).RunOnce(context.Background()); err != nil || n != 1 {
		t.Fatalf("RunOnce = %d, %v", n, err)
	}
	_, _ = st.Update(context.Background(), id, func(w *sim.World, _ int64, now time.Time) (bool, error) {
		if !now.After(due) || len(w.Ships) != 1 {
			t.Errorf("after the event: now %s ships %d", now, len(w.Ships))
		}
		return false, nil
	})
}

// TestStaleShipEventIsNoOp (R-48): an event whose due moment no longer
// exists (cancelled order, unknown ship) is processed as a logged no-op.
func TestStaleShipEventIsNoOp(t *testing.T) {
	st := setup(t)
	cat := testenv.Catalogue(t)
	t0 := dbNow(t, st).Add(-10 * time.Minute)
	w := shippingWorld(t, t0)
	// An order placed and cancelled: its ship_built event is left over
	// (pending events are never deleted).
	for _, cmd := range []sim.Command{
		sim.OrderShip{IslandID: "start", BuildingID: 2, ShipType: "sloop"},
		sim.CancelShipOrder{IslandID: "start", BuildingID: 2},
	} {
		if err := sim.Apply(w, cat, cmd); err != nil {
			t.Fatal(err)
		}
	}
	id := testenv.StoreWorld(t, st, w)
	testenv.InsertEvent(t, st, t0.Add(2*time.Minute), events.KindShipBuilt, []store.WorldID{id}, store.ShipBuiltPayload{IslandID: "start", BuildingID: 2})
	testenv.InsertEvent(t, st, t0.Add(3*time.Minute), events.KindShipArrived, []store.WorldID{id}, store.ShipArrivedPayload{ShipID: 99})
	var logs testenv.SyncBuffer
	wk := &events.Worker{Store: st, Registry: events.DefaultRegistry(time.Hour), Catalogue: cat,
		Logger: slog.New(slog.NewTextHandler(&logs, nil)), PollInterval: 50 * time.Millisecond}
	for range 2 {
		if _, err := wk.RunOnce(context.Background()); err != nil {
			t.Fatal(err)
		}
	}
	if c := statusCounts(t, st); c["done"] != 2 || c["pending"] != 0 || c["failed"] != 0 {
		t.Fatalf("statuses %v\n%s", c, logs.String())
	}
	if strings.Count(logs.String(), "no-op") != 2 {
		t.Errorf("logs:\n%s", logs.String())
	}
	_, _ = st.Update(context.Background(), id, func(w *sim.World, _ int64, _ time.Time) (bool, error) {
		if len(w.Ships) != 0 {
			t.Errorf("a cancelled order built a ship")
		}
		return false, nil
	})
}
