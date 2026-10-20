package events

import (
	"context"
	"io"
	"log/slog"
	"path/filepath"
	"runtime"
	"sync"
	"testing"
	"time"

	"github.com/ricoberger/new-shores/server/internal/content"
	"github.com/ricoberger/new-shores/server/internal/devworld"
	"github.com/ricoberger/new-shores/server/internal/sim"
	"github.com/ricoberger/new-shores/server/internal/store"
)

func devCatalogue(t *testing.T) *content.Catalogue {
	t.Helper()
	_, file, _, _ := runtime.Caller(0)
	c, err := content.Load(filepath.Join(filepath.Dir(file), "..", "..", "..", "content", "old_coast"))
	if err != nil {
		t.Fatal(err)
	}
	return c
}

// countingPublisher counts publishes and signals each one on published, so
// that tests wait for the push instead of polling the world.
type countingPublisher struct {
	mu        sync.Mutex
	n         int
	published chan struct{}
}

func newCountingPublisher() *countingPublisher {
	return &countingPublisher{published: make(chan struct{}, 16)}
}

func (p *countingPublisher) Publish(context.Context, store.WorldID) {
	p.mu.Lock()
	p.n++
	p.mu.Unlock()
	p.published <- struct{}{}
}

func (p *countingPublisher) count() int {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.n
}

// devShipyardWorld is the dev world with two connected shipyards (the
// shipping layout of devworld's tests).
func devShipyardWorld(t *testing.T, c *content.Catalogue, at time.Time) *sim.World {
	t.Helper()
	w, err := devworld.NewDev(c, at)
	if err != nil {
		t.Fatal(err)
	}
	var tiles []sim.Pos
	for y := 4; y <= 33; y++ {
		tiles = append(tiles, sim.Pos{X: 2, Y: y})
	}
	for x := 3; x <= 13; x++ {
		tiles = append(tiles, sim.Pos{X: x, Y: 33})
	}
	if err := sim.AddStock(w, c, "start", "sails", 10_000, nil); err != nil {
		t.Fatal(err)
	}
	for _, cmd := range []sim.Command{
		sim.PlaceRoad{IslandID: "start", Type: "road_dirt", Tiles: tiles},
		sim.PlaceBuilding{IslandID: "start", Type: "shipyard", X: 5, Y: 34},
		sim.PlaceBuilding{IslandID: "start", Type: "shipyard", X: 14, Y: 33},
	} {
		if err := sim.Apply(w, c, cmd); err != nil {
			t.Fatalf("%#v: %v", cmd, err)
		}
	}
	return w
}

// TestDevSchedulerRearms (R-51): the scheduler sleeps until the earliest
// pending due moment; a command that creates an earlier due moment wakes
// it and it re-arms, processing the earlier event at its due time; on
// cancellation it stops at once.
func TestDevSchedulerRearms(t *testing.T) {
	c := devCatalogue(t)
	const scale = 1000 // world ms per wall ms
	wallStart := time.Now()
	worldStart := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	worldNow := func() time.Time {
		return worldStart.Add(time.Since(wallStart) * scale).Truncate(time.Millisecond)
	}
	w := devShipyardWorld(t, c, worldStart)
	// A far due moment: the first shipyard's order completes in 1 h of
	// world time (3.6 s of wall time).
	if err := sim.Apply(w, c, sim.OrderShip{IslandID: "start", BuildingID: 2, ShipType: "sloop"}); err != nil {
		t.Fatal(err)
	}
	w.Islands[0].Building(2).Order.DueAtMs = worldStart.Add(time.Hour).UnixMilli()
	mem := store.NewMemory("dev", w, worldNow)
	if p := mem.Pending(); len(p) != 1 || !p[0].DueAt.Equal(worldStart.Add(time.Hour)) {
		t.Fatalf("pending = %+v", p)
	}
	pub := newCountingPublisher()
	sched := &DevScheduler{
		Store: mem, Registry: DefaultRegistry(time.Hour), Catalogue: c, Publisher: pub,
		Logger: slog.New(slog.NewTextHandler(io.Discard, nil)), WorldNow: worldNow,
		WallUntil: func(t time.Time) time.Duration { return t.Sub(worldNow()) / scale },
	}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		defer close(done)
		if err := sched.Run(ctx); err != nil {
			t.Error(err)
		}
	}()
	time.Sleep(50 * time.Millisecond) // armed for the 1 h order

	// The second shipyard orders a sloop due in 2 min (120 ms wall).
	ordered := time.Now()
	_, err := mem.Update(ctx, "dev", func(w *sim.World, _ int64, now time.Time) (bool, error) {
		if _, err := sim.Advance(w, c, now); err != nil {
			return false, err
		}
		return true, sim.Apply(w, c, sim.OrderShip{IslandID: "start", BuildingID: 3, ShipType: "sloop"})
	})
	if err != nil {
		t.Fatal(err)
	}
	if p := mem.Pending(); len(p) != 2 {
		t.Fatalf("pending after the order = %+v", p)
	}
	// The scheduler publishes after it committed the event, so once the
	// push is observed the world state is final: wait for the push first,
	// then assert on the world (no polling of the world state).
	select {
	case <-pub.published:
	case <-time.After(2 * time.Second):
		t.Fatalf("no push %s after the order (scheduler did not re-arm)", time.Since(ordered))
	}
	took := time.Since(ordered)
	var ships int
	_, _ = mem.Update(ctx, "dev", func(w *sim.World, _ int64, _ time.Time) (bool, error) {
		ships = len(w.Ships)
		return false, nil
	})
	if ships != 1 || pub.count() != 1 {
		t.Fatalf("after %s: ships %d, publishes %d", took, ships, pub.count())
	}
	if took >= 3*time.Second {
		t.Errorf("the earlier event waited for the later one: %s", took)
	}
	p := mem.Pending()
	if len(p) != 1 || !p[0].DueAt.Equal(worldStart.Add(time.Hour)) {
		t.Errorf("pending after processing = %+v", p)
	}
	_, _ = mem.Update(ctx, "dev", func(w *sim.World, _ int64, now time.Time) (bool, error) {
		if s := w.Ships[0]; s.IslandID != "start" || s.State != sim.ShipIdle || w.Islands[0].Building(3).Order != nil || w.Islands[0].Building(2).Order == nil {
			t.Errorf("world after ship_built: %+v", s)
		}
		return false, nil
	})

	cancel()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("scheduler did not stop on cancellation")
	}
}
