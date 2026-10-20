package events

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/ricoberger/new-shores/server/internal/sim"
	"github.com/ricoberger/new-shores/server/internal/store"
)

// shipEvent handles ship_built and ship_arrived. The effect itself is part
// of the simulation: the worker advanced the world to due_at, and Advance
// applied the due moment at exactly that millisecond (user decision Q1 =
// B). The handler verifies that the world no longer carries a due moment
// of this identity at or before due_at, logs a stale event (scrapped ship,
// cancelled order, or an effect already applied by a request that reached
// due_at) as a no-op, and schedules the follow-up due moments.
func shipEvent(_ context.Context, hc *HandlerContext) error {
	ev := hc.Event
	if len(ev.WorldIDs) != 1 {
		return fmt.Errorf("%s: want exactly one world, got %d", ev.Kind, len(ev.WorldIDs))
	}
	id := ev.WorldIDs[0]
	w := hc.Worlds[id]
	var match func(sim.DueEvent) bool
	var bmatch func(sim.Boundary) bool
	switch ev.Kind {
	case KindShipBuilt:
		var p store.ShipBuiltPayload
		if err := json.Unmarshal(ev.Payload, &p); err != nil {
			return fmt.Errorf("%s payload: %w", ev.Kind, err)
		}
		match = func(d sim.DueEvent) bool { return d.IslandID == p.IslandID && d.BuildingID == p.BuildingID }
		bmatch = func(b sim.Boundary) bool { return b.IslandID == p.IslandID && b.BuildingID == p.BuildingID }
	case KindShipArrived:
		var p store.ShipArrivedPayload
		if err := json.Unmarshal(ev.Payload, &p); err != nil {
			return fmt.Errorf("%s payload: %w", ev.Kind, err)
		}
		match = func(d sim.DueEvent) bool { return d.ShipID == p.ShipID }
		bmatch = func(b sim.Boundary) bool { return b.ShipID == p.ShipID }
	default:
		return fmt.Errorf("unexpected kind %q", ev.Kind)
	}
	for _, d := range sim.DueEvents(w) {
		if d.Kind == ev.Kind && match(d) && !d.At.After(ev.DueAt) {
			return fmt.Errorf("%s: world %s still carries the due moment at %s", ev.Kind, id, d.At)
		}
	}
	applied := false
	for _, b := range hc.Boundaries[id] {
		if b.Kind == ev.Kind && b.At.Equal(ev.DueAt) && bmatch(b) {
			applied = true
		}
	}
	if !applied {
		hc.Logger.Info("events: no due moment applied at due_at (stale or already applied); no-op",
			"event_id", ev.ID, "kind", ev.Kind, "world_id", string(id))
	}
	return hc.ReconcileDueEvents()
}
