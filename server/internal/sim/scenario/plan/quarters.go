package plan

import (
	"fmt"
	"slices"

	"github.com/ricoberger/new-shores/server/internal/content"
	"github.com/ricoberger/new-shores/server/internal/layout"
	"github.com/ricoberger/new-shores/server/internal/sim"
	"github.com/ricoberger/new-shores/server/internal/sim/scenario"
)

// Reservation kinds of a tile.
const (
	cellFree uint8 = iota
	// cellRegion is a quarter's house land: its houses and any road.
	cellRegion
	// cellPlot is a reserved civic plot: its building only.
	cellPlot
	// cellRoad is a plot's reserved road: roads only.
	cellRoad
)

// cells holds the reservations of one island.
type cells struct {
	w     int
	kind  []uint8
	owner []int // quarter index (1-based) of region and plot tiles
}

func (g *gen) cellsOf(is *sim.Island) *cells {
	cl := g.cells[is.ID]
	if cl == nil {
		cl = &cells{w: is.Width, kind: make([]uint8, is.Width*is.Height), owner: make([]int, is.Width*is.Height)}
		g.cells[is.ID] = cl
	}
	return cl
}

func (g *gen) cellsByID(island string) *cells { return g.cells[island] }

// free reports whether no tile of the footprint is reserved.
func (cl *cells) free(x, y, w, h int) bool {
	for ty := y; ty < y+h; ty++ {
		for tx := x; tx < x+w; tx++ {
			if cl.kind[ty*cl.w+tx] != cellFree {
				return false
			}
		}
	}
	return true
}

// plotFree reports whether a chain plot may take the footprint: free
// tiles or house land, none of it served land.
func (cl *cells) plotFree(x, y, w, h int, served map[int]bool) bool {
	for ty := y; ty < y+h; ty++ {
		for tx := x; tx < x+w; tx++ {
			i := ty*cl.w + tx
			if (cl.kind[i] != cellFree && cl.kind[i] != cellRegion) || served[i] {
				return false
			}
		}
	}
	return true
}

// quarter is a declared quarter of a run.
type quarter struct {
	spec     Quarter
	index    int
	reserved bool
	centre   sim.Pos
	plots    map[string]*plot
	region   int
	// houses lists the quarter's houses in placement order.
	houses []int64
	// ringHouses counts the houses of each ring.
	ringHouses []int
	// pools are the candidate tiles (nearest the centre first) of the
	// core house land and of each ring; sizes the tiles each keeps.
	pools [][]int
	sizes []int
	// part maps each marked tile of house land to its pool.
	part map[int]int
}

// refill marks the house land: each pool keeps its size in its free
// tiles nearest the centre (the core first, then the rings inner first);
// what a pool lacks, the next one holds.
func (q *quarter) refill(cl *cells) {
	order := []int{0}
	for k := len(q.pools) - 1; k >= 1; k-- {
		order = append(order, k)
	}
	short := 0 // tiles a pool lacks: the next (outer) pool holds them
	for _, k := range order {
		size := q.sizes[k] + short
		have := 0
		for _, t := range q.pools[k] {
			if have >= size {
				break
			}
			if p, ok := q.part[t]; ok && p == k && cl.kind[t] == cellRegion && cl.owner[t] == q.index {
				have++
			}
		}
		for _, t := range q.pools[k] {
			if have >= size {
				break
			}
			if cl.kind[t] == cellFree {
				cl.kind[t], cl.owner[t] = cellRegion, q.index
				q.part[t] = k
				have++
			}
		}
		short = size - have
	}
	q.region = 0
	for t, k := range cl.kind {
		if k == cellRegion && cl.owner[t] == q.index {
			q.region++
		}
	}
}

// coreLand lists the quarter's core house land (nearest the centre first).
func (q *quarter) coreLand(cl *cells) []int {
	var out []int
	for _, t := range q.pools[0] {
		if p, ok := q.part[t]; ok && p == 0 && cl.kind[t] == cellRegion && cl.owner[t] == q.index {
			out = append(out, t)
		}
	}
	return out
}

