package sim

import (
	"cmp"
	"fmt"
	"slices"

	"github.com/ricoberger/new-shores/server/internal/content"
)

// Patrol (D-077 §6, MECHANICS §9.1): an idle ship patrols an island of
// its region — settled or not, warships and cargo ships alike — along a
// coast loop the server builds once at the start (coastLoop). The ship
// sails its approach (from where it lay to the loop's first point), then
// round the loop for ever at its speed; the client places it from the
// stored polylines, their times and the start (no boundary events:
// nothing changes while it patrols). unassign_ship ends the patrol: the
// ship idles at the patrolled island, at the loop point nearest the
// island's harbour (StopAt). An insolvency pause ends it the same way
// (anchored_unpaid). Upkeep is paid as usual.

// ShipPatrolling is the state of a patrolling ship (D-077 §6).
const ShipPatrolling = "patrolling"

// patrolOffset is how far (tiles, Chebyshev) the coast loop keeps from
// the island's land: 2 beyond the shallows (ShallowsReach).
const patrolOffset = ShallowsReach + 2

// Patrol is the patrol of a ship (Ship.Patrol): its island, start, the
// approach and the closed loop (archipelago tiles; Loop's last point
// connects back to its first) with their travel times at the ship's
// speed, and the point the ship stops at.
type Patrol struct {
	IslandID    string `json:"island_id"`
	StartedAtMs int64  `json:"started_at_ms"`
	// Approach is the voyage from the ship's position to Loop[0] (both
	// ends included); ApproachMs its travel time.
	Approach   []Pos `json:"approach"`
	ApproachMs int64 `json:"approach_ms"`
	// Loop is the coast loop starting at the point nearest the ship;
	// LoopMs the time of one round (closing segment included).
	Loop   []Pos `json:"loop"`
	LoopMs int64 `json:"loop_ms"`
	// StopAt is where the ship idles when the patrol ends: the loop
	// point nearest the island's harbour at the start (Loop[0] without
	// one).
	StopAt Pos `json:"stop_at"`
}

func (p *Patrol) clone() *Patrol {
	c := *p
	c.Approach = slices.Clone(p.Approach)
	c.Loop = slices.Clone(p.Loop)
	return &c
}

// StartPatrol sends an idle ship to patrol an island of its region.
type StartPatrol struct {
	ShipID   int64
	IslandID string
}

func (StartPatrol) isCommand() {}

func startPatrol(w *World, c *content.Catalogue, cmd StartPatrol) error {
	s, err := idleShip(w, cmd.ShipID)
	if err != nil {
		return err
	}
	is := w.Island(cmd.IslandID)
	if is == nil {
		return fmt.Errorf("%w: unknown island %q", ErrRouteInvalid, cmd.IslandID)
	}
	if scenic(is, c) {
		return fmt.Errorf("%w: %q is a skerry", ErrRouteInvalid, is.ID)
	}
	if shipRegionID(w, s) != is.RegionID {
		return fmt.Errorf("%w: %q lies in another region", ErrRouteInvalid, is.ID)
	}
	def := c.ShipByID[s.Type]
	if def == nil {
		return fmt.Errorf("%w: %q", ErrUnknownShipType, s.Type)
	}
	start, ok := shipPosition(w, c, s, is)
	if !ok {
		return fmt.Errorf("%w: ship %d has no position", ErrShipNotIdle, s.ID)
	}
	loop := coastLoop(w, c, is)
	if len(loop) < 3 {
		return fmt.Errorf("%w: no patrol loop round %q", ErrRouteInvalid, is.ID)
	}
	loop = rotateTo(loop, nearestIndex(loop, start))
	stop := loop[0]
	if h, ok := harbour(c, is); ok {
		stop = loop[nearestIndex(loop, h)]
	}
	rate := c.Region.Rules.ShipSpeedMilliTilesPerMin
	approach, approachMs := Voyage(w, c, def.SpeedPermille, start, loop[0])
	now := w.LastEvaluatedAt.UnixMilli()
	s.Patrol = &Patrol{
		IslandID: is.ID, StartedAtMs: now,
		Approach: approach, ApproachMs: approachMs,
		Loop: loop, LoopMs: PathMs(append(slices.Clone(loop), loop[0]), def.SpeedPermille, rate),
		StopAt: stop,
	}
	s.State = ShipPatrolling
	s.RegionID = is.RegionID
	s.IslandID, s.AtSea, s.Offshore = "", nil, nil
	return nil
}

// stopPatrol ends a patrol: the ship idles at the patrolled island,
// offshore at the patrol's stop point.
func stopPatrol(s *Ship) {
	p := s.Patrol
	stop := p.StopAt
	s.State = ShipIdle
	s.IslandID, s.Offshore, s.Patrol = p.IslandID, &stop, nil
}

