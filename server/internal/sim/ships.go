package sim

import (
	"cmp"
	"fmt"
	"math/bits"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/ricoberger/new-shores/server/internal/content"
)

// Ship rules (refining MECHANICS §8 and §9, D-015).
//
//   - A shipyard (building with a shipyard block) holds at most one order.
//     The cost is deducted at order time; the ship appears idle at the
//     shipyard's island at the order's due time (ship_built).
//   - A ship is in exactly one place: idle and anchored_unpaid ships have an
//     island and no leg; on_route and manual_leg ships have a leg. While a
//     ship is handling at a stop (now < DepartAtMs) its island is the leg's
//     origin; while travelling it has no island.
//   - Cargo: Slots slots of SlotSize milli-units; a slot holds one good and a
//     good may use several slots. Cargo is stored canonically per good
//     (sorted by good ID): full slots, then at most one partial slot, which
//     is what "fill partially filled slots first, then empty slots" yields.
//     Amounts aboard are whole milli-units.
//   - Due moments (ship_built at the order's due time, ship_arrived at the
//     leg's arrival) are Advance boundaries: their effect is applied by
//     Advance at exactly that millisecond (applyDue, called from
//     settleWorld), before regimes and insolvency are settled. Scheduled
//     events only make sure that offline worlds are evaluated on time.
//   - Arrival with a route (R-22): the stop at StopIndex if it is at the
//     arrival island, else the first stop at that island searching
//     cyclically from StopIndex; unload the stop's unload goods (limited by
//     free committed capacity, the excess stays aboard), then load each load
//     good up to its max amount aboard (limited by whole milli-units of
//     stock and slot space), StopIndex = matched+1 and depart after the
//     handling time. Without a matching stop the ship departs at once to
//     stop 0 (positioning leg). Arrival without a route unloads everything
//     (respecting capacity) and ends idle. A paused ship anchors on
//     arrival (anchored_unpaid) without unloading.
//   - Ships pay upkeep while not paused; every unpaused ship with upkeep is
//     an insolvency candidate of step 4 (economy.go).

// Ship states (MECHANICS §9.1).
const (
	ShipIdle           = "idle"
	ShipOnRoute        = "on_route"
	ShipManualLeg      = "manual_leg"
	ShipAnchoredUnpaid = "anchored_unpaid"
	// ShipOnWorldMap is reserved for world-map voyages; never produced.
	ShipOnWorldMap = "on_world_map"
)

// Due event kinds reported by DueEvents; they are also Advance boundary
// kinds.
const (
	DueShipBuilt   = "ship_built"
	DueShipArrived = "ship_arrived"
)

// Boundary kinds of the due moments (identical to the due event kinds).
const (
	BoundaryShipBuilt   = DueShipBuilt
	BoundaryShipArrived = DueShipArrived
)

// ShipOrder is the pending order of a shipyard.
type ShipOrder struct {
	// Type is the content ship ID.
	Type        string `json:"type"`
	OrderedAtMs int64  `json:"ordered_at_ms"`
	DueAtMs     int64  `json:"due_at_ms"`
}

// Ship is a ship of the world.
type Ship struct {
	ID int64 `json:"id"`
	// Type is the content ship ID.
	Type string `json:"type"`
	// Name is the ship's name: "<ship type name> <ID>" from its creation
	// until the player renames it (rename_ship; empty restores the default).
	Name  string `json:"name"`
	State string `json:"state"`
	// IslandID is where the ship is ("" while travelling or at sea).
	IslandID string `json:"island_id,omitempty"`
	// AtSea is the archipelago position (tiles) of an idle ship that is at
	// no island: the start ship of a new world (D-051); nil otherwise.
	AtSea *Pos `json:"at_sea,omitempty"`
	// RouteID is the assigned route (0 when none).
	RouteID int64 `json:"route_id,omitempty"`
	// StopIndex is the index of the route stop the ship is heading to.
	StopIndex int    `json:"stop_index,omitempty"`
	Leg       *Leg   `json:"leg,omitempty"`
	Cargo     []Slot `json:"cargo,omitempty"`
	Paused    bool   `json:"paused,omitempty"`
	// PausedReason is PausedReasonUnpaid for an insolvency pause.
	PausedReason string `json:"paused_reason,omitempty"`
	PauseSeq     int64  `json:"pause_seq,omitempty"`
	PausedAtMs   int64  `json:"paused_at_ms,omitempty"`
	// QueuedAtMs is the time (Unix ms) the ship entered the berth queue of
	// its island (state waiting_for_berth, berths.go); 0 otherwise.
	QueuedAtMs int64 `json:"queued_at_ms,omitempty"`
	// BerthUntilMs is the end (Unix ms) of the ship's handling at a berth
	// of its island: the departure of a route ship, the end of unloading
	// after a manual leg; 0 when the ship holds no berth.
	BerthUntilMs int64 `json:"berth_until_ms,omitempty"`
}

// Leg is a voyage between two islands: the ship handles cargo at the origin
// until DepartAtMs and arrives at ArriveAtMs (Unix milliseconds).
type Leg struct {
	// FromIsland is the origin island; "" for a leg from a sea position
	// (From).
	FromIsland string `json:"from_island"`
	ToIsland   string `json:"to_island"`
	DepartAtMs int64  `json:"depart_at_ms"`
	ArriveAtMs int64  `json:"arrive_at_ms"`
	// From is the archipelago origin (tiles) of a leg that starts at sea;
	// nil for a leg from an island.
	From *Pos `json:"from,omitempty"`
	// Path is the voyage (archipelago tiles, D-058 §5): from the origin's
	// harbour (or From) around land to the destination's (Ends, SeaRoute);
	// its length sets the travel time (PathMs).
	Path []Pos `json:"path,omitempty"`
}