// coverLevel is the number of leading civic plots that cover a footprint.
func (q *quarter) coverLevel(c *content.Catalogue, x, y, w, h int) int {
	for n, typ := range q.spec.Civic {
		pl := q.plots[typ]
		if !covers(c.BuildingByID[typ], pl.x, pl.y, pl.rot, x, y, w, h, 0) {
			return n
		}
	}
	return len(q.spec.Civic)
}

// ringOver returns the ring a house at cover level n goes into: -1 for
// the core (every civic plot), -2 when no ring with room (with over: any
// ring) admits it.
func (q *quarter) ringOver(n int, over bool) int {
	if n == len(q.spec.Civic) {
		return -1
	}
	for i := len(q.spec.Rings) - 1; i >= 0; i-- {
		if r := q.spec.Rings[i]; r.Civic <= n && (over || q.ringHouses[i] < r.Houses) {
			return i
		}
	}
	return -2
}

// plot is a reserved civic plot and the road reserved to it.
type plot struct {
	typ   string
	x, y  int
	rot   int
	path  []sim.Pos
	built int64
	// reach marks a Reach plot (outside the house land).
	reach bool
}

// covers reports whether a plot's first-level service radius reaches the
// footprint [x, x+w) x [y, y+h) (nearest footprint tiles, as the sim's
// service coverage) when the radius is extended by slack.
func covers(def *content.Building, px, py, rot, x, y, w, h, slack int) bool {
	pw, ph := layout.Dims(def, rot)
	r := def.Service.RadiusAt(1) + slack
	dx := max(px-(x+w-1), 0, x-(px+pw-1))
	dy := max(py-(y+h-1), 0, y-(py+ph-1))
	return dx*dx+dy*dy <= r*r
}

// houseSlack extends the radius for house land: a house is covered when
// its nearest tile is in range, so its land reaches two tiles further.
const houseSlack = 2

