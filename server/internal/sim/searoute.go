package sim

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"math/bits"

	"github.com/ricoberger/new-shores/server/internal/content"
)

// Sea routing (D-058 §5): a ship leg follows a path around land on a
// coarse sea grid; the path's length sets the travel time. The grid,
// the search and the smoothing are integer-only and deterministic.

const (
	// seaCell is the edge of a sea grid cell in tiles; a cell is land when
	// any island tile in it is not water (rivers and islets included) or
	// carries a quay (D-060).
	seaCell = 4
	// seaMargin is the open sea (cells) around the islands and the leg's
	// end points.
	seaMargin = 6
	// seaClearance is the open water (tiles) a straight stretch keeps
	// from land, apart from next to its end points.
	seaClearance = 1
	// harbourOffset is how far (tiles) the harbour point of a Trading Post
	// lies out to sea from the middle of its water edge.
	harbourOffset = 2
	// stepStraight and stepDiagonal are the search costs of a straight and
	// a diagonal move (≈ 1 : √2).
	stepStraight = 10
	stepDiagonal = 14
)

// seaGrid is the land mask of the archipelago at seaCell tiles per cell.
type seaGrid struct {
	x0, y0, nx, ny int
	land           []bool
	// lagoon marks the sea cells closed as land (closeLagoons).
	lagoon  []bool
	islands []*Island
	// bbox is the islands' bounding rectangle [x0, x1) × [y0, y1) the grid
	// was sized from: a grid built over the islands alone equals one built
	// with extra points inside it.
	bx0, by0, bx1, by1 int
}

// SeaGrid is a built sea grid, shareable between requests (read-only
// after construction). The API layer caches it per archipelago
// (SeaGridKey); World.SetSeaGrid hands it to Voyage.
type SeaGrid = seaGrid

// BuildSeaGrid builds the sea grid over the islands alone.
func BuildSeaGrid(islands []*Island) *SeaGrid { return newSeaGrid(islands) }

// SeaGridKey identifies everything the world's sea grid depends on: the
// archipelago (seed, roll, generator version) with the islands' rectangles
// and the roads on water tiles (quays, D-060), the only ship-relevant
// state buildings change. It is empty for a world without a seed (hand-made
// islands whose tiles the key cannot vouch for): such a grid is not cached.
func SeaGridKey(w *World, generatorVersion int) string {
	if w.Seed == 0 {
		return ""
	}
	h := sha256.New()
	fmt.Fprintf(h, "%d|%d|%d|%d", w.Seed, w.ArchipelagoRoll, generatorVersion, len(w.Islands))
	for _, is := range w.Islands {
		fmt.Fprintf(h, "|%s,%d,%d,%d,%d", is.ID, is.X, is.Y, is.Width, is.Height)
		if len(is.Tiles) != is.Width*is.Height {
			continue
		}
		for i := range is.Tiles {
			if is.Roads[i] != "" && is.Tiles[i].Terrain == content.TerrainWater {
				fmt.Fprintf(h, ",%d", i)
			}
		}
	}
	return hex.EncodeToString(h.Sum(nil)[:16])
}

// SetSeaGrid lends the world a prebuilt sea grid for Voyage (nil to
// withdraw it). The caller guarantees it matches the islands as they are
// now (SeaGridKey); Voyage ignores it for end points outside the grid's
// islands' bounds.
func (w *World) SetSeaGrid(g *SeaGrid) { w.seaGrid = g }

// seaGridFor is the grid of a leg: the lent one (re-pointed at the current
// islands) when both end points lie inside its bounds, else a fresh one.
func (w *World) seaGridFor(a, b Pos) *seaGrid {
	if g := w.seaGrid; g != nil {
		in := func(p Pos) bool { return p.X >= g.bx0 && p.Y >= g.by0 && p.X+1 <= g.bx1 && p.Y+1 <= g.by1 }
		if in(a) && in(b) {
			c := *g
			c.islands = w.Islands
			return &c
		}
	}
	return newSeaGrid(w.Islands, a, b)
}