// Slot is one cargo slot holding Amount milli-units of Good.
type Slot struct {
	Good   string `json:"good"`
	Amount Qty    `json:"amount"`
}

func (s *Ship) clone() *Ship {
	c := *s
	if s.Leg != nil {
		l := *s.Leg
		if l.From != nil {
			p := *l.From
			l.From = &p
		}
		l.Path = slices.Clone(l.Path)
		c.Leg = &l
	}
	if s.AtSea != nil {
		p := *s.AtSea
		c.AtSea = &p
	}
	if s.Cargo != nil {
		c.Cargo = append([]Slot(nil), s.Cargo...)
	}
	return &c
}

// Ship returns the ship with the given ID or nil.
func (w *World) Ship(id int64) *Ship {
	for _, s := range w.Ships {
		if s.ID == id {
			return s
		}
	}
	return nil
}

// DefaultShipName is a ship's name until it is renamed: its content type's
// name and its ID ("Sloop 2"; the type ID for a type the catalogue lacks).
func DefaultShipName(c *content.Catalogue, typ string, id int64) string {
	name := typ
	if def := c.ShipByID[typ]; def != nil && def.Name != "" {
		name = def.Name
	}
	return name + " " + strconv.FormatInt(id, 10)
}

func renameShip(w *World, c *content.Catalogue, cmd RenameShip) error {
	s, err := lookupShip(w, cmd.ShipID)
	if err != nil {
		return err
	}
	name := strings.TrimSpace(cmd.Name)
	if name == "" {
		s.Name = DefaultShipName(c, s.Type, s.ID)
		return nil
	}
	if err := content.CheckShipName(name); err != nil {
		return fmt.Errorf("%w: %v", ErrInvalidName, err)
	}
	s.Name = name
	return nil
}

func lookupShip(w *World, id int64) (*Ship, error) {
	s := w.Ship(id)
	if s == nil {
		return nil, fmt.Errorf("%w: %d", ErrShipNotFound, id)
	}
	return s, nil
}

// settled reports whether an island has a Trading Post (derived, D-051).
// Unsettled islands have capacity 0.
func settled(is *Island, c *content.Catalogue) bool {
	tp, _ := tradingPost(is, c)
	return tp != nil
}

// isqrt returns floor(sqrt(n)).
func isqrt(n uint64) uint64 {
	if n < 2 {
		return n
	}
	x := uint64(1) << ((bits.Len64(n) + 1) / 2) // >= sqrt(n)
	for {
		y := (x + n/x) / 2
		if y >= x {
			return x
		}
		x = y
	}
}

// maxCoord bounds archipelago coordinates so that the travel time
// arithmetic cannot overflow.
const maxCoord = 1_000_000

// TravelMs is the travel time in milliseconds between two archipelago
// positions (in tiles) for a ship of speed speedPermille (1000 = 1.0) at
// the reference speed milliTilesPerMin (region rule
// ship_speed_tiles_per_min in milli-tiles per minute):
//
//	distance_milli = ceil(1000 * sqrt(dx^2 + dy^2))
//	travel_ms      = ceil(distance_milli * 60 000 * 1000 / (speedPermille * milliTilesPerMin))
//
// at least 1 ms. It uses integer arithmetic only, so the result is
// identical on every platform; this is the single definition of the travel
// time used by legs and loop times.
func TravelMs(fromX, fromY, toX, toY int, speedPermille, milliTilesPerMin int64) int64 {
	return milliToMs(distMilli(fromX, fromY, toX, toY), speedPermille, milliTilesPerMin)
}

// travel is the path and travel time between the harbours of two
// islands for a ship type (voyage).
func travel(w *World, c *content.Catalogue, speedPermille int64, from, to *Island) ([]Pos, int64) {
	a, b := Ends(c, from, to)
	return Voyage(w, c, speedPermille, a, b)
}

// shipTravel is the path and travel time of ship s between two islands.
func shipTravel(w *World, c *content.Catalogue, s *Ship, from, to string) ([]Pos, int64) {
	a, b := w.Island(from), w.Island(to)
	def := c.ShipByID[s.Type]
	if a == nil || b == nil || def == nil {
		return nil, 1
	}
	return travel(w, c, def.SpeedPermille, a, b)
}

// cargoAmounts returns the amount aboard per good.
func cargoAmounts(s *Ship) map[string]Qty {
	out := map[string]Qty{}
	for _, sl := range s.Cargo {
		out[sl.Good] += sl.Amount
	}
	return out
}

// slotsUsed is the number of slots the amounts occupy.
func slotsUsed(amounts map[string]Qty, size Qty) int {
	n := 0
	for _, a := range amounts {
		if a > 0 {
			n += int(ceilDiv(a, size))
		}
	}
	return n
}

// setCargo stores the amounts in canonical slots (goods sorted by ID, full
// slots then one partial slot per good).
func setCargo(s *Ship, size Qty, amounts map[string]Qty) {
	var slots []Slot
	for _, g := range sortedKeys(amounts) {
		for a := amounts[g]; a > 0; a -= min(a, size) {
			slots = append(slots, Slot{Good: g, Amount: min(a, size)})
		}
	}
	s.Cargo = slots
}