// reserve lays out a quarter on its settled island: the first civic plot
// at the valid connectable site nearest to the anchor, every further plot
// at the site (among the nearest candidates) that keeps the most house
// land, which is the free land within the first-level radius of every
// plot; plots, their roads and the house land are reserved.
func (g *gen) reserve(q *quarter) error {
	island := q.spec.Island
	w := g.world()
	is := w.Island(island)
	cl := g.cellsOf(is)
	lp := g.planner(island, false)
	anchor := lp.TradingPostCentre(island)
	switch {
	case q.spec.At != nil:
		anchor = sim.Pos{X: q.spec.At[0], Y: q.spec.At[1]}
	case q.spec.Near != nil:
		anchor = g.roomiest(island, sim.Pos{X: q.spec.Near[0], Y: q.spec.Near[1]}, anchorNear)
	default:
		anchor = g.roomiest(island, anchor, anchorReach)
	}
	g.logf("quarter %s: anchor (%d,%d)", q.spec.ID, anchor.X, anchor.Y)
	v := lp.View(is)
	var region []int            // tile indices of the house land
	ringLand := map[int][]int{} // the house land of the rings' civic plots
	q.ringHouses = make([]int, len(q.spec.Rings))
	for i, typ := range q.spec.Civic {
		def := g.c.BuildingByID[typ]
		if def == nil || def.Service == nil {
			return fmt.Errorf("quarter %s: %q is not a public building", q.spec.ID, typ)
		}
		if q.plots[typ] != nil {
			return fmt.Errorf("quarter %s: %s reserved twice", q.spec.ID, typ)
		}
		reach := lp.Reachable(island)
		chk := sim.NewSiteChecker(is, g.c)
		type cand struct {
			s     layout.Site
			score int
		}
		var cands []cand
		// Further plots: every site whose radius reaches the centre plot.
		reachD := 0
		if i > 0 {
			cdef := g.c.BuildingByID[q.spec.Civic[0]]
			rr := 2 * (def.Service.RadiusAt(1) + cdef.Service.RadiusAt(1) + max(def.Width, def.Height, cdef.Width, cdef.Height))
			reachD = rr * rr
		}
		for _, s := range layout.Candidates(is, def, anchor) {
			if i == 0 && len(cands) > 0 {
				break
			}
			if i > 0 && s.D > reachD {
				break
			}
			fw, fh := layout.Dims(def, s.Rot)
			if !layout.Touches(is, reach, s.X, s.Y, fw, fh) || !cl.free(s.X, s.Y, fw, fh) || !chk.Valid(def, s.X, s.Y, s.Rot) {
				continue
			}
			score := 0
			for _, t := range region {
				tx, ty := t%is.Width, t/is.Width
				if covers(def, s.X, s.Y, s.Rot, tx, ty, 1, 1, houseSlack) && (tx < s.X || tx >= s.X+fw || ty < s.Y || ty >= s.Y+fh) {
					score++
				}
			}
			cands = append(cands, cand{s, score})
		}
		slices.SortStableFunc(cands, func(a, b cand) int { return b.score - a.score })
		clp := g.plotPlanner(lp, island)
		placed := false
		for _, cd := range cands {
			s := cd.s
			fw, fh := layout.Dims(def, s.Rot)
			path, ok := clp.RoadPath(island, s.X, s.Y, fw, fh)
			if !ok || g.cutsOff(lp, island, reach, s.X, s.Y, fw, fh) {
				continue
			}
			pl := &plot{typ: typ, x: s.X, y: s.Y, rot: s.Rot, path: path}
			q.plots[typ] = pl
			for ty := s.Y; ty < s.Y+fh; ty++ {
				for tx := s.X; tx < s.X+fw; tx++ {
					cl.kind[ty*cl.w+tx], cl.owner[ty*cl.w+tx] = cellPlot, q.index
				}
			}
			onPath := map[int]bool{}
			for _, t := range path {
				i := t.Y*cl.w + t.X
				onPath[i] = true
				if cl.kind[i] == cellFree || cl.kind[i] == cellRegion {
					// Also across an earlier quarter's house land.
					cl.kind[i] = cellRoad
				}
			}
			if i == 0 {
				q.centre = sim.Pos{X: s.X + fw/2, Y: s.Y + fh/2}
				r := def.Service.RadiusAt(1)
				r += houseSlack
				for ty := s.Y - r; ty < s.Y+fh+r; ty++ {
					for tx := s.X - r; tx < s.X+fw+r; tx++ {
						if is.InBounds(tx, ty) && v.Open(tx, ty) && cl.kind[ty*cl.w+tx] == cellFree && covers(def, s.X, s.Y, s.Rot, tx, ty, 1, 1, houseSlack) {
							region = append(region, ty*cl.w+tx)
						}
					}
				}
			} else {
				for _, r := range q.spec.Rings {
					if i == r.Civic {
						ringLand[i] = slices.Clone(region)
					}
				}
				region = slices.DeleteFunc(region, func(t int) bool {
					return cl.kind[t] != cellFree || onPath[t] || !covers(def, s.X, s.Y, s.Rot, t%cl.w, t/cl.w, 1, 1, houseSlack)
				})
			}
			placed = true
			break
		}
		if !placed {
			return fmt.Errorf("quarter %s: no connected plot for %s near (%d,%d)", q.spec.ID, typ, anchor.X, anchor.Y)
		}
	}
	// Each part of the house land keeps the tilesPerHouse tiles per house
	// it must hold nearest the centre; the rest stays free for industry
	// (and refills it when chain plots take some, refill).
	byCentre := func(tiles []int) []int {
		d := func(t int) int {
			dx, dy := t%cl.w-q.centre.X, t/cl.w-q.centre.Y
			return dx*dx + dy*dy
		}
		tiles = slices.Clone(tiles)
		slices.SortStableFunc(tiles, func(a, b int) int { return d(a) - d(b) })
		return tiles
	}
	coreHouses := q.spec.Houses
	for _, r := range q.spec.Rings {
		coreHouses -= r.Houses
	}
	q.pools = make([][]int, 1+len(q.spec.Rings))
	q.sizes = make([]int, 1+len(q.spec.Rings))
	q.part = map[int]int{}
	q.pools[0], q.sizes[0] = byCentre(region), coreHouses*tilesPerHouse
	for k := len(q.spec.Rings) - 1; k >= 0; k-- { // inner rings first
		r := q.spec.Rings[k]
		q.pools[k+1], q.sizes[k+1] = byCentre(ringLand[r.Civic]), r.Houses*tilesPerHouse
	}
	q.refill(cl)
	region = q.coreLand(cl)
	core := len(region)
	for _, typ := range q.spec.Reach {
		if err := g.reserveReach(q, lp, typ, region); err != nil {
			return err
		}
	}
	q.reserved = true
	g.debugMap(q, g.log)
	g.logf("quarter %s on %s: centre (%d,%d), %d plots, %d tiles of house land (%d in rings)", q.spec.ID, island, q.centre.X, q.centre.Y, len(q.plots), q.region, q.region-core)
	return nil
}

