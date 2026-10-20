// Package events is the scheduled-events worker (docs/ARCHITECTURE.md
// §4.3): every server instance drains the scheduled_events table with
// FOR UPDATE SKIP LOCKED, applies each event at its due time in one
// transaction that locks the event's worlds in ascending ID order, and
// publishes the changed worlds after commit. There is no tick loop: the
// worker only processes events that are due.
package events

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"slices"
	"time"

	"github.com/ricoberger/new-shores/server/internal/content"
	"github.com/ricoberger/new-shores/server/internal/sim"
	"github.com/ricoberger/new-shores/server/internal/store"
)

// Event is a scheduled event being processed.
type Event struct {
	ID       int64
	DueAt    time.Time
	Kind     string
	WorldIDs []store.WorldID
	Payload  json.RawMessage
	Attempts int
}

// FollowUp is an event scheduled by a handler.
type FollowUp struct {
	DueAt    time.Time
	Kind     string
	WorldIDs []store.WorldID
	Payload  json.RawMessage
}

// HandlerContext is what a handler may touch: the event, its worlds
// (locked by the transaction and already advanced to the event's due_at)
// and a scheduler for follow-up events. Handlers are pure with respect to
// the worlds: they mutate only the passed worlds and schedule events; they
// perform no other I/O.
type HandlerContext struct {
	Event     Event
	Worlds    map[store.WorldID]*sim.World
	Catalogue *content.Catalogue
	Logger    *slog.Logger
	followUps []FollowUp
}

// Schedule adds a follow-up event, inserted in the same transaction. It
// may only list worlds of the current event (their row locks are held) and
// must not be due before the current event.
func (hc *HandlerContext) Schedule(f FollowUp) error {
	if len(f.WorldIDs) == 0 {
		return fmt.Errorf("follow-up %s: no worlds", f.Kind)
	}
	for _, id := range f.WorldIDs {
		if _, ok := hc.Worlds[id]; !ok {
			return fmt.Errorf("follow-up %s: world %s is not locked by event %d", f.Kind, id, hc.Event.ID)
		}
	}
	if f.DueAt.Before(hc.Event.DueAt) {
		return fmt.Errorf("follow-up %s: due %s before the current event's due_at %s", f.Kind, f.DueAt, hc.Event.DueAt)
	}
	hc.followUps = append(hc.followUps, f)
	return nil
}

// Handler applies an event of one kind.
type Handler func(ctx context.Context, hc *HandlerContext) error

// Registry maps event kinds to handlers.
type Registry struct {
	handlers map[string]Handler
}

// NewRegistry returns an empty registry.
func NewRegistry() *Registry { return &Registry{handlers: map[string]Handler{}} }

// Register adds the handler of a kind; registering a kind twice panics.
func (r *Registry) Register(kind string, h Handler) {
	if _, dup := r.handlers[kind]; dup {
		panic("events: kind registered twice: " + kind)
	}
	r.handlers[kind] = h
}

// Handler returns the handler of a kind.
func (r *Registry) Handler(kind string) (Handler, bool) {
	h, ok := r.handlers[kind]
	return h, ok
}

// Kinds returns the registered kinds, sorted.
func (r *Registry) Kinds() []string {
	out := make([]string, 0, len(r.handlers))
	for k := range r.handlers {
		out = append(out, k)
	}
	slices.Sort(out)
	return out
}

// Kind names.
const (
	// KindAdvanceTo advances its world to due_at (the generic effect of
	// every event) and schedules the next advance_to one freshness
	// interval later, so that every world has exactly one pending
	// advance_to at all times.
	KindAdvanceTo = "advance_to"
)

// DefaultRegistry returns the production registry: advance_to (with the
// given freshness interval) plus, in builds with the testevents tag only,
// the test kinds.
func DefaultRegistry(freshness time.Duration) *Registry {
	r := NewRegistry()
	r.Register(KindAdvanceTo, advanceTo(freshness))
	registerTestKinds(r)
	return r
}

// advanceTo is the advance_to handler: a no-op apart from chaining the next
// advance_to of the world.
func advanceTo(freshness time.Duration) Handler {
	return func(_ context.Context, hc *HandlerContext) error {
		if len(hc.Event.WorldIDs) != 1 {
			return fmt.Errorf("advance_to: want exactly one world, got %d", len(hc.Event.WorldIDs))
		}
		return hc.Schedule(FollowUp{
			DueAt:    hc.Event.DueAt.Add(freshness),
			Kind:     KindAdvanceTo,
			WorldIDs: hc.Event.WorldIDs,
			Payload:  json.RawMessage(`{}`),
		})
	}
}