// cargoRoom is how much more of good fits aboard: the free slots plus the
// room of the good's partial slot.
func cargoRoom(amounts map[string]Qty, good string, size Qty, slots int) Qty {
	room := Qty(max(slots-slotsUsed(amounts, size), 0)) * size
	if r := amounts[good] % size; r != 0 {
		room += size - r
	}
	return room
}

// freeMilli is the free committed capacity of a good in whole milli-units.
func freeMilli(is *Island, c *content.Catalogue, good string, now int64) Qty {
	return max(capacityFine(is, c)-committedFine(is, good, now), 0) / SubPerMilli
}

// handlingMs is the time a ship occupies a berth for moving the given
// milli-units (unloaded plus loaded): ship_handling_base_seconds +
// ship_handling_seconds_per_unit x units, rounded up to whole milliseconds
// (MECHANICS §9.2, D-051).
func handlingMs(c *content.Catalogue, moved Qty) int64 {
	r := c.Region.Rules
	return r.ShipHandlingBaseMs + ceilDiv(r.ShipHandlingMsPerUnit*max(moved, 0), content.MilliPerUnit)
}

// unloadGood moves up to the amount aboard of good into the island
// inventory, limited by the free committed capacity; the excess stays
// aboard. It returns the unloaded milli-units.
func unloadGood(is *Island, c *content.Catalogue, amounts map[string]Qty, good string, now int64, l *Ledger) Qty {
	take := min(amounts[good], freeMilli(is, c, good, now))
	if take <= 0 {
		return 0
	}
	is.Inventory.setFine(good, is.Inventory.fine(good)+take*SubPerMilli)
	amounts[good] -= take
	if amounts[good] == 0 {
		delete(amounts, good)
	}
	l.flow(is.ID, good).Unloaded += take * SubPerMilli
	return take
}

// unloadAll unloads every good aboard into the ship's island (R-23) and
// returns the unloaded milli-units.
func unloadAll(w *World, c *content.Catalogue, s *Ship, now int64, l *Ledger) Qty {
	is := w.Island(s.IslandID)
	def := c.ShipByID[s.Type]
	if is == nil || def == nil || len(s.Cargo) == 0 {
		return 0
	}
	amounts := cargoAmounts(s)
	var moved Qty
	for _, g := range sortedKeys(amounts) {
		moved += unloadGood(is, c, amounts, g, now, l)
	}
	setCargo(s, def.SlotSize, amounts)
	clearRegimes(is)
	return moved
}

// depart sets the ship's leg and its location (the origin until the
// departure, nothing afterwards).
func depart(s *Ship, leg Leg, now int64) {
	s.Leg = &leg
	s.IslandID = leg.FromIsland
	if leg.DepartAtMs <= now {
		s.IslandID = ""
	}
}

// handleStop performs the stop handling of a route ship at island (R-22):
// match the stop, unload, load, and depart to the next stop after the
// handling time; without a matching stop it departs at once to stop 0.
func handleStop(w *World, c *content.Catalogue, s *Ship, r *Route, island string, now int64, l *Ledger) {
	n := len(r.Stops)
	s.State = ShipOnRoute
	s.IslandID = island
	if n == 0 {
		s.State = ShipIdle
		s.RouteID, s.StopIndex = 0, 0
		return
	}
	start := ((s.StopIndex % n) + n) % n
	matched := -1
	for k := range n {
		if i := (start + k) % n; r.Stops[i].IslandID == island {
			matched = i
			break
		}
	}
	if matched < 0 {
		s.StopIndex = 0
		to := r.Stops[0].IslandID
		path, ms := shipTravel(w, c, s, island, to)
		depart(s, Leg{FromIsland: island, ToIsland: to, DepartAtMs: now, ArriveAtMs: now + ms, Path: path}, now)
		return
	}
	stop := r.Stops[matched]
	var moved Qty
	if is, def := w.Island(island), c.ShipByID[s.Type]; is != nil && def != nil {
		amounts := cargoAmounts(s)
		for _, g := range stop.Unload {
			moved += unloadGood(is, c, amounts, g, now, l)
		}
		for _, lr := range stop.Load {
			want := lr.MaxAmount - amounts[lr.Good]
			take := min(want, is.Inventory.Stock[lr.Good], cargoRoom(amounts, lr.Good, def.SlotSize, def.Slots))
			if take <= 0 {
				continue
			}
			is.Inventory.setFine(lr.Good, is.Inventory.fine(lr.Good)-take*SubPerMilli)
			amounts[lr.Good] += take
			moved += take
			l.flow(is.ID, lr.Good).Loaded += take * SubPerMilli
		}
		setCargo(s, def.SlotSize, amounts)
		clearRegimes(is)
	}
	s.StopIndex = (matched + 1) % n
	to := r.Stops[s.StopIndex].IslandID
	dep := now + handlingMs(c, moved)
	path, ms := shipTravel(w, c, s, island, to)
	depart(s, Leg{FromIsland: island, ToIsland: to, DepartAtMs: dep, ArriveAtMs: dep + ms, Path: path}, now)
}