// reserveReach reserves a Reach plot: off the house land, at the valid
// connectable site within reach of the centre whose first-level radius
// covers the most house land (the nearest to the centre on ties). Its
// road is reserved, also across house land.
func (g *gen) reserveReach(q *quarter, lp *layout.Planner, typ string, region []int) error {
	island := q.spec.Island
	is := g.world().Island(island)
	cl := g.cellsOf(is)
	def := g.c.BuildingByID[typ]
	if def == nil || def.Service == nil {
		return fmt.Errorf("quarter %s: %q is not a public building", q.spec.ID, typ)
	}
	if q.plots[typ] != nil {
		return fmt.Errorf("quarter %s: %s reserved twice", q.spec.ID, typ)
	}
	reach := lp.Reachable(island)
	chk := sim.NewSiteChecker(is, g.c)
	rr := def.Service.RadiusAt(1) + 2*max(def.Width, def.Height) + g.c.BuildingByID[q.spec.Civic[0]].Service.RadiusAt(1)
	type cand struct {
		s            layout.Site
		score, grass int
	}
	var cands []cand
	for _, s := range layout.Candidates(is, def, q.centre) {
		if s.D > 4*rr*rr { // D is the doubled distance, squared
			break
		}
		fw, fh := layout.Dims(def, s.Rot)
		if !layout.Touches(is, reach, s.X, s.Y, fw, fh) || !cl.free(s.X, s.Y, fw, fh) || !chk.Valid(def, s.X, s.Y, s.Rot) {
			continue
		}
		score := 0
		for _, t := range region {
			if covers(def, s.X, s.Y, s.Rot, t%is.Width, t/is.Width, 1, 1, 0) {
				score++
			}
		}
		cands = append(cands, cand{s, score, grassTiles(is, s.X, s.Y, fw, fh)})
	}
	// The most covering sites first; among those within reachSlack of the
	// best, the fewest grass tiles first (fields need grass).
	slices.SortStableFunc(cands, func(a, b cand) int { return b.score - a.score })
	if len(cands) > 0 {
		good := cands[0].score - cands[0].score*reachSlack/100
		k := 0
		for k < len(cands) && cands[k].score >= good {
			k++
		}
		slices.SortStableFunc(cands[:k], func(a, b cand) int { return a.grass - b.grass })
	}
	clp := g.plotPlanner(lp, island)
	for _, cd := range cands {
		s := cd.s
		fw, fh := layout.Dims(def, s.Rot)
		path, ok := clp.RoadPath(island, s.X, s.Y, fw, fh)
		if !ok || g.cutsOff(lp, island, reach, s.X, s.Y, fw, fh) {
			continue
		}
		q.plots[typ] = &plot{typ: typ, x: s.X, y: s.Y, rot: s.Rot, path: path, reach: true}
		for ty := s.Y; ty < s.Y+fh; ty++ {
			for tx := s.X; tx < s.X+fw; tx++ {
				cl.kind[ty*cl.w+tx], cl.owner[ty*cl.w+tx] = cellPlot, q.index
			}
		}
		for _, t := range path {
			i := t.Y*cl.w + t.X
			if cl.kind[i] == cellRegion {
				q.region--
			}
			if cl.kind[i] == cellFree || cl.kind[i] == cellRegion {
				cl.kind[i] = cellRoad
			}
		}
		g.logf("quarter %s: %s covers %d of %d tiles of house land", q.spec.ID, typ, cd.score, len(region))
		return nil
	}
	return fmt.Errorf("quarter %s: no connected plot for %s near (%d,%d)", q.spec.ID, typ, q.centre.X, q.centre.Y)
}

