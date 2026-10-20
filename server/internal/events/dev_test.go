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

// manualClock is the injected world clock of the scheduler test: it only
// moves when the test advances it.
type manualClock struct {
	mu  sync.Mutex
	now time.Time
}

func (c *manualClock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.now
}

func (c *manualClock) Set(t time.Time) {
	c.mu.Lock()
	c.now = t
	c.mu.Unlock()
}

// TestDevSchedulerRearms (R-51): the scheduler sleeps until the earliest
// pending due moment; a command that creates an earlier due moment wakes
// it and it re-arms for that moment, processing the earlier event at its
// due time; on cancellation it stops at once.
//
// The world clock is manual, so no event becomes due by itself, and the
// scheduler's WallUntil callback (called right before it arms its timer)
// is the synchronisation point: the test places the order only after the
// scheduler armed for the 1 h deadline, and moves the clock to the new
// order's due time only while the scheduler is inside WallUntil for that
// earlier deadline. Every goroutine interleaving therefore takes the same
// path: arm for 1 h -> woken by the order -> nothing due yet -> re-arm for
// the earlier deadline -> timer -> process -> publish.
func TestDevSchedulerRearms(t *testing.T) {
	c := devCatalogue(t)
	worldStart := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	clock := &manualClock{now: worldStart}
	w := devShipyardWorld(t, c, worldStart)
	// A far due moment: the first shipyard's order completes in 1 h.
	if err := sim.Apply(w, c, sim.OrderShip{IslandID: "start", BuildingID: 2, ShipType: "sloop"}); err != nil {
		t.Fatal(err)
	}
	far := worldStart.Add(time.Hour)
	near := worldStart.Add(2 * time.Minute) // the second order, placed at worldStart
	w.Islands[0].Building(2).Order.DueAtMs = far.UnixMilli()
	mem := store.NewMemory("dev", w, clock.Now)
	if p := mem.Pending(); len(p) != 1 || !p[0].DueAt.Equal(far) {
		t.Fatalf("pending = %+v", p)
	}
	pub := newCountingPublisher()
	var (
		mu       sync.Mutex
		armedFor []time.Time
	)
	armedFar := make(chan struct{}, 1)
	armedNear := make(chan struct{}, 1)
	release := make(chan struct{})
	sched := &DevScheduler{
		Store: mem, Registry: DefaultRegistry(time.Hour), Catalogue: c, Publisher: pub,
		Logger: slog.New(slog.NewTextHandler(io.Discard, nil)), WorldNow: clock.Now,
		// Real wall time until the deadline at the manual clock: 1 h for
		// the far order (never fires during the test), 0 for the near one
		// once the test moved the clock there.
		WallUntil: func(t time.Time) time.Duration {
			mu.Lock()
			armedFor = append(armedFor, t)
			mu.Unlock()
			if t.Equal(near) {
				armedNear <- struct{}{}
				<-release // the test moves the clock to the due time
			} else {
				select {
				case armedFar <- struct{}{}:
				default:
				}
			}
			return t.Sub(clock.Now())
		},
	}
	ctx, cancel := context.WithCancel(context.Background())
	var releaseOnce sync.Once
	unblock := func() { releaseOnce.Do(func() { close(release) }) }
	// On an early failure the scheduler must not stay blocked in WallUntil.
	defer func() {
		unblock()
		cancel()
	}()
	done := make(chan struct{})
	go func() {
		defer close(done)
		if err := sched.Run(ctx); err != nil {
			t.Error(err)
		}
	}()
	wait := func(ch <-chan struct{}, what string) {
		t.Helper()
		select {
		case <-ch:
		case <-time.After(2 * time.Second):
			t.Fatal(what)
		}
	}
	wait(armedFar, "the scheduler never armed for the 1 h order")

	// The second shipyard orders a sloop due in 2 min; it wakes the
	// scheduler, which re-arms for it (nothing is due at the frozen clock).
	_, err := mem.Update(ctx, "dev", func(w *sim.World, _ int64, now time.Time) (bool, error) {
		if _, err := sim.Advance(w, c, now); err != nil {
			return false, err
		}
		return true, sim.Apply(w, c, sim.OrderShip{IslandID: "start", BuildingID: 3, ShipType: "sloop"})
	})
	if err != nil {
		t.Fatal(err)
	}
	if p := mem.Pending(); len(p) != 2 || !p[0].DueAt.Equal(near) {
		t.Fatalf("pending after the order = %+v", p)
	}
	wait(armedNear, "the scheduler did not re-arm for the earlier order")
	mu.Lock()
	deadlines := append([]time.Time(nil), armedFor...)
	mu.Unlock()
	if len(deadlines) != 2 || !deadlines[0].Equal(far) || !deadlines[1].Equal(near) {
		t.Fatalf("armed for %v, want the 1 h order, then the earlier order", deadlines)
	}
	if pub.count() != 0 {
		t.Fatalf("published %d before the due time", pub.count())
	}
	clock.Set(near)
	unblock()

	// The scheduler publishes after it committed the event, so once the
	// push is observed the world state is final: wait for the push first,
	// then assert on the world (no polling of the world state).
	wait(pub.published, "no push for the earlier order")
	var ships int
	_, _ = mem.Update(ctx, "dev", func(w *sim.World, _ int64, _ time.Time) (bool, error) {
		ships = len(w.Ships)
		return false, nil
	})
	if ships != 1 || pub.count() != 1 {
		t.Fatalf("ships %d, publishes %d", ships, pub.count())
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