// DueEvent is a pending due moment of a world: a shipyard order completes
// (ship_built) or a ship arrives (ship_arrived: the end of its leg, or the
// grant of a berth to the head of an island's berth queue).
type DueEvent struct {
	Kind string    `json:"kind"`
	At   time.Time `json:"at"`
	// IslandID and BuildingID identify the shipyard (ship_built).
	IslandID   string `json:"island_id,omitempty"`
	BuildingID int64  `json:"building_id,omitempty"`
	// ShipID identifies the ship (ship_arrived).
	ShipID int64 `json:"ship_id,omitempty"`
}

type dueEvent struct {
	DueEvent
	atMs int64
}

func dueList(w *World) []dueEvent {
	var out []dueEvent
	for _, is := range w.Islands {
		for _, b := range is.Buildings {
			if b.Order != nil {
				out = append(out, dueEvent{DueEvent{Kind: DueShipBuilt, IslandID: is.ID, BuildingID: b.ID}, b.Order.DueAtMs})
			}
		}
	}
	for _, s := range w.Ships {
		if s.Leg != nil {
			out = append(out, dueEvent{DueEvent{Kind: DueShipArrived, ShipID: s.ID}, s.Leg.ArriveAtMs})
		}
	}
	// The head of every berth queue: its grant (berths.go).
	queued := map[string]bool{}
	for _, s := range w.Ships {
		if s.State != ShipWaitingForBerth || queued[s.IslandID] {
			continue
		}
		queued[s.IslandID] = true
		if head, at, ok := berthGrantAt(w, s.IslandID); ok {
			out = append(out, dueEvent{DueEvent{Kind: DueShipArrived, ShipID: head.ID}, at})
		}
	}
	slices.SortFunc(out, func(a, b dueEvent) int {
		return cmp.Or(cmp.Compare(a.atMs, b.atMs), cmp.Compare(a.Kind, b.Kind), cmp.Compare(a.IslandID, b.IslandID),
			cmp.Compare(a.BuildingID, b.BuildingID), cmp.Compare(a.ShipID, b.ShipID))
	})
	for i := range out {
		out[i].At = time.UnixMilli(out[i].atMs).UTC()
	}
	return out
}

// DueEvents returns the pending due moments of the world sorted by (At,
// Kind, IDs): every shipyard order (ship_built at its due time), every
// ship leg (ship_arrived at its arrival) and the head of every berth queue
// (ship_arrived at its berth grant). After Advance(w, t) every due moment
// is strictly after t.
func DueEvents(w *World) []DueEvent {
	list := dueList(w)
	out := make([]DueEvent, len(list))
	for i, e := range list {
		out[i] = e.DueEvent
	}
	return out
}

// applyDue applies every due moment at or before now in due order and
// returns them. Advance stops at every due moment, so they are always
// exactly at now.
func applyDue(w *World, c *content.Catalogue, now int64, l *Ledger) []dueEvent {
	var applied []dueEvent
	for {
		var due []dueEvent
		for _, e := range dueList(w) {
			if e.atMs <= now {
				due = append(due, e)
			}
		}
		if len(due) == 0 {
			return applied
		}
		for _, e := range due {
			applyDueEvent(w, c, e, now, l)
		}
		applied = append(applied, due...)
	}
}

// applyDueEvent applies one due moment if the world still carries it.
func applyDueEvent(w *World, c *content.Catalogue, e dueEvent, now int64, l *Ledger) bool {
	switch e.Kind {
	case DueShipBuilt:
		is := w.Island(e.IslandID)
		if is == nil {
			return false
		}
		b := is.Building(e.BuildingID)
		if b == nil || b.Order == nil || b.Order.DueAtMs != e.atMs {
			return false
		}
		applyShipBuilt(w, c, is, b)
		return true
	case DueShipArrived:
		s := w.Ship(e.ShipID)
		switch {
		case s == nil:
			return false
		case s.Leg != nil && s.Leg.ArriveAtMs == e.atMs:
			applyShipArrival(w, c, s, now, l)
			return true
		case s.State == ShipWaitingForBerth:
			head, at, ok := berthGrantAt(w, s.IslandID)
			if !ok || head != s || at != e.atMs {
				return false
			}
			grantBerth(w, c, s, now, l)
			return true
		}
	}
	return false
}

// ApplyDueEvent applies a due moment at the world's evaluation time
// (w.LastEvaluatedAt must equal ev.At). It is a no-op when the world no
// longer carries the due moment (already applied by Advance, scrapped ship,
// cancelled order). It reports whether the effect was applied.
func ApplyDueEvent(w *World, c *content.Catalogue, ev DueEvent) (bool, error) {
	if !truncMs(ev.At).Equal(w.LastEvaluatedAt) {
		return false, fmt.Errorf("%w: due event at %s, world evaluated at %s", ErrInvalidCommand,
			ev.At.Format(timeLayout), w.LastEvaluatedAt.Format(timeLayout))
	}
	now := w.LastEvaluatedAt.UnixMilli()
	ok := applyDueEvent(w, c, dueEvent{ev, now}, now, nil)
	if ok {
		applyDue(w, c, now, nil)
		normalizeShips(w, now)
		evaluateUnlocks(w, c)
		evaluateQuests(w, c, now, nil)
	}
	return ok, nil
}

// applyShipBuilt completes the order of shipyard b: the ship appears idle at
// the shipyard's island.
func applyShipBuilt(w *World, c *content.Catalogue, is *Island, b *Building) {
	typ := b.Order.Type
	b.Order = nil
	if w.NextShipID < 1 {
		w.NextShipID = 1
	}
	w.Ships = append(w.Ships, &Ship{ID: w.NextShipID, Type: typ, Name: DefaultShipName(c, typ, w.NextShipID), State: ShipIdle, IslandID: is.ID})
	w.NextShipID++
	clearRegimes(is)
}

