package events

import (
	"context"
	"log/slog"
	"time"

	"github.com/ricoberger/new-shores/server/internal/content"
	"github.com/ricoberger/new-shores/server/internal/sim"
	"github.com/ricoberger/new-shores/server/internal/store"
)

// DevScheduler processes the pending events of the dev server's in-memory
// store (R-51). It is not a tick loop: it sleeps until the earliest pending
// due time (converted to wall-clock time by WallUntil, which applies
// --time-scale), re-arms whenever the store changed (an Update may create
// an earlier due moment) and stops when its context is cancelled. Each
// event is processed like the PostgreSQL worker does: the world is
// advanced to exactly due_at, the registered handler runs, follow-ups and
// due moments get pending events, the version is bumped and the change is
// published.
type DevScheduler struct {
	Store     *store.Memory
	Registry  *Registry
	Catalogue *content.Catalogue
	Publisher Publisher
	Logger    *slog.Logger
	// WorldNow returns the current world time (the scaled wall clock).
	WorldNow func() time.Time
	// WallUntil returns the wall-clock duration until the world reaches t.
	WallUntil func(t time.Time) time.Duration
}

// Run processes due events until ctx is cancelled.
func (s *DevScheduler) Run(ctx context.Context) error {
	for {
		s.ProcessDue(ctx)
		var wake <-chan time.Time
		var timer *time.Timer
		if next, ok := s.Store.NextDue(); ok {
			timer = time.NewTimer(max(s.WallUntil(next), 0))
			wake = timer.C
		}
		select {
		case <-ctx.Done():
			if timer != nil {
				timer.Stop()
			}
			return nil
		case <-s.Store.Changed():
		case <-wake:
		}
		if timer != nil {
			timer.Stop()
		}
	}
}

// ProcessDue processes every event due at the current world time and
// returns how many it took (Run calls it whenever it wakes).
func (s *DevScheduler) ProcessDue(ctx context.Context) int {
	n := 0
	for ctx.Err() == nil {
		begin := time.Now()
		var kind string
		took, err := s.Store.ProcessNext(ctx, s.WorldNow(), func(me store.MemEvent, w *sim.World, pending []store.MemEvent) ([]store.MemEvent, error) {
			kind = me.Kind
			return s.apply(ctx, me, w, pending)
		})
		if !took {
			return n
		}
		n++
		if err != nil {
			s.Logger.Error("dev events: event failed and was dropped", "kind", kind, "error", err)
			continue
		}
		s.Logger.Debug("dev events: processed", "kind", kind, "duration", time.Since(begin))
		if s.Publisher != nil {
			s.Publisher.Publish(ctx, s.Store.ID())
		}
	}
	return n
}

func (s *DevScheduler) apply(ctx context.Context, me store.MemEvent, w *sim.World, pending []store.MemEvent) ([]store.MemEvent, error) {
	id := s.Store.ID()
	keys := map[string]bool{}
	for _, p := range pending {
		if k, ok := store.DueKey(p.Kind, p.Payload, p.DueAt); ok {
			keys[k] = true
		}
	}
	bs, err := sim.Advance(w, s.Catalogue, me.DueAt)
	if err != nil {
		return nil, err
	}
	hc := &HandlerContext{
		Event:      Event{ID: me.ID, DueAt: me.DueAt, Kind: me.Kind, WorldIDs: []store.WorldID{id}, Payload: me.Payload},
		Worlds:     map[store.WorldID]*sim.World{id: w},
		Catalogue:  s.Catalogue,
		Logger:     s.Logger,
		Boundaries: map[store.WorldID][]sim.Boundary{id: bs},
		pending:    map[store.WorldID]map[string]bool{id: keys},
	}
	h, ok := s.Registry.Handler(me.Kind)
	if !ok {
		return nil, errUnregistered(me.Kind)
	}
	if err := h(ctx, hc); err != nil {
		return nil, err
	}
	if err := hc.ReconcileDueEvents(); err != nil {
		return nil, err
	}
	out := make([]store.MemEvent, 0, len(hc.followUps))
	for _, f := range hc.followUps {
		out = append(out, store.MemEvent{DueAt: f.DueAt, Kind: f.Kind, Payload: f.Payload})
	}
	return out, nil
}