// cutsOff reports whether reserving a plot (no roads across it) would cut
// more than maxCutOff open tiles off the reachable land.
func (g *gen) cutsOff(lp *layout.Planner, island string, before []bool, x, y, w, h int) bool {
	is := g.world().Island(island)
	cl := g.cellsOf(is)
	saved := make([]uint8, 0, w*h)
	for ty := y; ty < y+h; ty++ {
		for tx := x; tx < x+w; tx++ {
			saved = append(saved, cl.kind[ty*cl.w+tx])
			cl.kind[ty*cl.w+tx] = cellPlot
		}
	}
	after := lp.Reachable(island)
	k := 0
	for ty := y; ty < y+h; ty++ {
		for tx := x; tx < x+w; tx++ {
			cl.kind[ty*cl.w+tx] = saved[k]
			after[ty*cl.w+tx] = true // the plot itself is not cut off
			k++
		}
	}
	n := cutOff(is, before, after, lp.View(is))
	return n > maxCutOff
}

// grassTiles counts the grass tiles of a footprint.
func grassTiles(is *sim.Island, x, y, w, h int) int {
	n := 0
	for ty := y; ty < y+h; ty++ {
		for tx := x; tx < x+w; tx++ {
			if is.Tile(tx, ty).Terrain == content.TerrainGrass {
				n++
			}
		}
	}
	return n
}

// plotPlanner returns a planner on a world copy with the reserved plot
// roads laid: the road to a further plot may branch off them.
func (g *gen) plotPlanner(lp *layout.Planner, island string) *layout.Planner {
	cl := g.cellsByID(island)
	cw := g.world().Clone()
	cis := cw.Island(island)
	if cis.Roads == nil {
		cis.Roads = map[int]string{}
	}
	for t, k := range cl.kind {
		if k == cellRoad && cis.Roads[t] == "" {
			cis.Roads[t] = g.road
		}
	}
	clp := *lp
	clp.W = cw
	return &clp
}

// roomiest returns the tile within reach of from whose
// surroundings (Chebyshev radius anchorRadius) hold the most free land
// that is not forest (the nearest on ties): a quarter's default anchor.
func (g *gen) roomiest(island string, from sim.Pos, reach int) sim.Pos {
	is := g.world().Island(island)
	lp := g.planner(island, false)
	v := lp.View(is)
	w, h := is.Width, is.Height
	sat := make([]int, (w+1)*(h+1))
	for y := range h {
		for x := range w {
			c := 0
			if v.Free(x, y) && is.Tile(x, y).Terrain != content.TerrainForest {
				c = 1
			}
			sat[(y+1)*(w+1)+x+1] = c + sat[y*(w+1)+x+1] + sat[(y+1)*(w+1)+x] - sat[y*(w+1)+x]
		}
	}
	r := anchorRadius
	best, bestN, bestD := from, -1, 0
	for y := range h {
		for x := range w {
			d := (x-from.X)*(x-from.X) + (y-from.Y)*(y-from.Y)
			if d > reach*reach {
				continue
			}
			x0, y0, x1, y1 := max(0, x-r), max(0, y-r), min(w, x+r+1), min(h, y+r+1)
			n := sat[y1*(w+1)+x1] - sat[y0*(w+1)+x1] - sat[y1*(w+1)+x0] + sat[y0*(w+1)+x0]
			if n > bestN || (n == bestN && d < bestD) {
				best, bestN, bestD = sim.Pos{X: x, Y: y}, n, d
			}
		}
	}
	return best
}