// applyShipArrival ends the ship's leg at its destination (R-22 – R-24):
// a paused ship anchors; every other ship handles there (arriveAt: queue
// for a berth, or depart at once without a matching route stop).
func applyShipArrival(w *World, c *content.Catalogue, s *Ship, now int64, l *Ledger) {
	dest := s.Leg.ToIsland
	w.Away.addArrival(s, dest, now)
	s.Leg = nil
	s.IslandID = dest
	if s.RouteID != 0 && w.Route(s.RouteID) == nil {
		s.RouteID, s.StopIndex = 0, 0
	}
	if s.Paused {
		s.State = ShipAnchoredUnpaid
	} else {
		arriveAt(w, c, s, dest, now, l)
	}
	if is := w.Island(dest); is != nil {
		clearRegimes(is)
	}
}

// normalizeShips applies departures and berth releases: a ship whose
// handling time is over has left its island (with a leg) or, after the
// unloading of a manual leg, is idle there (anchored when paused).
func normalizeShips(w *World, now int64) {
	for _, s := range w.Ships {
		if s.Leg != nil && s.Leg.DepartAtMs <= now {
			s.IslandID = ""
			s.BerthUntilMs = 0
		}
		if s.Leg == nil && s.BerthUntilMs > 0 && s.BerthUntilMs <= now {
			s.BerthUntilMs = 0
			if s.State == ShipManualLeg {
				s.State = ShipIdle
				if s.Paused {
					s.State = ShipAnchoredUnpaid
				}
			}
		}
	}
}

// resumeShip resumes an unpaid ship at now (R-29): an anchored ship with a
// route handles its stop (queueing for a berth) and departs; without a
// route it becomes idle; a ship on a leg, waiting or handling simply
// continues.
func resumeShip(w *World, c *content.Catalogue, s *Ship, now int64, l *Ledger) {
	s.Paused, s.PausedReason, s.PauseSeq, s.PausedAtMs = false, "", 0, 0
	if s.State != ShipAnchoredUnpaid {
		return
	}
	if r := w.Route(s.RouteID); s.RouteID != 0 && r != nil {
		arriveAt(w, c, s, s.IslandID, now, l)
		return
	}
	s.RouteID, s.StopIndex = 0, 0
	s.State = ShipIdle
}

// pauseShip pauses a ship for insolvency (R-27, R-28).
func pauseShip(s *Ship, seq, now int64) {
	s.Paused, s.PausedReason, s.PauseSeq, s.PausedAtMs = true, PausedReasonUnpaid, seq, now
	if s.State == ShipIdle {
		s.State = ShipAnchoredUnpaid
	}
}

// shipUpkeep is the upkeep of every unpaused ship (gold sub-units per ms).
func shipUpkeep(w *World, c *content.Catalogue) int64 {
	var up int64
	for _, s := range w.Ships {
		if def := c.ShipByID[s.Type]; def != nil && !s.Paused {
			up += def.UpkeepPerMin
		}
	}
	return up
}

func removeShip(w *World, id int64) {
	out := w.Ships[:0]
	for _, s := range w.Ships {
		if s.ID != id {
			out = append(out, s)
		}
	}
	if len(out) == 0 {
		out = nil
	}
	w.Ships = out
}

// Ship commands.

// OrderShip orders a ship at a shipyard (R-31).
type OrderShip struct {
	IslandID   string
	BuildingID int64
	ShipType   string
}

// CancelShipOrder cancels a shipyard's pending order; 50 % of the
// materials are refunded (R-32).
type CancelShipOrder struct {
	IslandID   string
	BuildingID int64
}

// FoundIsland settles an unsettled island with a Trading Post built from
// the cargo of an idle ship there (R-33, D-051).
type FoundIsland struct {
	ShipID       int64
	IslandID     string
	BuildingType string
	X, Y         int
	Rotation     int
}

// AssignShip assigns an idle ship to a route (R-37).
type AssignShip struct {
	ShipID  int64
	RouteID int64
}

// UnassignShip removes a ship from its route (R-38).
type UnassignShip struct {
	ShipID int64
}

// CargoAmount is an amount of a good in milli-units.
type CargoAmount struct {
	Good   string
	Amount Qty
}

// ManualShipment sends an idle ship with cargo from its island to another
// island (R-39).
type ManualShipment struct {
	ShipID     int64
	ToIslandID string
	Cargo      []CargoAmount
}

// ScrapShip removes an idle or anchored ship (R-40).
type ScrapShip struct {
	ShipID int64
}

// RenameShip renames a ship in any state (D-055); the name is trimmed, an
// empty name restores the default ("<ship type name> <ID>"), any other
// must have 1 to content.MaxShipNameRunes printable runes.
type RenameShip struct {
	ShipID int64
	Name   string
}

// SailShip sends an idle ship with its cargo (nothing is loaded) from its
// island or its sea position to another island (D-051: the start ship
// sails to the island the player chooses). It arrives like a manual
// shipment: at a settled island it unloads at a berth; at an unsettled one
// everything stays aboard (for found_island).
type SailShip struct {
	ShipID     int64
	ToIslandID string
}