// newSeaGrid builds the grid over the islands' rectangles and the points.
func newSeaGrid(islands []*Island, pts ...Pos) *seaGrid {
	minX, minY, maxX, maxY := 0, 0, 0, 0
	first := true
	grow := func(x0, y0, x1, y1 int) {
		if first {
			minX, minY, maxX, maxY, first = x0, y0, x1, y1, false
			return
		}
		minX, minY, maxX, maxY = min(minX, x0), min(minY, y0), max(maxX, x1), max(maxY, y1)
	}
	for _, is := range islands {
		grow(is.X, is.Y, is.X+is.Width, is.Y+is.Height)
	}
	for _, p := range pts {
		grow(p.X, p.Y, p.X+1, p.Y+1)
	}
	m := seaMargin * seaCell
	g := &seaGrid{x0: minX - m, y0: minY - m, islands: islands}
	for _, is := range islands {
		if g.bx1 == 0 && g.by1 == 0 {
			g.bx0, g.by0, g.bx1, g.by1 = is.X, is.Y, is.X+is.Width, is.Y+is.Height
			continue
		}
		g.bx0, g.by0, g.bx1, g.by1 = min(g.bx0, is.X), min(g.by0, is.Y), max(g.bx1, is.X+is.Width), max(g.by1, is.Y+is.Height)
	}
	g.nx = (maxX+m-g.x0)/seaCell + 1
	g.ny = (maxY+m-g.y0)/seaCell + 1
	g.land = make([]bool, g.nx*g.ny)
	for _, is := range islands {
		if len(is.Tiles) != is.Width*is.Height {
			continue
		}
		for y := range is.Height {
			for x := range is.Width {
				if !seaLand(is, x, y) {
					continue
				}
				g.land[g.cellOf(is.X+x, is.Y+y)] = true
			}
		}
	}
	g.closeLagoons()
	return g
}

// closeLagoons marks the sea cells that the search cannot reach from the
// open sea (a bay whose mouth is narrower than a cell, D-072) as land and
// lagoon: a leg end in one reaches the open grid over its water tiles
// (approach) instead of failing the search.
func (g *seaGrid) closeLagoons() {
	open := make([]bool, len(g.land))
	open[0] = !g.land[0] // the grid's corner lies in the open-sea margin
	queue := []int{0}
	for len(queue) > 0 {
		k := queue[0]
		queue = queue[1:]
		i, j := k%g.nx, k/g.nx
		for dj := -1; dj <= 1; dj++ {
			for di := -1; di <= 1; di++ {
				ni, nj := i+di, j+dj
				if (di == 0 && dj == 0) || ni < 0 || nj < 0 || ni >= g.nx || nj >= g.ny {
					continue
				}
				nk := nj*g.nx + ni
				if g.land[nk] || open[nk] || (di != 0 && dj != 0 && (g.land[j*g.nx+ni] || g.land[nj*g.nx+i])) {
					continue
				}
				open[nk] = true
				queue = append(queue, nk)
			}
		}
	}
	g.lagoon = make([]bool, len(g.land))
	for k := range g.land {
		g.lagoon[k] = !g.land[k] && !open[k]
		g.land[k] = !open[k]
	}
}

// cellOf is the cell index of an archipelago tile (clamped to the grid).
func (g *seaGrid) cellOf(x, y int) int {
	i := min(max((x-g.x0)/seaCell, 0), g.nx-1)
	j := min(max((y-g.y0)/seaCell, 0), g.ny-1)
	return j*g.nx + i
}

// centre is the archipelago tile at the middle of a cell.
func (g *seaGrid) centre(k int) Pos {
	return Pos{g.x0 + (k%g.nx)*seaCell + seaCell/2, g.y0 + (k/g.nx)*seaCell + seaCell/2}
}

