package store

import (
	"context"
	"sync"
	"time"

	"github.com/ricoberger/new-shores/server/internal/sim"
)

// Memory is the dev-server store: exactly one world held in memory behind a
// mutex. Restarting the process discards it.
type Memory struct {
	mu      sync.Mutex
	id      WorldID
	world   *sim.World
	version int64
	now     func() time.Time
}

// NewMemory returns a store holding w under id at version 0. now returns
// the world time (the dev server's scaled wall clock); Update clamps it to
// the world's LastEvaluatedAt when the wall clock steps backwards (dev
// convenience only; the PostgreSQL store never clamps).
func NewMemory(id WorldID, w *sim.World, now func() time.Time) *Memory {
	return &Memory{id: id, world: w, now: now}
}

// Update implements Store. fn works on a copy of the world that replaces the
// stored one only when fn succeeds, which gives transaction semantics.
func (m *Memory) Update(ctx context.Context, id WorldID, fn UpdateFunc) (int64, error) {
	if err := ctx.Err(); err != nil {
		return 0, err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if id != m.id {
		return 0, ErrWorldNotFound
	}
	w := m.world.Clone()
	now := m.now().UTC().Truncate(time.Millisecond)
	if now.Before(w.LastEvaluatedAt) {
		now = w.LastEvaluatedAt
	}
	mutated, err := fn(w, m.version, now)
	if err != nil {
		return m.version, err
	}
	m.world = w
	if mutated {
		m.version++
	}
	return m.version, nil
}

// Version implements Store.
func (m *Memory) Version(ctx context.Context, id WorldID) (int64, error) {
	if err := ctx.Err(); err != nil {
		return 0, err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if id != m.id {
		return 0, ErrWorldNotFound
	}
	return m.version, nil
}
