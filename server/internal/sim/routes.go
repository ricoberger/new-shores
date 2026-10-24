package sim

import (
	"fmt"
	"slices"
	"strconv"
	"unicode/utf8"

	"github.com/ricoberger/new-shores/server/internal/content"
)

// Route rules (refining MECHANICS §9.2, D-015). A route is an ordered loop
// of 2–8 stops at settled islands; consecutive stops (including last ->
// first) are different islands. Each stop lists goods to unload and goods
// to load "up to" a maximum amount aboard (top-up semantics). Routes can be
// edited while ships are assigned; the ships keep their current leg and
// resolve their stop at arrival (R-22). A route with assigned ships cannot
// be deleted.

// Route limits.
const (
	MinRouteStops    = 2
	MaxRouteStops    = 8
	MaxRouteNameLen  = 40
	maxStopGoodsList = 64
)

// Route is a loop of stops that assigned ships sail forever.
type Route struct {
	ID    int64  `json:"id"`
	Name  string `json:"name"`
	Stops []Stop `json:"stops"`
}

// Stop is one stop of a route.
type Stop struct {
	IslandID string     `json:"island_id"`
	Load     []LoadRule `json:"load,omitempty"`
	// Unload lists the goods unloaded at the stop.
	Unload []string `json:"unload,omitempty"`
}

// LoadRule loads Good until MaxAmount milli-units are aboard.
type LoadRule struct {
	Good      string `json:"good"`
	MaxAmount Qty    `json:"max_amount"`
}

func (r *Route) clone() *Route {
	c := *r
	c.Stops = cloneStops(r.Stops)
	return &c
}

func cloneStops(stops []Stop) []Stop {
	if stops == nil {
		return nil
	}
	out := make([]Stop, len(stops))
	for i, s := range stops {
		out[i] = Stop{IslandID: s.IslandID}
		if s.Load != nil {
			out[i].Load = append([]LoadRule(nil), s.Load...)
		}
		if s.Unload != nil {
			out[i].Unload = append([]string(nil), s.Unload...)
		}
	}
	return out
}

// Route returns the route with the given ID or nil.
func (w *World) Route(id int64) *Route {
	for _, r := range w.Routes {
		if r.ID == id {
			return r
		}
	}
	return nil
}

func lookupRoute(w *World, id int64) (*Route, error) {
	r := w.Route(id)
	if r == nil {
		return nil, fmt.Errorf("%w: %d", ErrRouteNotFound, id)
	}
	return r, nil
}

// CreateRoute creates a route (R-36). An empty name becomes "Route <ID>".
type CreateRoute struct {
	Name  string
	Stops []Stop
}

// UpdateRoute replaces the name and stops of a route; allowed with assigned
// ships (R-36).
type UpdateRoute struct {
	RouteID int64
	Name    string
	Stops   []Stop
}

// DeleteRoute deletes a route without assigned ships (R-36).
type DeleteRoute struct {
	RouteID int64
}

func (CreateRoute) isCommand() {}
func (UpdateRoute) isCommand() {}
func (DeleteRoute) isCommand() {}

// validateRoute checks the route rules of R-14.
func validateRoute(w *World, c *content.Catalogue, name string, stops []Stop) error {
	invalid := func(format string, args ...any) error {
		return fmt.Errorf("%w: %s", ErrRouteInvalid, fmt.Sprintf(format, args...))
	}
	if n := utf8.RuneCountInString(name); n > MaxRouteNameLen || !utf8.ValidString(name) {
		return invalid("name longer than %d characters", MaxRouteNameLen)
	}
	if len(stops) < MinRouteStops || len(stops) > MaxRouteStops {
		return invalid("%d stops, want %d to %d", len(stops), MinRouteStops, MaxRouteStops)
	}
	for i, st := range stops {
		is := w.Island(st.IslandID)
		switch {
		case is == nil:
			return invalid("stop %d: unknown island %q", i, st.IslandID)
		case !settled(is, c):
			return invalid("stop %d: island %q is not settled", i, st.IslandID)
		case stops[(i+1)%len(stops)].IslandID == st.IslandID:
			return invalid("stops %d and %d are both at %q", i, (i+1)%len(stops), st.IslandID)
		case len(st.Load) > maxStopGoodsList || len(st.Unload) > maxStopGoodsList:
			return invalid("stop %d: too many goods", i)
		}
		loads := map[string]bool{}
		for _, lr := range st.Load {
			switch {
			case c.GoodByID[lr.Good] == nil:
				return invalid("stop %d: unknown good %q", i, lr.Good)
			case loads[lr.Good]:
				return invalid("stop %d: %s loaded twice", i, lr.Good)
			case lr.MaxAmount <= 0 || lr.MaxAmount%content.MilliPerUnit != 0:
				return invalid("stop %d: max amount of %s must be a whole number of units > 0", i, lr.Good)
			}
			loads[lr.Good] = true
		}
		unloads := map[string]bool{}
		for _, g := range st.Unload {
			switch {
			case c.GoodByID[g] == nil:
				return invalid("stop %d: unknown good %q", i, g)
			case unloads[g]:
				return invalid("stop %d: %s unloaded twice", i, g)
			case loads[g]:
				return invalid("stop %d: %s is both loaded and unloaded", i, g)
			}
			unloads[g] = true
		}
	}
	return nil
}

func routeName(name string, id int64) string {
	if name == "" {
		return "Route " + strconv.FormatInt(id, 10)
	}
	return name
}