func (OrderShip) isCommand()       {}
func (CancelShipOrder) isCommand() {}
func (FoundIsland) isCommand()     {}
func (AssignShip) isCommand()      {}
func (UnassignShip) isCommand()    {}
func (ManualShipment) isCommand()  {}
func (ScrapShip) isCommand()       {}
func (SailShip) isCommand()        {}
func (RenameShip) isCommand()      {}

func shipyardBuilding(w *World, c *content.Catalogue, islandID string, id int64) (*Island, *Building, *content.Building, error) {
	is, err := lookupIsland(w, islandID)
	if err != nil {
		return nil, nil, nil, err
	}
	b := is.Building(id)
	if b == nil {
		return nil, nil, nil, fmt.Errorf("%w: building %d on island %q", ErrBuildingNotFound, id, islandID)
	}
	def := c.BuildingByID[b.Type]
	if def == nil || def.Shipyard == nil {
		return nil, nil, nil, fmt.Errorf("%w: %s", ErrNotAShipyard, b.Type)
	}
	return is, b, def, nil
}

func orderShip(w *World, c *content.Catalogue, cmd OrderShip, l *Ledger) error {
	is, b, def, err := shipyardBuilding(w, c, cmd.IslandID, cmd.BuildingID)
	if err != nil {
		return err
	}
	ship := c.ShipByID[cmd.ShipType]
	if ship == nil || !slices.Contains(def.Shipyard.Ships, cmd.ShipType) {
		return fmt.Errorf("%w: %q at %s", ErrUnknownShipType, cmd.ShipType, b.Type)
	}
	if b.AssignedWarehouseID == 0 {
		return fmt.Errorf("%w: %s %d", ErrNotConnected, b.Type, b.ID)
	}
	if b.Order != nil {
		return fmt.Errorf("%w: %s %d builds a %s", ErrShipyardBusy, b.Type, b.ID, b.Order.Type)
	}
	if !TierUnlocked(w, c, ship.Tier) {
		return fmt.Errorf("%w: %s needs tier %s", ErrTierLocked, ship.ID, ship.Tier)
	}
	if err := checkCost(w, is, ship.Cost, 1); err != nil {
		return err
	}

	chargeCost(w, is, ship.Cost, 1, l)
	now := w.LastEvaluatedAt.UnixMilli()
	b.Order = &ShipOrder{Type: ship.ID, OrderedAtMs: now, DueAtMs: now + ship.BuildMs}
	clearRegimes(is)
	return nil
}

// refundOrder refunds 50 % of the materials of a pending order into the
// shipyard's island (clamped, excess lost).
func refundOrder(is *Island, c *content.Catalogue, o *ShipOrder, l *Ledger, now int64) {
	if ship := c.ShipByID[o.Type]; ship != nil {
		refund(is, c, ship.Cost, 1, l, now)
	}
}

func cancelShipOrder(w *World, c *content.Catalogue, cmd CancelShipOrder, l *Ledger) error {
	is, b, _, err := shipyardBuilding(w, c, cmd.IslandID, cmd.BuildingID)
	if err != nil {
		return err
	}
	if b.Order == nil {
		return fmt.Errorf("%w: %s %d", ErrNoShipOrder, b.Type, b.ID)
	}
	refundOrder(is, c, b.Order, l, w.LastEvaluatedAt.UnixMilli())
	b.Order = nil
	clearRegimes(is)
	return nil
}

// idleShip returns the ship if it is idle (R-12: then it is at an island).
func idleShip(w *World, id int64) (*Ship, error) {
	s, err := lookupShip(w, id)
	if err != nil {
		return nil, err
	}
	if s.State != ShipIdle {
		return nil, fmt.Errorf("%w: ship %d is %s", ErrShipNotIdle, s.ID, s.State)
	}
	return s, nil
}

func foundIsland(w *World, c *content.Catalogue, cmd FoundIsland, l *Ledger) error {
	s, err := idleShip(w, cmd.ShipID)
	if err != nil {
		return err
	}
	is, err := lookupIsland(w, cmd.IslandID)
	if err != nil {
		return err
	}
	if s.IslandID != is.ID {
		return fmt.Errorf("%w: ship %d is at %q, not %q", ErrShipNotIdle, s.ID, s.IslandID, is.ID)
	}
	if settled(is, c) {
		return fmt.Errorf("%w: %q", ErrIslandAlreadySettled, is.ID)
	}
	def := c.BuildingByID[cmd.BuildingType]
	if def == nil {
		return fmt.Errorf("%w: %q", ErrUnknownBuilding, cmd.BuildingType)
	}
	if def.TradingPost == nil {
		return fmt.Errorf("%w: %s has no trading_post block", ErrInvalidCommand, def.ID)
	}
	if !TierUnlocked(w, c, def.Tier) {
		return fmt.Errorf("%w: %s needs tier %s", ErrTierLocked, def.ID, def.Tier)
	}
	if !validRotation(cmd.Rotation) {
		return fmt.Errorf("%w: rotation %d", ErrInvalidCommand, cmd.Rotation)
	}
	if err := checkSite(is, c, is.occupancy(c), def, cmd.X, cmd.Y, cmd.Rotation, true); err != nil {
		return err
	}
	if def.Cost.Gold > w.Gold {
		return fmt.Errorf("%w: need %d, have %d milli-gold", ErrInsufficientGold, def.Cost.Gold, w.Gold)
	}
	amounts := cargoAmounts(s)
	var missing []string
	for _, m := range def.Cost.Materials {
		if amounts[m.Good] < m.Amount {
			missing = append(missing, fmt.Sprintf("%s (need %d, aboard %d milli-units)", m.Good, m.Amount, amounts[m.Good]))
		}
	}
	if len(missing) > 0 {
		return fmt.Errorf("%w: %v", ErrCargoInsufficient, missing)
	}
	ship := c.ShipByID[s.Type]
	if ship == nil {
		return fmt.Errorf("%w: %q", ErrUnknownShipType, s.Type)
	}

	// Validation complete: mutate.
	w.Gold -= def.Cost.Gold
	for _, m := range def.Cost.Materials {
		amounts[m.Good] -= m.Amount
		if amounts[m.Good] == 0 {
			delete(amounts, m.Good)
		}
		f := l.flow(is.ID, m.Good)
		f.Unloaded += m.Amount * SubPerMilli
		f.Spent += m.Amount * SubPerMilli
	}
	setCargo(s, ship.SlotSize, amounts)
	if err := placeBuilding(w, c, PlaceBuilding{IslandID: is.ID, Type: def.ID, X: cmd.X, Y: cmd.Y, Rotation: cmd.Rotation}, false, l); err != nil {
		return err // unreachable: the site was validated above
	}
	unloadAll(w, c, s, w.LastEvaluatedAt.UnixMilli(), l)
	return nil
}

