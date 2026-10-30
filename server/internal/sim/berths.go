package sim

import (
	"cmp"
	"slices"

	"github.com/ricoberger/new-shores/server/internal/content"
)

// Berth rules (refining MECHANICS §9.2–9.3, D-051):
//
//   - The Trading Post of an island has berths per level. A ship that
//     arrives to unload or load (a route ship at a matching stop, a ship
//     ending a manual leg) enters the island's berth queue
//     (waiting_for_berth) and is granted a berth in FIFO order (arrival
//     time, then ship ID) as soon as one is free; the arrival effects
//     (unload, load) apply at the grant. The grant is the ship's next due
//     moment (ship_arrived): at its arrival when a berth is free, else at
//     the earliest moment an occupied berth frees.
//   - A granted ship holds its berth for the handling time (base + per unit
//     moved, handlingMs): a route ship until its departure, a ship ending a
//     manual leg until its unloading is done (it is manual_leg without a
//     leg meanwhile and becomes idle afterwards).
//   - An island without a Trading Post has no pier: ships arriving there
//     handle at once and hold no berth (route ships at a stop on an island
//     whose Trading Post was demolished; ships sailing to found).
//   - A route ship at an island without a matching stop departs at once
//     (positioning leg) and never queues.
//   - A paused ship is not granted a berth: at its grant it anchors
//     (anchored_unpaid) and leaves the queue; resuming queues it again.
//   - Loading for a manual shipment happens at the ship's mooring when the
//     command is given and holds no berth (berths gate arrivals).

// ShipWaitingForBerth is the state of a ship queued at an island's
// Trading Post for a free berth (MECHANICS §9.3).
const ShipWaitingForBerth = "waiting_for_berth"

// berthTotal is the number of berths of an island: those of its Trading
// Post's level plus those of its trading piers (D-060), stored on the
// buildings (Building.Berths, set at placement and upgrade from the
// content); 0 without a Trading Post.
func berthTotal(is *Island) int {
	n := 0
	for _, b := range is.Buildings {
		n += b.Berths
	}
	return n
}

// berthHolders returns the ships holding a berth at the island at now
// (BerthUntilMs > now), by ascending ID.
func berthHolders(w *World, islandID string, now int64) []*Ship {
	var out []*Ship
	for _, s := range w.Ships {
		if s.IslandID == islandID && s.BerthUntilMs > now {
			out = append(out, s)
		}
	}
	return out
}

// berthQueue returns the ships waiting for a berth at the island in FIFO
// order (arrival time, then ship ID).
func berthQueue(w *World, islandID string) []*Ship {
	var out []*Ship
	for _, s := range w.Ships {
		if s.State == ShipWaitingForBerth && s.IslandID == islandID {
			out = append(out, s)
		}
	}
	slices.SortFunc(out, func(a, b *Ship) int { return cmp.Or(cmp.Compare(a.QueuedAtMs, b.QueuedAtMs), cmp.Compare(a.ID, b.ID)) })
	return out
}

// berthGrantAt returns the due moment of the head of an island's berth
// queue (the ship and the grant time): its arrival when the island has no
// pier or a berth is free, else the earliest release of a held berth. ok
// is false for an empty queue.
func berthGrantAt(w *World, islandID string) (*Ship, int64, bool) {
	q := berthQueue(w, islandID)
	if len(q) == 0 {
		return nil, 0, false
	}
	head := q[0]
	is := w.Island(islandID)
	if is == nil {
		return head, head.QueuedAtMs, true
	}
	total := berthTotal(is)
	var until []int64
	for _, s := range w.Ships {
		if s.IslandID == islandID && s.BerthUntilMs > 0 {
			until = append(until, s.BerthUntilMs)
		}
	}
	if total == 0 || len(until) < total {
		return head, head.QueuedAtMs, true
	}
	slices.Sort(until)
	// The (len-total+1)-th release frees the first berth for the queue.
	return head, max(head.QueuedAtMs, until[len(until)-total]), true
}

// queueForBerth puts a ship into the berth queue of the island it is at.
func queueForBerth(s *Ship, island string, now int64) {
	s.State = ShipWaitingForBerth
	s.IslandID = island
	s.Leg = nil
	s.QueuedAtMs = now
}

// needsBerth reports whether a ship at an island handles cargo there: a
// route ship at a stop of its route, any other ship (it unloads).
func needsBerth(w *World, s *Ship, island string) bool {
	if s.RouteID == 0 {
		return true
	}
	r := w.Route(s.RouteID)
	if r == nil {
		return true
	}
	for _, st := range r.Stops {
		if st.IslandID == island {
			return true
		}
	}
	return false
}

// arriveAt makes a ship that is at island (after a leg, an assignment or a
// resume) handle there: a route ship without a matching stop departs at
// once; every other ship queues for a berth (granted at once when one is
// free, by applyDue).
func arriveAt(w *World, c *content.Catalogue, s *Ship, island string, now int64, l *Ledger) {
	if s.RouteID != 0 && !needsBerth(w, s, island) {
		if r := w.Route(s.RouteID); r != nil {
			handleStop(w, c, s, r, island, now, l)
			return
		}
	}
	queueForBerth(s, island, now)
}

// grantBerth gives the waiting ship a berth at now and applies its arrival
// effects (MECHANICS §9.2–9.3): a paused ship anchors instead; a route ship
// handles its stop and holds the berth until its departure; any other
// ship unloads everything (capacity permitting) and holds the berth for
// the handling time, then becomes idle (normalizeShips).
func grantBerth(w *World, c *content.Catalogue, s *Ship, now int64, l *Ledger) {
	island := s.IslandID
	s.QueuedAtMs = 0
	if is := w.Island(island); is != nil && berthTotal(is) > 0 {
		s.Offshore = nil
	}
	if s.Paused {
		s.State = ShipAnchoredUnpaid
		return
	}
	pier := false
	if is := w.Island(island); is != nil {
		pier = berthTotal(is) > 0
	}
	if r := w.Route(s.RouteID); s.RouteID != 0 && r != nil {
		handleStop(w, c, s, r, island, now, l)
		if pier && s.Leg != nil && s.Leg.DepartAtMs > now {
			s.BerthUntilMs = s.Leg.DepartAtMs
		}
		return
	}
	s.RouteID, s.StopIndex = 0, 0
	moved := unloadAll(w, c, s, now, l)
	if !pier {
		s.State = ShipIdle
		return
	}
	s.State = ShipManualLeg
	s.BerthUntilMs = now + handlingMs(c, moved)
}