func createRoute(w *World, c *content.Catalogue, cmd CreateRoute) error {
	if err := validateRoute(w, c, cmd.Name, cmd.Stops); err != nil {
		return err
	}
	if w.NextRouteID < 1 {
		w.NextRouteID = 1
	}
	id := w.NextRouteID
	w.NextRouteID++
	w.Routes = append(w.Routes, &Route{ID: id, Name: routeName(cmd.Name, id), Stops: cloneStops(cmd.Stops)})
	return nil
}

func updateRoute(w *World, c *content.Catalogue, cmd UpdateRoute) error {
	r, err := lookupRoute(w, cmd.RouteID)
	if err != nil {
		return err
	}
	if err := validateRoute(w, c, cmd.Name, cmd.Stops); err != nil {
		return err
	}
	r.Name, r.Stops = routeName(cmd.Name, r.ID), cloneStops(cmd.Stops)
	return nil
}

func deleteRoute(w *World, cmd DeleteRoute) error {
	r, err := lookupRoute(w, cmd.RouteID)
	if err != nil {
		return err
	}
	for _, s := range w.Ships {
		if s.RouteID == r.ID {
			return fmt.Errorf("%w: ship %d sails route %d", ErrRouteInUse, s.ID, r.ID)
		}
	}
	out := w.Routes[:0]
	for _, x := range w.Routes {
		if x.ID != r.ID {
			out = append(out, x)
		}
	}
	if len(out) == 0 {
		out = nil
	}
	w.Routes = out
	return nil
}

// routeLoopMs is the loop time of a route at reference speed 1.0: the base
// handling time of every stop (the per-unit part depends on the goods
// moved and is not estimated) plus the travel time of every leg including
// last -> first.
func routeLoopMs(w *World, c *content.Catalogue, r *Route) int64 {
	var total int64
	for i, st := range r.Stops {
		total += c.Region.Rules.ShipHandlingBaseMs
		a, b := w.Island(st.IslandID), w.Island(r.Stops[(i+1)%len(r.Stops)].IslandID)
		if a != nil && b != nil && a != b {
			total += travelMs(c, 1000, a, b)
		}
	}
	return total
}

// routeHold is the virtual hold of the route-effect estimate: the smallest
// slots × slot size among the ships assigned to the route or, when none is
// assigned, among the catalogue's ship types (0 when there are none).
func routeHold(w *World, c *content.Catalogue, r *Route) (hold Qty, assigned int64) {
	hold = -1
	for _, s := range w.Ships {
		if s.RouteID != r.ID {
			continue
		}
		assigned++
		if def := c.ShipByID[s.Type]; def != nil {
			if h := Qty(def.Slots) * def.SlotSize; hold < 0 || h < hold {
				hold = h
			}
		}
	}
	if hold < 0 {
		for _, def := range c.Ships {
			if h := Qty(def.Slots) * def.SlotSize; hold < 0 || h < hold {
				hold = h
			}
		}
	}
	return max(hold, 0), assigned
}

// routeEffect is the estimated net change of one good on one island per
// loop of a route (signed milli-units, positive when the island gains).
type routeEffect struct {
	IslandID string
	Good     string
	PerLoop  Qty
}

// routeEffects estimates the per-island, per-good net effect of one loop
// (display only, stock availability ignored): for each loaded good the
// stops are walked twice from stop 0 with an empty hold; a stop first
// unloads the good aboard, then tops it up to min(max, hold). The sums of
// the second pass are the per-loop effects. Entries are ordered by the
// first stop of their island, then by good; zero entries are omitted.
func routeEffects(r *Route, hold Qty) []routeEffect {
	goods := map[string]bool{}
	for _, st := range r.Stops {
		for _, lr := range st.Load {
			goods[lr.Good] = true
		}
	}
	sorted := make([]string, 0, len(goods))
	for g := range goods {
		sorted = append(sorted, g)
	}
	slices.Sort(sorted)
	var islands []string
	for _, st := range r.Stops {
		if !slices.Contains(islands, st.IslandID) {
			islands = append(islands, st.IslandID)
		}
	}
	sums := map[string]map[string]Qty{}
	for _, g := range sorted {
		var aboard Qty
		for pass := range 2 {
			for _, st := range r.Stops {
				var delta Qty
				if slices.Contains(st.Unload, g) {
					delta, aboard = aboard, 0
				}
				for _, lr := range st.Load {
					if lr.Good == g {
						load := max(0, min(lr.MaxAmount, hold)-aboard)
						delta -= load
						aboard += load
					}
				}
				if pass == 1 && delta != 0 {
					if sums[st.IslandID] == nil {
						sums[st.IslandID] = map[string]Qty{}
					}
					sums[st.IslandID][g] += delta
				}
			}
		}
	}
	var out []routeEffect
	for _, id := range islands {
		for _, g := range sorted {
			if q := sums[id][g]; q != 0 {
				out = append(out, routeEffect{IslandID: id, Good: g, PerLoop: q})
			}
		}
	}
	return out
}

// routePerMin converts a per-loop effect to milli-units per minute for the
// given number of assigned ships (truncated toward zero; 0 without ships
// or loop time).
func routePerMin(perLoop Qty, ships, loopMs int64) Qty {
	if ships == 0 || loopMs <= 0 {
		return 0
	}
	return perLoop * ships * 60_000 / loopMs
}