func assignShip(w *World, c *content.Catalogue, cmd AssignShip, l *Ledger) error {
	s, err := idleShip(w, cmd.ShipID)
	if err != nil {
		return err
	}
	r, err := lookupRoute(w, cmd.RouteID)
	if err != nil {
		return err
	}
	if len(r.Stops) == 0 {
		return fmt.Errorf("%w: route %d has no stops", ErrRouteInvalid, r.ID)
	}
	now := w.LastEvaluatedAt.UnixMilli()
	s.RouteID = r.ID
	s.StopIndex = 0 // first occurrence of the island
	if p := s.AtSea; p != nil && s.IslandID == "" {
		// From the sea: a positioning leg to stop 0.
		to := w.Island(r.Stops[0].IslandID)
		def := c.ShipByID[s.Type]
		if to == nil || def == nil {
			return fmt.Errorf("%w: route %d", ErrRouteInvalid, r.ID)
		}
		s.State, s.AtSea = ShipOnRoute, nil
		path, ms := Voyage(w, c, def.SpeedPermille, *p, Arrival(c, *p, to))
		depart(s, Leg{From: &Pos{p.X, p.Y}, ToIsland: to.ID, DepartAtMs: now, ArriveAtMs: now + ms, Path: path}, now)
		return nil
	}
	arriveAt(w, c, s, s.IslandID, now, l)
	return nil
}

func unassignShip(w *World, cmd UnassignShip) error {
	s, err := lookupShip(w, cmd.ShipID)
	if err != nil {
		return err
	}
	if s.RouteID == 0 {
		return fmt.Errorf("%w: ship %d", ErrShipNotOnRoute, s.ID)
	}
	s.RouteID, s.StopIndex = 0, 0
	if s.Leg != nil {
		s.State = ShipManualLeg
	}
	return nil
}

// maxShipmentEntries bounds the cargo list of a manual shipment.
const maxShipmentEntries = 64

func manualShipment(w *World, c *content.Catalogue, cmd ManualShipment, l *Ledger) error {
	s, err := idleShip(w, cmd.ShipID)
	if err != nil {
		return err
	}
	from := w.Island(s.IslandID)
	if from == nil {
		return fmt.Errorf("%w: ship %d has no island", ErrShipNotIdle, s.ID)
	}
	to := w.Island(cmd.ToIslandID)
	if to == nil {
		return fmt.Errorf("%w: unknown destination %q", ErrRouteInvalid, cmd.ToIslandID)
	}
	if to == from {
		return fmt.Errorf("%w: destination %q is the ship's island", ErrRouteInvalid, to.ID)
	}
	ship := c.ShipByID[s.Type]
	if ship == nil {
		return fmt.Errorf("%w: %q", ErrUnknownShipType, s.Type)
	}
	if len(cmd.Cargo) > maxShipmentEntries {
		return fmt.Errorf("%w: %d cargo entries", ErrInvalidCommand, len(cmd.Cargo))
	}
	amounts := cargoAmounts(s)
	seen := map[string]bool{}
	for _, ca := range cmd.Cargo {
		switch {
		case c.GoodByID[ca.Good] == nil:
			return fmt.Errorf("%w: unknown good %q", ErrInvalidCommand, ca.Good)
		case seen[ca.Good]:
			return fmt.Errorf("%w: duplicate good %q", ErrInvalidCommand, ca.Good)
		case ca.Amount <= 0:
			return fmt.Errorf("%w: amount of %s must be > 0 milli-units", ErrInvalidCommand, ca.Good)
		case ca.Amount > from.Inventory.Stock[ca.Good]:
			return fmt.Errorf("%w: need %d %s, have %d (milli-units)", ErrInsufficientMaterials, ca.Amount, ca.Good, from.Inventory.Stock[ca.Good])
		}
		seen[ca.Good] = true
		amounts[ca.Good] += ca.Amount
	}
	if len(amounts) == 0 {
		return fmt.Errorf("%w: nothing to ship", ErrInvalidCommand)
	}
	if used := slotsUsed(amounts, ship.SlotSize); used > ship.Slots {
		return fmt.Errorf("%w: needs %d of %d slots", ErrCargoExceedsSlots, used, ship.Slots)
	}

	now := w.LastEvaluatedAt.UnixMilli()
	var moved Qty
	for _, ca := range cmd.Cargo {
		from.Inventory.setFine(ca.Good, from.Inventory.fine(ca.Good)-ca.Amount*SubPerMilli)
		l.flow(from.ID, ca.Good).Loaded += ca.Amount * SubPerMilli
		moved += ca.Amount
	}
	setCargo(s, ship.SlotSize, amounts)
	s.State = ShipManualLeg
	dep := now + handlingMs(c, moved)
	path, ms := travel(w, c, ship.SpeedPermille, from, to)
	depart(s, Leg{FromIsland: from.ID, ToIsland: to.ID, DepartAtMs: dep, ArriveAtMs: dep + ms, Path: path}, now)
	clearRegimes(from)
	return nil
}

