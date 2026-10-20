package store

import (
	"context"
	"encoding/json"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/ricoberger/new-shores/server/internal/sim"
)

func newStore() *Memory {
	start := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	return NewMemory("w", sim.NewWorld(start), func() time.Time { return start })
}

func TestMemoryVersioning(t *testing.T) {
	ctx := context.Background()
	m := newStore()

	v, err := m.Update(ctx, "w", func(w *sim.World, version int64, _ time.Time) (bool, error) {
		if version != 0 {
			t.Errorf("version = %d, want 0", version)
		}
		return false, nil
	})
	if err != nil || v != 0 {
		t.Fatalf("read-only update: v=%d err=%v", v, err)
	}

	v, err = m.Update(ctx, "w", func(w *sim.World, _ int64, _ time.Time) (bool, error) {
		w.Gold = 42
		return true, nil
	})
	if err != nil || v != 1 {
		t.Fatalf("mutation: v=%d err=%v", v, err)
	}

	boom := errors.New("boom")
	v, err = m.Update(ctx, "w", func(w *sim.World, _ int64, _ time.Time) (bool, error) {
		w.Gold = 7
		return true, boom
	})
	if !errors.Is(err, boom) || v != 1 {
		t.Fatalf("failed update: v=%d err=%v", v, err)
	}
	_, _ = m.Update(ctx, "w", func(w *sim.World, _ int64, _ time.Time) (bool, error) {
		if w.Gold != 42 {
			t.Errorf("gold = %d after failed update, want 42", w.Gold)
		}
		return false, nil
	})
	if v, err := m.Version(ctx, "w"); err != nil || v != 1 {
		t.Fatalf("Version = %d, %v", v, err)
	}
}

func TestMemoryUnknownWorld(t *testing.T) {
	m := newStore()
	if _, err := m.Version(context.Background(), "other"); !errors.Is(err, ErrWorldNotFound) {
		t.Fatalf("Version: %v", err)
	}
	_, err := m.Update(context.Background(), "other", func(*sim.World, int64, time.Time) (bool, error) { return true, nil })
	if !errors.Is(err, ErrWorldNotFound) {
		t.Fatalf("Update: %v", err)
	}
}

func TestMemorySerialises(t *testing.T) {
	m := newStore()
	const n = 50
	var wg sync.WaitGroup
	for range n {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, _ = m.Update(context.Background(), "w", func(w *sim.World, _ int64, _ time.Time) (bool, error) {
				w.Gold++
				return true, nil
			})
		}()
	}
	wg.Wait()
	v, _ := m.Version(context.Background(), "w")
	if v != n {
		t.Fatalf("version = %d, want %d", v, n)
	}
	_, _ = m.Update(context.Background(), "w", func(w *sim.World, _ int64, _ time.Time) (bool, error) {
		if w.Gold != n {
			t.Errorf("gold = %d, want %d", w.Gold, n)
		}
		return false, nil
	})
}

func TestMemoryDeliversClampedTime(t *testing.T) {
	start := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	wall := start.Add(1500*time.Millisecond + 999*time.Microsecond)
	m := NewMemory("w", sim.NewWorld(start), func() time.Time { return wall })
	_, _ = m.Update(context.Background(), "w", func(w *sim.World, _ int64, now time.Time) (bool, error) {
		if want := start.Add(1500 * time.Millisecond); !now.Equal(want) {
			t.Errorf("now = %s, want %s (truncated to ms)", now, want)
		}
		w.LastEvaluatedAt = start.Add(time.Hour)
		return true, nil
	})
	_, _ = m.Update(context.Background(), "w", func(_ *sim.World, _ int64, now time.Time) (bool, error) {
		if want := start.Add(time.Hour); !now.Equal(want) {
			t.Errorf("now = %s, want clamp to %s", now, want)
		}
		return false, nil
	})
}

// dueWorld returns a world whose single shipyard order is due at due.
func dueWorld(start, due time.Time) *sim.World {
	w := sim.NewWorld(start)
	is := sim.NewIsland("a", 1, 1, []sim.Tile{{Terrain: "coast"}})
	is.Buildings = []*sim.Building{{ID: 1, Type: "shipyard", Order: &sim.ShipOrder{Type: "sloop", OrderedAtMs: start.UnixMilli(), DueAtMs: due.UnixMilli()}}}
	w.Islands = []*sim.Island{is}
	return w
}