// landAt reports whether an archipelago tile is land (not water) on any
// island; only the islands of land cells are looked at.
func (g *seaGrid) landAt(x, y int) bool {
	if !g.land[g.cellOf(x, y)] {
		return false
	}
	for _, is := range g.islands {
		lx, ly := x-is.X, y-is.Y
		if lx >= 0 && ly >= 0 && lx < is.Width && ly < is.Height && len(is.Tiles) == is.Width*is.Height &&
			seaLand(is, lx, ly) {
			return true
		}
	}
	return false
}

// clear reports whether the segment a–b keeps seaClearance tiles from
// land, tile by tile; the tiles within seaClearance of its end points
// need only be water themselves (a harbour in a narrow bay, a shore point
// next to land) — every tile the segment passes there (lineTiles), so it
// never cuts the corner of a land tile beside an end point.
func (g *seaGrid) clear(a, b Pos) bool {
	near := true
	lineTiles(a, b, func(x, y int) {
		if !near || (x == a.X && y == a.Y) || (x == b.X && y == b.Y) {
			return
		}
		if (max(absInt(x-a.X), absInt(y-a.Y)) <= seaClearance || max(absInt(x-b.X), absInt(y-b.Y)) <= seaClearance) && g.landAt(x, y) {
			near = false
		}
	})
	if !near {
		return false
	}
	dx, dy := b.X-a.X, b.Y-a.Y
	n := max(absInt(dx), absInt(dy))
	for s := 0; s <= n; s++ {
		x, y := a.X, a.Y
		if n > 0 {
			x, y = a.X+divRound(dx*s, n), a.Y+divRound(dy*s, n)
		}
		if max(absInt(x-a.X), absInt(y-a.Y)) <= seaClearance || max(absInt(x-b.X), absInt(y-b.Y)) <= seaClearance {
			if (x != a.X || y != a.Y) && (x != b.X || y != b.Y) && g.landAt(x, y) {
				return false
			}
			continue
		}
		for oy := -seaClearance; oy <= seaClearance; oy++ {
			for ox := -seaClearance; ox <= seaClearance; ox++ {
				if g.landAt(x+ox, y+oy) {
					return false
				}
			}
		}
	}
	return true
}

// lineTiles calls f for every tile the segment between the centres of
// tiles a and b passes through, in order (integer supercover); a segment
// through a tile corner also touches the two tiles beside the corner.
func lineTiles(a, b Pos, f func(x, y int)) {
	x, y := a.X, a.Y
	dx, dy := b.X-a.X, b.Y-a.Y
	sx, sy := 1, 1
	if dx < 0 {
		sx, dx = -1, -dx
	}
	if dy < 0 {
		sy, dy = -1, -dy
	}
	f(x, y)
	// The next x boundary lies at t = (2i+1)/(2dx), the next y boundary at
	// (2j+1)/(2dy): compare (2i+1)·dy with (2j+1)·dx.
	for i, j := 0, 0; i < dx || j < dy; {
		tx, ty := (2*i+1)*dy, (2*j+1)*dx
		switch {
		case j >= dy || (i < dx && tx < ty):
			x += sx
			i++
		case i >= dx || ty < tx:
			y += sy
			j++
		default:
			f(x+sx, y)
			f(x, y+sy)
			x, y = x+sx, y+sy
			i, j = i+1, j+1
		}
		f(x, y)
	}
}

