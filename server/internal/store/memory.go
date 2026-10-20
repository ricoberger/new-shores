package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"sync"
	"time"

	"github.com/ricoberger/new-shores/server/internal/sim"
)

// Memory is the dev-server store: exactly one world held in memory behind a
// mutex, plus its pending scheduled events (the in-memory counterpart of
// the scheduled_events table). Restarting the process discards both.
//
// Like the PostgreSQL store, every Update keeps one pending event per due
// moment of the world (R-49) and caps the world time at the earliest
// pending event, so that only the dev scheduler (events.DevScheduler)
// processes due moments, at their due time.
type Memory struct {
	mu      sync.Mutex
	id      WorldID
	world   *sim.World
	version int64
	now     func() time.Time
	pending []MemEvent
	nextID  int64
	changed chan struct{}
}

// MemEvent is a pending scheduled event of the memory store.
type MemEvent struct {
	ID      int64
	DueAt   time.Time
	Kind    string
	Payload json.RawMessage
}

// NewMemory returns a store holding w under id at version 0. now returns
// the world time (the dev server's scaled wall clock); Update clamps it to
// the world's LastEvaluatedAt when the wall clock steps backwards (dev
// convenience only; the PostgreSQL store never clamps). Pending events are
// created for the due moments w already has.
func NewMemory(id WorldID, w *sim.World, now func() time.Time) *Memory {
	m := &Memory{id: id, world: w, now: now, changed: make(chan struct{}, 1)}
	m.reconcile(w)
	return m
}

// reconcile adds a pending event for every due moment of w without one.
// The caller holds mu (or owns m exclusively).
func (m *Memory) reconcile(w *sim.World) {
	keys := map[string]bool{}
	for _, e := range m.pending {
		if k, ok := DueKey(e.Kind, e.Payload, e.DueAt); ok {
			keys[k] = true
		}
	}
	for _, ev := range MissingDueEvents(w, keys) {
		m.add(MemEvent{DueAt: ev.At, Kind: ev.Kind, Payload: DuePayload(ev)})
	}
}

func (m *Memory) add(e MemEvent) {
	m.nextID++
	e.ID = m.nextID
	e.DueAt = e.DueAt.UTC().Truncate(time.Millisecond)
	m.pending = append(m.pending, e)
	slices.SortStableFunc(m.pending, func(a, b MemEvent) int {
		if c := a.DueAt.Compare(b.DueAt); c != 0 {
			return c
		}
		return int(a.ID - b.ID)
	})
}

// notify wakes a waiting scheduler (non-blocking).
func (m *Memory) notify() {
	select {
	case m.changed <- struct{}{}:
	default:
	}
}

// Update implements Store. fn works on a copy of the world that replaces the
// stored one only when fn succeeds, which gives transaction semantics. The
// world time is capped at the earliest pending event; afterwards every due
// moment of the world has a pending event.
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
	if len(m.pending) > 0 && m.pending[0].DueAt.Before(now) {
		now = m.pending[0].DueAt
	}
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
	m.reconcile(w)
	m.notify()
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

// ID returns the ID of the stored world.
func (m *Memory) ID() WorldID { return m.id }

// Changed is signalled after every Update and processed event: a new due
// moment may be earlier than the one a scheduler sleeps for.
func (m *Memory) Changed() <-chan struct{} { return m.changed }

// NextDue returns the due time of the earliest pending event.
func (m *Memory) NextDue() (time.Time, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if len(m.pending) == 0 {
		return time.Time{}, false
	}
	return m.pending[0].DueAt, true
}

// Pending returns a copy of the pending events in due order.
func (m *Memory) Pending() []MemEvent {
	m.mu.Lock()
	defer m.mu.Unlock()
	return slices.Clone(m.pending)
}

// ApplyEventFunc applies a pending event to a copy of the world (advance
// to the due time, run the handler) and returns its follow-up events.
// pending lists the other pending events.
type ApplyEventFunc func(ev MemEvent, w *sim.World, pending []MemEvent) ([]MemEvent, error)

// ErrEventPast reports an event whose world was evaluated after its due
// time.
var ErrEventPast = errors.New("world evaluated past the event's due time")

// ProcessNext processes the earliest pending event if it is due at or
// before upTo, like the PostgreSQL worker in one transaction: the event is
// removed, fn runs on a copy of the world, and on success the world is
// committed (version + 1), the follow-ups are added and every due moment
// gets its pending event. A failed event is dropped and its error
// returned; the world is unchanged. It reports whether an event was taken.
func (m *Memory) ProcessNext(ctx context.Context, upTo time.Time, fn ApplyEventFunc) (bool, error) {
	if err := ctx.Err(); err != nil {
		return false, err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if len(m.pending) == 0 || m.pending[0].DueAt.After(upTo) {
		return false, nil
	}
	ev := m.pending[0]
	m.pending = slices.Delete(m.pending, 0, 1)
	defer m.notify()
	w := m.world.Clone()
	if w.LastEvaluatedAt.After(ev.DueAt) {
		return true, fmt.Errorf("%w: event %d %s due %s", ErrEventPast, ev.ID, ev.Kind, ev.DueAt.Format(time.RFC3339Nano))
	}
	followUps, err := fn(ev, w, slices.Clone(m.pending))
	if err != nil {
		return true, err
	}
	for _, f := range followUps {
		if f.DueAt.Before(ev.DueAt) {
			return true, fmt.Errorf("follow-up %s due before event %d", f.Kind, ev.ID)
		}
	}
	m.world = w
	m.version++
	for _, f := range followUps {
		m.add(f)
	}
	m.reconcile(w)
	return true, nil
}