// TestMemoryDueEvents (R-49, R-51): every due moment of the world has one
// pending event (created at construction and after every Update, never
// duplicated), and the world time of an Update is capped at the earliest
// pending event.
func TestMemoryDueEvents(t *testing.T) {
	ctx := context.Background()
	start := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	due := start.Add(2 * time.Minute)
	wall := start.Add(time.Hour)
	m := NewMemory("w", dueWorld(start, due), func() time.Time { return wall })
	p := m.Pending()
	if len(p) != 1 || p[0].Kind != sim.DueShipBuilt || !p[0].DueAt.Equal(due) || string(p[0].Payload) != `{"island_id":"a","building_id":1}` {
		t.Fatalf("pending = %+v", p)
	}
	if next, ok := m.NextDue(); !ok || !next.Equal(due) {
		t.Fatalf("next = %s %v", next, ok)
	}
	for range 2 {
		_, _ = m.Update(ctx, "w", func(_ *sim.World, _ int64, now time.Time) (bool, error) {
			if !now.Equal(due) {
				t.Errorf("now = %s, want the cap %s", now, due)
			}
			return false, nil
		})
	}
	// A second order: one more pending event, the first one not duplicated.
	_, _ = m.Update(ctx, "w", func(w *sim.World, _ int64, _ time.Time) (bool, error) {
		w.Islands[0].Buildings = append(w.Islands[0].Buildings, &sim.Building{ID: 2, Type: "shipyard",
			Order: &sim.ShipOrder{Type: "sloop", DueAtMs: due.Add(time.Minute).UnixMilli()}})
		return true, nil
	})
	select {
	case <-m.Changed():
	default:
		t.Error("Update did not signal a change")
	}
	if p := m.Pending(); len(p) != 2 || !p[1].DueAt.Equal(due.Add(time.Minute)) {
		t.Fatalf("pending = %+v", p)
	}
}

// TestMemoryProcessNext: an event is processed at its due time on a copy
// of the world; success commits (version + 1) with follow-ups, failure
// drops the event and keeps the world.
func TestMemoryProcessNext(t *testing.T) {
	ctx := context.Background()
	start := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	due := start.Add(2 * time.Minute)
	m := NewMemory("w", dueWorld(start, due), func() time.Time { return start })
	if took, err := m.ProcessNext(ctx, due.Add(-time.Millisecond), nil); took || err != nil {
		t.Fatalf("processed early: %v %v", took, err)
	}
	took, err := m.ProcessNext(ctx, due, func(ev MemEvent, w *sim.World, pending []MemEvent) ([]MemEvent, error) {
		if len(pending) != 0 || !ev.DueAt.Equal(due) {
			t.Errorf("event %+v pending %+v", ev, pending)
		}
		w.Islands[0].Buildings[0].Order = nil // the effect
		w.LastEvaluatedAt = due
		return []MemEvent{{DueAt: due.Add(time.Hour), Kind: "advance_to", Payload: json.RawMessage(`{}`)}}, nil
	})
	if !took || err != nil {
		t.Fatalf("process: %v %v", took, err)
	}
	if v, _ := m.Version(ctx, "w"); v != 1 {
		t.Errorf("version = %d", v)
	}
	if p := m.Pending(); len(p) != 1 || p[0].Kind != "advance_to" {
		t.Fatalf("pending = %+v", p)
	}
	boom := errors.New("boom")
	took, err = m.ProcessNext(ctx, due.Add(2*time.Hour), func(MemEvent, *sim.World, []MemEvent) ([]MemEvent, error) { return nil, boom })
	if !took || !errors.Is(err, boom) || len(m.Pending()) != 0 {
		t.Fatalf("failed event: %v %v %+v", took, err, m.Pending())
	}
	if v, _ := m.Version(ctx, "w"); v != 1 {
		t.Errorf("version after a failure = %d", v)
	}
}
