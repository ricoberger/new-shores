package store

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/ricoberger/new-shores/server/internal/sim"
)

func newStore() *Memory {
	return NewMemory("w", sim.NewWorld(time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)))
}

func TestMemoryVersioning(t *testing.T) {
	ctx := context.Background()
	m := newStore()

	v, err := m.Update(ctx, "w", func(w *sim.World, version int64) (bool, error) {
		if version != 0 {
			t.Errorf("version = %d, want 0", version)
		}
		return false, nil
	})
	if err != nil || v != 0 {
		t.Fatalf("read-only update: v=%d err=%v", v, err)
	}

	v, err = m.Update(ctx, "w", func(w *sim.World, _ int64) (bool, error) {
		w.Gold = 42
		return true, nil
	})
	if err != nil || v != 1 {
		t.Fatalf("mutation: v=%d err=%v", v, err)
	}

	boom := errors.New("boom")
	v, err = m.Update(ctx, "w", func(w *sim.World, _ int64) (bool, error) {
		w.Gold = 7
		return true, boom
	})
	if !errors.Is(err, boom) || v != 1 {
		t.Fatalf("failed update: v=%d err=%v", v, err)
	}
	_, _ = m.Update(ctx, "w", func(w *sim.World, _ int64) (bool, error) {
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
	_, err := m.Update(context.Background(), "other", func(*sim.World, int64) (bool, error) { return true, nil })
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
			_, _ = m.Update(context.Background(), "w", func(w *sim.World, _ int64) (bool, error) {
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
	_, _ = m.Update(context.Background(), "w", func(w *sim.World, _ int64) (bool, error) {
		if w.Gold != n {
			t.Errorf("gold = %d, want %d", w.Gold, n)
		}
		return false, nil
	})
}