// houseType is the content's first house type (settlers).
func (g *gen) houseType() *content.Building {
	for _, def := range g.c.Buildings {
		if def.House != nil {
			return def
		}
	}
	return nil
}

// house places a settler house on the quarter's house land: the site
// with the least distance from the centre plus pathWeight per new road
// tile; sites off the forest first.
func (g *gen) house(q *quarter) error {
	if !q.reserved {
		return fmt.Errorf("quarter %s: island %s not settled", q.spec.ID, q.spec.Island)
	}
	def := g.houseType()
	island := q.spec.Island
	is := g.world().Island(island)
	cl := g.cellsOf(is)
	clear(g.trialFails)
	// The passes: house land off the forest, all house land, and last the
	// free land next to it, in full rings too, when the house land has no
	// room left.
	for _, pass := range []struct{ spare, spill bool }{{true, false}, {false, false}, {false, true}} {
		spare := pass.spare
		lp := g.planner(island, spare)
		dists := lp.RoadDistances(island)
		before := lp.Reachable(island)
		chk := sim.NewSiteChecker(is, g.c)
		fw, fh := layout.Dims(def, 0)
		type cand struct {
			s     layout.Site
			score float64
		}
		var cands []cand
		for y := 0; y+fh <= is.Height; y++ {
			for x := 0; x+fw <= is.Width; x++ {
				if !cl.ownedRegion(x, y, fw, fh, q.index, pass.spill) || (spare && layout.CoversForest(is, x, y, fw, fh)) || !chk.Valid(def, x, y, 0) {
					continue
				}
				if q.ringOver(q.coverLevel(g.c, x, y, fw, fh), pass.spill) == -2 {
					g.trialFails["uncovered"]++
					continue
				}
				pd := ringDistance(is, dists, x, y, fw, fh)
				if pd < 0 {
					g.trialFails["no road"]++
					continue
				}
				centre := sim.Pos{X: x + fw/2, Y: y + fh/2}
				cands = append(cands, cand{layout.Site{X: x, Y: y}, dist(centre, q.centre) + pathWeight*float64(pd)})
			}
		}
		slices.SortStableFunc(cands, func(a, b cand) int { return cmpFloat(a.score, b.score) })
		for k, cd := range cands {
			if k >= maxHouseTrials {
				break
			}
			path, ok := lp.RoadPath(island, cd.s.X, cd.s.Y, fw, fh)
			if !ok {
				continue
			}
			if _, ok := g.trial(lp, before, island, def, cd.s, path); !ok {
				continue
			}
			id, err := g.place(island, def.ID, cd.s, path, nil)
			if err != nil {
				return err
			}
			q.houses = append(q.houses, id)
			if r := q.ringOver(q.coverLevel(g.c, cd.s.X, cd.s.Y, fw, fh), pass.spill); r >= 0 {
				q.ringHouses[r]++
			}
			if len(q.houses) == q.spec.Houses {
				// The quarter holds all its houses: its unused house land
				// is free for other buildings.
				for i, k := range cl.kind {
					if k == cellRegion && cl.owner[i] == q.index {
						cl.kind[i] = cellFree
					}
				}
			}
			return nil
		}
	}
	return fmt.Errorf("quarter %s full after %d houses (%d tiles of house land, trial failures %v)", q.spec.ID, len(q.houses), q.region, g.trialFails)
}

