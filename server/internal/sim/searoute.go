package sim

import (
	"math/bits"

	"github.com/ricoberger/new-shores/server/internal/content"
)

// Sea routing (D-058 §5): a ship leg follows a path around land on a
// coarse sea grid; the path's length sets the travel time. The grid,
// the search and the smoothing are integer-only and deterministic.

const (
	// seaCell is the edge of a sea grid cell in tiles; a cell is land when
	// any island tile in it is not water (rivers and islets included).
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
	islands        []*Island
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
	g.nx = (maxX+m-g.x0)/seaCell + 1
	g.ny = (maxY+m-g.y0)/seaCell + 1
	g.land = make([]bool, g.nx*g.ny)
	for _, is := range islands {
		if len(is.Tiles) != is.Width*is.Height {
			continue
		}
		for y := range is.Height {
			for x := range is.Width {
				if is.Tiles[y*is.Width+x].Terrain == content.TerrainWater {
					continue
				}
				g.land[g.cellOf(is.X+x, is.Y+y)] = true
			}
		}
	}
	return g
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

// nearestSea is the sea cell nearest to a tile: its own cell when that is
// sea, else the closest sea cell centre (ties: the lowest index).
func (g *seaGrid) nearestSea(p Pos) int {
	k := g.cellOf(p.X, p.Y)
	if !g.land[k] {
		return k
	}
	ci, cj := k%g.nx, k/g.nx
	for r := 1; r < max(g.nx, g.ny); r++ {
		best, bestD := -1, 0
		for j := max(cj-r, 0); j <= min(cj+r, g.ny-1); j++ {
			for i := max(ci-r, 0); i <= min(ci+r, g.nx-1); i++ {
				if max(absInt(i-ci), absInt(j-cj)) != r || g.land[j*g.nx+i] {
					continue
				}
				c := g.centre(j*g.nx + i)
				if d := sq(c.X-p.X) + sq(c.Y-p.Y); best < 0 || d < bestD {
					best, bestD = j*g.nx+i, d
				}
			}
		}
		if best >= 0 {
			return best
		}
	}
	return k
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
			is.Tiles[ly*is.Width+lx].Terrain != content.TerrainWater {
			return true
		}
	}
	return false
}

// clear reports whether the segment a–b keeps seaClearance tiles from
// land, tile by tile; the tiles within seaClearance of its end points
// need only be water themselves (a harbour in a narrow bay, a shore point
// next to land).
func (g *seaGrid) clear(a, b Pos) bool {
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
	g := newSeaGrid(islands, a, b)
	if g.clear(a, b) {
		return nil
	}
	// An end in a cell with land reaches the open grid through the water
	// tiles (approach), never across land to the nearest sea cell.
	inA, inB := g.approach(a), g.approach(b)
	s, t := g.nearestSea(a), g.nearestSea(b)
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
	pts = append(pts, b)
	// String pulling: from each kept point jump to the farthest point in sight.
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

// approachReach bounds the water-tile search of approach (tiles,
// Chebyshev from the end point).
const approachReach = 6 * seaCell

// approach is the shortest way (8 neighbours, no corner cutting) over
// water tiles from an end point (excluded) to the first tile in a sea
// cell (included); nil when the point's own cell is sea or no such tile
// lies within approachReach. Ties break on the neighbour order (dy, then
// dx ascending).
func (g *seaGrid) approach(p Pos) []Pos {
	if !g.land[g.cellOf(p.X, p.Y)] {
		return nil
	}
	side := 2*approachReach + 1
	from := make([]int, side*side)
	for i := range from {
		from[i] = -1
	}
	idx := func(x, y int) int { return (y-p.Y+approachReach)*side + x - p.X + approachReach }
	water := func(x, y int) bool {
		return absInt(x-p.X) <= approachReach && absInt(y-p.Y) <= approachReach && !g.landAt(x, y)
	}
	start := idx(p.X, p.Y)
	from[start] = start
	queue := []Pos{p}
	for len(queue) > 0 {
		q := queue[0]
		queue = queue[1:]
		if q != p && !g.land[g.cellOf(q.X, q.Y)] {
			var out []Pos
			for k := idx(q.X, q.Y); k != start; k = from[k] {
				out = append(out, Pos{p.X + k%side - approachReach, p.Y + k/side - approachReach})
			}
			for i, j := 0, len(out)-1; i < j; i, j = i+1, j-1 {
				out[i], out[j] = out[j], out[i]
			}
			return out
		}
		for dy := -1; dy <= 1; dy++ {
			for dx := -1; dx <= 1; dx++ {
				nx, ny := q.X+dx, q.Y+dy
				if (dx == 0 && dy == 0) || !water(nx, ny) || from[idx(nx, ny)] >= 0 {
					continue
				}
				if dx != 0 && dy != 0 && (!water(q.X+dx, q.Y) || !water(q.X, q.Y+dy)) {
					continue
				}
				from[idx(nx, ny)] = idx(q.X, q.Y)
				queue = append(queue, Pos{nx, ny})
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
// (water with no land within one tile: a tight bay) it is the nearest open
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
			is.Tiles[ty*is.Width+tx].Terrain != content.TerrainWater
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
// centre when it has none.
func shore(is *Island, toward Pos) Pos {
	best, bestD := Pos{is.X + is.Width/2, is.Y + is.Height/2}, -1
	if len(is.Tiles) != is.Width*is.Height {
		return best
	}
	land := func(x, y int) bool {
		return x >= 0 && y >= 0 && x < is.Width && y < is.Height && is.Tiles[y*is.Width+x].Terrain != content.TerrainWater
	}
	for y := range is.Height {
		for x := range is.Width {
			if land(x, y) || !land(x-1, y) && !land(x+1, y) && !land(x, y-1) && !land(x, y+1) {
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
	path := append(append([]Pos{a}, SeaRoute(w.Islands, a, b)...), b)
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
