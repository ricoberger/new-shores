package store

import (
	"context"
	"sync"

	"github.com/ricoberger/new-shores/server/internal/sim"
)

// Memory is the dev-server store: exactly one world held in memory behind a
// mutex. Restarting the process discards it.
type Memory struct {
	mu      sync.Mutex
	id      WorldID
	world   *sim.World
	version int64
}

// NewMemory returns a store holding w under id at version 0.
func NewMemory(id WorldID, w *sim.World) *Memory {
	return &Memory{id: id, world: w}
}

// Update implements Store. fn works on a copy of the world that replaces the
// stored one only when fn succeeds, which gives transaction semantics.
func (m *Memory) Update(ctx context.Context, id WorldID, fn func(w *sim.World, version int64) (bool, error)) (int64, error) {
	if err := ctx.Err(); err != nil {
		return 0, err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if id != m.id {
		return 0, ErrWorldNotFound
	}
	w := m.world.Clone()
	mutated, err := fn(w, m.version)
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