// search is an A* over the sea cells from s to t (8 neighbours, no
// corner cutting); nil when t cannot be reached. Ties break on the
// smaller remaining estimate, then the smaller cell index.
func (g *seaGrid) search(s, t int) []int {
	n := g.nx * g.ny
	cost := make([]int, n)
	from := make([]int, n)
	for k := range cost {
		cost[k], from[k] = -1, -1
	}
	ti, tj := t%g.nx, t/g.nx
	est := func(k int) int {
		di, dj := absInt(k%g.nx-ti), absInt(k/g.nx-tj)
		return stepStraight*max(di, dj) + (stepDiagonal-stepStraight)*min(di, dj)
	}
	h := &cellHeap{}
	cost[s] = 0
	h.push(cellItem{f: est(s), h: est(s), k: s})
	for h.len() > 0 {
		it := h.pop()
		k := it.k
		if it.f-it.h != cost[k] {
			continue // stale entry
		}
		if k == t {
			out := []int{}
			for c := t; c >= 0; c = from[c] {
				out = append(out, c)
			}
			for i, j := 0, len(out)-1; i < j; i, j = i+1, j-1 {
				out[i], out[j] = out[j], out[i]
			}
			return out
		}
		i, j := k%g.nx, k/g.nx
		for dj := -1; dj <= 1; dj++ {
			for di := -1; di <= 1; di++ {
				ni, nj := i+di, j+dj
				if (di == 0 && dj == 0) || ni < 0 || nj < 0 || ni >= g.nx || nj >= g.ny {
					continue
				}
				nk := nj*g.nx + ni
				if g.land[nk] {
					continue
				}
				step := stepStraight
				if di != 0 && dj != 0 {
					// No corner cutting: both orthogonal neighbours are sea.
					if g.land[j*g.nx+ni] || g.land[nj*g.nx+i] {
						continue
					}
					step = stepDiagonal
				}
				if c := cost[k] + step; cost[nk] < 0 || c < cost[nk] {
					cost[nk], from[nk] = c, k
					e := est(nk)
					h.push(cellItem{f: c + e, h: e, k: nk})
				}
			}
		}
	}
	return nil
}

// SeaRoute returns the waypoints (archipelago tiles) of a voyage from a
// to b around the islands' land, without a and b: nil when the straight
// line crosses no land (or no way around exists). The waypoints are the
// searched cell centres pulled tight (each one the farthest cell still
// in sight of the previous point).
func SeaRoute(islands []*Island, a, b Pos) []Pos {
	return seaRoute(newSeaGrid(islands, a, b), a, b)
}

// seaRoute is SeaRoute over a built grid. The straight line is returned
// (nil) only when it is clear; otherwise the leg goes over the sea grid
// (each end walking over water tiles to the nearest open cell) or, when
// an end reaches no open cell (a closed lagoon), along the coast over
// water tiles. Nil for a crossing leg only when the ends share no water
// at all, which the leg ends rule out (harbours are routable, shores and
// sea positions lie on water connected to the open sea).
func seaRoute(g *seaGrid, a, b Pos) []Pos {
	if g.clear(a, b) {
		return nil
	}
	if pts := g.cellRoute(a, b); pts != nil {
		return g.pull(pts)
	}
	if pts := g.coastRoute(a, b); pts != nil {
		return g.pull(pts)
	}
	return nil
}

// cellRoute is the unpulled polyline from a to b over the sea grid: a,
// the water tiles from a to its first open cell, the searched cell
// centres, the water tiles from b's first open cell back to b, and b;
// nil when an end reaches no open cell over water.
func (g *seaGrid) cellRoute(a, b Pos) []Pos {
	// An end in a cell with land reaches the open grid through the water
	// tiles (approach), never across land to the nearest sea cell.
	inA, okA := g.approachOpen(a)
	inB, okB := g.approachOpen(b)
	if !okA || !okB {
		return nil
	}
	s, t := g.cellOf(a.X, a.Y), g.cellOf(b.X, b.Y)
	if len(inA) > 0 {
		last := inA[len(inA)-1]
		s = g.cellOf(last.X, last.Y)
	}
	if len(inB) > 0 {
		last := inB[len(inB)-1]
		t = g.cellOf(last.X, last.Y)
	}
	cells := g.search(s, t)
	if cells == nil {
		return nil
	}
	pts := make([]Pos, 0, len(cells)+len(inA)+len(inB)+2)
	pts = append(pts, a)
	pts = append(pts, inA...)
	for _, k := range cells {
		pts = append(pts, g.centre(k))
	}
	for i := len(inB) - 1; i >= 0; i-- {
		pts = append(pts, inB[i])
	}
	return append(pts, b)
}