// LaunchShipAtSea adds an idle ship of the given type at a sea position
// (archipelago tiles) with the given cargo (milli-units per good) and
// returns it. The founding cargo is exempt from the slot limit (D-056 §9:
// the 2-slot start sloop carries the whole start stock); slots limit only
// what a player loads. Like PlaceFree it is meant for world creation (the
// start ship of a new world, D-051), never for player commands.
func LaunchShipAtSea(w *World, c *content.Catalogue, typ string, at Pos, cargo map[string]Qty) (*Ship, error) {
	def := c.ShipByID[typ]
	if def == nil {
		return nil, fmt.Errorf("%w: %q", ErrUnknownShipType, typ)
	}
	if at.X < -maxCoord || at.X > maxCoord || at.Y < -maxCoord || at.Y > maxCoord {
		return nil, fmt.Errorf("%w: sea position (%d,%d)", ErrOutOfBounds, at.X, at.Y)
	}
	amounts := map[string]Qty{}
	for _, g := range sortedKeys(cargo) {
		switch {
		case c.GoodByID[g] == nil:
			return nil, fmt.Errorf("%w: unknown good %q", ErrInvalidCommand, g)
		case cargo[g] < 0:
			return nil, fmt.Errorf("%w: negative cargo of %s", ErrInvalidCommand, g)
		case cargo[g] > 0:
			amounts[g] = cargo[g]
		}
	}
	if w.NextShipID < 1 {
		w.NextShipID = 1
	}
	s := &Ship{ID: w.NextShipID, Type: def.ID, Name: DefaultShipName(c, def.ID, w.NextShipID), State: ShipIdle, AtSea: &Pos{at.X, at.Y}}
	setCargo(s, def.SlotSize, amounts)
	w.NextShipID++
	w.Ships = append(w.Ships, s)
	return s, nil
}

func sailShip(w *World, c *content.Catalogue, cmd SailShip) error {
	s, err := idleShip(w, cmd.ShipID)
	if err != nil {
		return err
	}
	to := w.Island(cmd.ToIslandID)
	if to == nil {
		return fmt.Errorf("%w: unknown destination %q", ErrRouteInvalid, cmd.ToIslandID)
	}
	if to.ID == s.IslandID {
		return fmt.Errorf("%w: destination %q is the ship's island", ErrRouteInvalid, to.ID)
	}
	ship := c.ShipByID[s.Type]
	if ship == nil {
		return fmt.Errorf("%w: %q", ErrUnknownShipType, s.Type)
	}
	now := w.LastEvaluatedAt.UnixMilli()
	leg := Leg{FromIsland: s.IslandID, ToIsland: to.ID, DepartAtMs: now}
	switch from := w.Island(s.IslandID); {
	case from != nil:
		path, ms := travel(w, c, ship.SpeedPermille, from, to)
		leg.ArriveAtMs, leg.Path = now+ms, path
	case s.AtSea != nil:
		p := *s.AtSea
		leg.From = &p
		path, ms := Voyage(w, c, ship.SpeedPermille, p, Arrival(c, p, to))
		leg.ArriveAtMs, leg.Path = now+ms, path
	default:
		return fmt.Errorf("%w: ship %d has no position", ErrShipNotIdle, s.ID)
	}
	s.State = ShipManualLeg
	s.AtSea = nil
	depart(s, leg, now)
	return nil
}

func scrapShip(w *World, c *content.Catalogue, cmd ScrapShip, l *Ledger) error {
	s, err := lookupShip(w, cmd.ShipID)
	if err != nil {
		return err
	}
	if s.State != ShipIdle && s.State != ShipAnchoredUnpaid {
		return fmt.Errorf("%w: ship %d is %s", ErrShipNotIdle, s.ID, s.State)
	}
	is := w.Island(s.IslandID)
	if is == nil {
		return fmt.Errorf("%w: ship %d has no island", ErrShipNotIdle, s.ID)
	}
	now := w.LastEvaluatedAt.UnixMilli()
	amounts := cargoAmounts(s)
	for _, g := range sortedKeys(amounts) {
		a := amounts[g]
		take := min(a, freeMilli(is, c, g, now))
		is.Inventory.setFine(g, is.Inventory.fine(g)+take*SubPerMilli)
		f := l.flow(is.ID, g)
		f.Unloaded += a * SubPerMilli
		f.Lost += (a - take) * SubPerMilli
	}
	if ship := c.ShipByID[s.Type]; ship != nil {
		refund(is, c, ship.Cost, 1, l, now)
	}
	removeShip(w, s.ID)
	clearRegimes(is)
	return nil
}