// ownedRegion reports whether the footprint lies on the quarter's house
// land, or with spill also on free land.
func (cl *cells) ownedRegion(x, y, w, h, owner int, spill bool) bool {
	for ty := y; ty < y+h; ty++ {
		for tx := x; tx < x+w; tx++ {
			if i := ty*cl.w + tx; (cl.kind[i] != cellRegion || cl.owner[i] != owner) && (!spill || cl.kind[i] != cellFree) {
				return false
			}
		}
	}
	return true
}

// plot returns a quarter's reserved plot.
func (g *gen) plot(c *Civic) (*quarter, *plot, error) {
	q := g.quarters[c.Quarter]
	if q == nil {
		return nil, nil, fmt.Errorf("unknown quarter %q", c.Quarter)
	}
	pl := q.plots[c.Type]
	if pl == nil {
		return nil, nil, fmt.Errorf("quarter %s reserves no %s", c.Quarter, c.Type)
	}
	return q, pl, nil
}

// civic places a quarter's public building on its plot with the road
// reserved to it.
func (g *gen) civic(c *Civic) error {
	q, pl, err := g.plot(c)
	if err != nil {
		return err
	}
	if pl.built != 0 {
		return fmt.Errorf("%s of %s built twice", pl.typ, q.spec.ID)
	}
	def := g.c.BuildingByID[pl.typ]
	fw, fh := layout.Dims(def, pl.rot)
	// The shortest road now: the reserved one keeps a road possible, but
	// the network may have grown nearer (or across other quarters' land).
	path, ok := g.planner(q.spec.Island, false).RoadPath(q.spec.Island, pl.x, pl.y, fw, fh)
	if !ok {
		return fmt.Errorf("%s of %s: no road to its plot", pl.typ, q.spec.ID)
	}
	id, err := g.place(q.spec.Island, pl.typ, layout.Site{X: pl.x, Y: pl.y, Rot: pl.rot}, path, nil)
	if err != nil {
		return err
	}
	pl.built = id
	return nil
}

// upgrade upgrades Count houses of type From in the quarter, each waiting
// until one can: of those that can, the one most plots cover, then the
// oldest (the chain plots need not cover every house of the quarter).
func (g *gen) upgrade(u *Upgrade) error {
	q := g.quarters[u.Quarter]
	if q == nil {
		return fmt.Errorf("unknown quarter %q", u.Quarter)
	}
	is := g.world().Island(q.spec.Island)
	var todo []*sim.Building
	for _, id := range q.houses {
		if b := is.Building(id); b != nil && b.Type == u.From {
			todo = append(todo, b)
		}
	}
	if len(todo) < u.Count {
		return fmt.Errorf("quarter %s has %d houses of type %s, want %d", u.Quarter, len(todo), u.From, u.Count)
	}
	// The houses most plots cover first, then the oldest.
	slices.SortStableFunc(todo, func(a, b *sim.Building) int { return q.coverCount(g.c, b) - q.coverCount(g.c, a) })
	step := func(b *sim.Building) scenario.Step {
		return scenario.Step{Upgrade: &scenario.At{Island: q.spec.Island, X: b.X, Y: b.Y}}
	}
	for range u.Count {
		pick := 0
		for k, b := range todo {
			if _, err := g.sess.Try(step(b)); err == nil {
				pick = k
				break
			}
		}
		b := todo[pick]
		todo = slices.Delete(todo, pick, pick+1)
		if err := g.do(step(b), fmt.Sprintf("upgrade %s at (%d,%d)", u.From, b.X, b.Y)); err != nil {
			return err
		}
	}
	return nil
}

// coverCount counts the plots that cover a house.
func (q *quarter) coverCount(c *content.Catalogue, b *sim.Building) int {
	def := c.BuildingByID[b.Type]
	w, h := layout.Dims(def, b.Rotation)
	n := 0
	for _, pl := range q.plots {
		if covers(c.BuildingByID[pl.typ], pl.x, pl.y, pl.rot, b.X, b.Y, w, h, 0) {
			n++
		}
	}
	return n
}