// pull is the string pulling of a polyline (first and last point
// excluded from the result): from each kept point it jumps to the
// farthest point in sight.
func (g *seaGrid) pull(pts []Pos) []Pos {
	var out []Pos
	for i := 0; i < len(pts)-1; {
		next := i + 1
		for j := len(pts) - 1; j > i+1; j-- {
			if g.clear(pts[i], pts[j]) {
				next = j
				break
			}
		}
		if next < len(pts)-1 {
			out = append(out, pts[next])
		}
		i = next
	}
	return out
}

// approachReach bounds the first water-tile search of approach (tiles,
// Chebyshev from the end point); approachOpen widens it to the grid.
const approachReach = 6 * seaCell

// approachOpen is the way over water tiles from an end point to its
// first open cell (approach): within approachReach first, then — a bay
// whose narrow mouth lies farther out — anywhere on the grid. ok is
// false when the point's cell is land and no open cell is reachable over
// water (a closed lagoon).
func (g *seaGrid) approachOpen(p Pos) ([]Pos, bool) {
	if !g.land[g.cellOf(p.X, p.Y)] {
		return nil, true
	}
	if in := g.approach(p, approachReach); in != nil {
		return in, true
	}
	reach := max(g.nx, g.ny) * seaCell
	in := g.approach(p, reach)
	return in, in != nil
}

// approach is the shortest way (8 neighbours, no corner cutting) over
// water tiles from an end point (excluded) to the first tile in a sea
// cell (included); nil when the point's own cell is sea or no such tile
// lies within reach (tiles, Chebyshev). Ties break on the neighbour
// order (dy, then dx ascending).
func (g *seaGrid) approach(p Pos, reach int) []Pos {
	if !g.land[g.cellOf(p.X, p.Y)] {
		return nil
	}
	from := map[Pos]Pos{p: p}
	water := func(x, y int) bool {
		return absInt(x-p.X) <= reach && absInt(y-p.Y) <= reach && g.inside(x, y) && !g.landAt(x, y)
	}
	queue := []Pos{p}
	for len(queue) > 0 {
		q := queue[0]
		queue = queue[1:]
		if q != p && !g.land[g.cellOf(q.X, q.Y)] {
			var out []Pos
			for k := q; k != p; k = from[k] {
				out = append(out, k)
			}
			for i, j := 0, len(out)-1; i < j; i, j = i+1, j-1 {
				out[i], out[j] = out[j], out[i]
			}
			return out
		}
		for dy := -1; dy <= 1; dy++ {
			for dx := -1; dx <= 1; dx++ {
				n := Pos{q.X + dx, q.Y + dy}
				if _, seen := from[n]; (dx == 0 && dy == 0) || seen || !water(n.X, n.Y) {
					continue
				}
				if dx != 0 && dy != 0 && (!water(q.X+dx, q.Y) || !water(q.X, q.Y+dy)) {
					continue
				}
				from[n] = q
				queue = append(queue, n)
			}
		}
	}
	return nil
}

// inside reports whether an archipelago tile lies on the grid.
func (g *seaGrid) inside(x, y int) bool {
	return x >= g.x0 && y >= g.y0 && x < g.x0+g.nx*seaCell && y < g.y0+g.ny*seaCell
}