// shipPosition is where an idle ship lies (archipelago tiles): at sea, its
// offshore point, else its island's harbour or the shore nearest the
// target island.
func shipPosition(w *World, c *content.Catalogue, s *Ship, target *Island) (Pos, bool) {
	switch {
	case s.AtSea != nil:
		return *s.AtSea, true
	case s.Offshore != nil:
		return *s.Offshore, true
	}
	from := w.Island(s.IslandID)
	if from == nil {
		return Pos{}, false
	}
	if h, ok := harbour(c, from); ok {
		return h, true
	}
	return shore(c, from, Pos{target.X + target.Width/2, target.Y + target.Height/2}), true
}

// PatrolLoop is coastLoop for tests and tools outside the package.
func PatrolLoop(w *World, c *content.Catalogue, is *Island) []Pos { return coastLoop(w, c, is) }

// coastLoop is the patrol loop round an island (archipelago tiles,
// closed implicitly): the convex hull of its land for ships (seaLand)
// grown by patrolOffset tiles in each direction (a square per land tile,
// so every hull edge keeps at least patrolOffset tiles, Chebyshev, from
// the island's land), corners on another island's land dropped, and
// every edge that is not clear water (another island, a skerry) replaced
// by the sea route round it (seaRoute, string-pulled). Integer-only and
// deterministic; nil for an island without land.
func coastLoop(w *World, c *content.Catalogue, is *Island) []Pos {
	if len(is.Tiles) != is.Width*is.Height {
		return nil
	}
	decks := shoreDecks(c, is)
	var pts []Pos
	for y := range is.Height {
		first, last := -1, -1
		for x := range is.Width {
			if seaLand(is, decks, x, y) {
				if first < 0 {
					first = x
				}
				last = x
			}
		}
		if first < 0 {
			continue
		}
		for _, x := range []int{first, last} {
			ax, ay := is.X+x, is.Y+y
			pts = append(pts,
				Pos{ax - patrolOffset, ay - patrolOffset}, Pos{ax + patrolOffset, ay - patrolOffset},
				Pos{ax - patrolOffset, ay + patrolOffset}, Pos{ax + patrolOffset, ay + patrolOffset})
		}
	}
	hull := convexHull(pts)
	if len(hull) < 3 {
		return nil
	}
	lo := Pos{is.X - patrolOffset - 1, is.Y - patrolOffset - 1}
	hi := Pos{is.X + is.Width + patrolOffset, is.Y + is.Height + patrolOffset}
	g := w.seaGridFor(c, lo, hi)
	corners := hull[:0:0]
	for _, p := range hull {
		if !g.landAt(p.X, p.Y) {
			corners = append(corners, p)
		}
	}
	if len(corners) < 3 {
		return nil
	}
	loop := make([]Pos, 0, len(corners))
	for i, a := range corners {
		loop = append(loop, a)
		loop = append(loop, seaRoute(g, a, corners[(i+1)%len(corners)])...)
	}
	return loop
}

// convexHull is the convex hull of the points (Andrew's monotone chain,
// integer cross products): counter-clockwise in tile coordinates (y
// down: clockwise on screen), starting at the smallest point (x, then
// y), without collinear points.
func convexHull(pts []Pos) []Pos {
	p := slices.Clone(pts)
	slices.SortFunc(p, func(a, b Pos) int { return cmp.Or(cmp.Compare(a.X, b.X), cmp.Compare(a.Y, b.Y)) })
	p = slices.Compact(p)
	if len(p) < 3 {
		return p
	}
	cross := func(o, a, b Pos) int { return (a.X-o.X)*(b.Y-o.Y) - (a.Y-o.Y)*(b.X-o.X) }
	h := make([]Pos, 0, 2*len(p))
	for _, q := range p {
		for len(h) >= 2 && cross(h[len(h)-2], h[len(h)-1], q) <= 0 {
			h = h[:len(h)-1]
		}
		h = append(h, q)
	}
	for i, t := len(p)-2, len(h)+1; i >= 0; i-- {
		q := p[i]
		for len(h) >= t && cross(h[len(h)-2], h[len(h)-1], q) <= 0 {
			h = h[:len(h)-1]
		}
		h = append(h, q)
	}
	return h[:len(h)-1]
}

// nearestIndex is the index of the point nearest to q (squared
// Euclidean; ties: the lowest index).
func nearestIndex(pts []Pos, q Pos) int {
	best, bestD := 0, -1
	for i, p := range pts {
		if d := sq(p.X-q.X) + sq(p.Y-q.Y); bestD < 0 || d < bestD {
			best, bestD = i, d
		}
	}
	return best
}

// rotateTo returns the closed loop starting at index i.
func rotateTo(loop []Pos, i int) []Pos {
	return append(slices.Clone(loop[i:]), loop[:i]...)
}