// coastRoute is the unpulled polyline from a to b over water tiles (an
// A* on the tiles of the grid, 8 neighbours, no corner cutting): the way
// along the coast when an end reaches no open cell; nil when b is not
// reachable over water. Ties break on the smaller remaining estimate,
// then the smaller tile index.
func (g *seaGrid) coastRoute(a, b Pos) []Pos {
	w := g.nx * seaCell
	idx := func(p Pos) int { return (p.Y-g.y0)*w + p.X - g.x0 }
	at := func(k int) Pos { return Pos{g.x0 + k%w, g.y0 + k/w} }
	water := func(x, y int) bool { return g.inside(x, y) && !g.landAt(x, y) }
	if !g.inside(a.X, a.Y) || !g.inside(b.X, b.Y) {
		return nil
	}
	est := func(p Pos) int {
		dx, dy := absInt(p.X-b.X), absInt(p.Y-b.Y)
		return stepStraight*max(dx, dy) + (stepDiagonal-stepStraight)*min(dx, dy)
	}
	cost := map[int]int{idx(a): 0}
	from := map[int]int{idx(a): -1}
	h := &cellHeap{}
	h.push(cellItem{f: est(a), h: est(a), k: idx(a)})
	for h.len() > 0 {
		it := h.pop()
		k := it.k
		if it.f-it.h != cost[k] {
			continue // stale entry
		}
		q := at(k)
		if q == b {
			var out []Pos
			for c := k; c >= 0; c = from[c] {
				out = append(out, at(c))
			}
			for i, j := 0, len(out)-1; i < j; i, j = i+1, j-1 {
				out[i], out[j] = out[j], out[i]
			}
			return out
		}
		for dy := -1; dy <= 1; dy++ {
			for dx := -1; dx <= 1; dx++ {
				n := Pos{q.X + dx, q.Y + dy}
				if (dx == 0 && dy == 0) || (!water(n.X, n.Y) && n != b) {
					continue
				}
				step := stepStraight
				if dx != 0 && dy != 0 {
					if !water(q.X+dx, q.Y) || !water(q.X, q.Y+dy) {
						continue
					}
					step = stepDiagonal
				}
				nk := idx(n)
				if c, seen := cost[nk]; !seen || cost[k]+step < c {
					cost[nk], from[nk] = cost[k]+step, k
					e := est(n)
					h.push(cellItem{f: cost[k] + step + e, h: e, k: nk})
				}
			}
		}
	}
	return nil
}

// PathMs is the travel time along a polyline: the sum of its segments'
// ceil(1000 × length) milli-tiles at the ship's speed (the arithmetic of
// TravelMs; two points give TravelMs).
func PathMs(path []Pos, speedPermille, milliTilesPerMin int64) int64 {
	var dist uint64
	for i := 1; i < len(path); i++ {
		dist += distMilli(path[i-1].X, path[i-1].Y, path[i].X, path[i].Y)
	}
	return milliToMs(dist, speedPermille, milliTilesPerMin)
}

// harbour is the point (archipelago tiles) in front of the water edge of
// an island's Trading Post (its first building with berths, HarbourAt);
// false without one.
func harbour(c *content.Catalogue, is *Island) (Pos, bool) {
	for _, b := range is.Buildings {
		def := c.BuildingByID[b.Type]
		if b.Berths <= 0 || def == nil {
			continue
		}
		return HarbourAt(is, def, b.X, b.Y, b.Rotation), true
	}
	return Pos{}, false
}

// harbourSearch bounds the search for open water around a harbour point
// (tiles, Chebyshev).
const harbourSearch = 12

// HarbourAt is the harbour point (archipelago tiles) of a Trading Post of
// def at (x, y) (island tiles) with the rotation: harbourOffset tiles
// beyond the middle of its water edge. When that tile is not open water
// (water with no land or quay within one tile: a tight bay) it is the nearest open
// water tile outside the footprint (Euclidean; ties: ring order), the
// tile itself when there is none within harbourSearch. Tiles outside the
// island's grid are water.
func HarbourAt(is *Island, def *content.Building, x, y, rotation int) Pos {
	w, h := footprint(def, rotation)
	var p Pos
	switch rotation {
	case 90:
		p = Pos{x + w - 1 + harbourOffset, y + h/2}
	case 180:
		p = Pos{x + w/2, y + h - 1 + harbourOffset}
	case 270:
		p = Pos{x - harbourOffset, y + h/2}
	default:
		p = Pos{x + w/2, y - harbourOffset}
	}
	land := func(tx, ty int) bool {
		return tx >= 0 && ty >= 0 && tx < is.Width && ty < is.Height && len(is.Tiles) == is.Width*is.Height &&
			seaLand(is, tx, ty)
	}
	open := func(tx, ty int) bool {
		if tx >= x && ty >= y && tx < x+w && ty < y+h {
			return false
		}
		for oy := -1; oy <= 1; oy++ {
			for ox := -1; ox <= 1; ox++ {
				if land(tx+ox, ty+oy) {
					return false
				}
			}
		}
		return true
	}
	best, bestD := p, -1
	for r := 0; r <= harbourSearch; r++ {
		if bestD >= 0 && r*r > bestD {
			break
		}
		for dy := -r; dy <= r; dy++ {
			for dx := -r; dx <= r; dx++ {
				if max(absInt(dx), absInt(dy)) != r || !open(p.X+dx, p.Y+dy) {
					continue
				}
				if d := dx*dx + dy*dy; bestD < 0 || d < bestD {
					best, bestD = Pos{p.X + dx, p.Y + dy}, d
				}
			}
		}
	}
	return Pos{is.X + best.X, is.Y + best.Y}
}

// shore is the water tile of an island's grid next to its land that is
// nearest to a point (ties: the first in row order), or the island's
// centre when it has none. Only water that ships reach from the open sea
// counts (seaWater): never a closed pool or a tile behind quays.
func shore(is *Island, toward Pos) Pos {
	best, bestD := Pos{is.X + is.Width/2, is.Y + is.Height/2}, -1
	if len(is.Tiles) != is.Width*is.Height {
		return best
	}
	land := func(x, y int) bool {
		return x >= 0 && y >= 0 && x < is.Width && y < is.Height && is.Tiles[y*is.Width+x].Terrain != content.TerrainWater
	}
	sea := seaWater(is)
	for y := range is.Height {
		for x := range is.Width {
			if land(x, y) || !sea[y*is.Width+x] || !land(x-1, y) && !land(x+1, y) && !land(x, y-1) && !land(x, y+1) {
				continue
			}
			p := Pos{is.X + x, is.Y + y}
			if d := sq(p.X-toward.X) + sq(p.Y-toward.Y); bestD < 0 || d < bestD {
				best, bestD = p, d
			}
		}
	}
	return best
}

// seaWater marks the island's tiles that ships reach from the edge of its
// grid (seaReachable for every tile at once): water, not land for ships
// (seaLand), 4-connected to the edge.
func seaWater(is *Island) []bool {
	open := make([]bool, is.Width*is.Height)
	var queue []Pos
	for y := range is.Height {
		for x := range is.Width {
			if (x == 0 || y == 0 || x == is.Width-1 || y == is.Height-1) && !seaLand(is, x, y) {
				open[is.index(x, y)] = true
				queue = append(queue, Pos{x, y})
			}
		}
	}
	for len(queue) > 0 {
		q := queue[0]
		queue = queue[1:]
		for _, nb := range neighbours() {
			nx, ny := q.X+nb.X, q.Y+nb.Y
			if is.InBounds(nx, ny) && !open[is.index(nx, ny)] && !seaLand(is, nx, ny) {
				open[is.index(nx, ny)] = true
				queue = append(queue, Pos{nx, ny})
			}
		}
	}
	return open
}

// Ends are the end points of a leg between two islands: each island's
// harbour, or for an island without a Trading Post its shore nearest to
// the other end.
func Ends(c *content.Catalogue, from, to *Island) (Pos, Pos) {
	a, okA := harbour(c, from)
	b, okB := harbour(c, to)
	switch {
	case !okA && !okB:
		a = shore(from, Pos{to.X + to.Width/2, to.Y + to.Height/2})
		b = shore(to, a)
	case !okA:
		a = shore(from, b)
	case !okB:
		b = shore(to, a)
	}
	return a, b
}

// Arrival is the end point of a leg from a sea position to an island:
// its harbour, or its shore nearest to the position.
func Arrival(c *content.Catalogue, from Pos, to *Island) Pos {
	if b, ok := harbour(c, to); ok {
		return b
	}
	return shore(to, from)
}

// Voyage is the polyline (a, the waypoints around land, b) and travel
// time of a leg for a ship of the given speed.
func Voyage(w *World, c *content.Catalogue, speedPermille int64, a, b Pos) ([]Pos, int64) {
	path := append(append([]Pos{a}, seaRoute(w.seaGridFor(a, b), a, b)...), b)
	return path, PathMs(path, speedPermille, c.Region.Rules.ShipSpeedMilliTilesPerMin)
}

// cellItem is an open cell of the search: f = cost + h.
type cellItem struct{ f, h, k int }

// cellHeap is a binary min-heap of open cells ordered by (f, h, k).
type cellHeap struct{ items []cellItem }

func (q *cellHeap) len() int { return len(q.items) }

func (q *cellHeap) less(a, b cellItem) bool {
	if a.f != b.f {
		return a.f < b.f
	}
	if a.h != b.h {
		return a.h < b.h
	}
	return a.k < b.k
}

func (q *cellHeap) push(it cellItem) {
	q.items = append(q.items, it)
	i := len(q.items) - 1
	for i > 0 {
		p := (i - 1) / 2
		if !q.less(q.items[i], q.items[p]) {
			break
		}
		q.items[i], q.items[p] = q.items[p], q.items[i]
		i = p
	}
}

func (q *cellHeap) pop() cellItem {
	top := q.items[0]
	last := len(q.items) - 1
	q.items[0] = q.items[last]
	q.items = q.items[:last]
	for i := 0; ; {
		l, r, m := 2*i+1, 2*i+2, i
		if l < last && q.less(q.items[l], q.items[m]) {
			m = l
		}
		if r < last && q.less(q.items[r], q.items[m]) {
			m = r
		}
		if m == i {
			break
		}
		q.items[i], q.items[m] = q.items[m], q.items[i]
		i = m
	}
	return top
}

func absInt(v int) int {
	if v < 0 {
		return -v
	}
	return v
}

func sq(v int) int { return v * v }

// divRound is a/b rounded half away from zero (b > 0).
func divRound(a, b int) int {
	if a < 0 {
		return -((-a + b/2) / b)
	}
	return (a + b/2) / b
}

// distMilli is ceil(1000 × the distance) between two tiles (coordinates
// clamped to ±maxCoord).
func distMilli(fromX, fromY, toX, toY int) uint64 {
	clamp := func(v int) int64 { return int64(min(max(v, -maxCoord), maxCoord)) }
	dx, dy := clamp(toX)-clamp(fromX), clamp(toY)-clamp(fromY)
	// dx^2 + dy^2 <= 8e12, times 1e6 <= 8e18 < 2^63.
	d2 := uint64(dx*dx+dy*dy) * 1_000_000 // #nosec G115 -- non-negative
	dist := isqrt(d2)
	if dist*dist < d2 {
		dist++
	}
	return dist
}

// milliToMs is the travel time (ms, at least 1) of a distance in
// milli-tiles: ceil(dist × 60 000 × 1000 / (speedPermille × rate)).
func milliToMs(dist uint64, speedPermille, milliTilesPerMin int64) int64 {
	den := uint64(max(speedPermille, 1)) * uint64(max(milliTilesPerMin, 1)) // #nosec G115 -- positive
	hi, lo := bits.Mul64(dist, msPerMinute*1000)
	if hi >= den {
		return 1<<63 - 1
	}
	q, r := bits.Div64(hi, lo, den)
	if r > 0 {
		q++
	}
	return max(int64(q), 1) // #nosec G115 -- q < 2^63 since dist*6e7 < 2^63
}
