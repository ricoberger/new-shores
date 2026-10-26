package archipelago

import (
	"github.com/ricoberger/new-shores/server/internal/content"
)

// Terrain codes of the working grid.
const (
	tWater byte = iota
	tCoast
	tGrass
	tForest
	tMountain
)

// margin is the water border around an island's land: the water rows of a
// Trading Post or shipyard on the outer coast must lie on the grid.
const margin = 3

// grid is an island under construction.
type grid struct {
	n int // width = height
	t []byte
	// dep holds the deposit slot (1-based index into slots) per tile, 0 for
	// none.
	dep   []int
	slots []slot
}

// slot is one deposit slot: two 4-adjacent mountain tiles on the edge of
// a mountain cluster.
type slot struct {
	kind  string
	tiles [2]int
}

func newGrid(n int) *grid { return &grid{n: n, t: make([]byte, n*n), dep: make([]int, n*n)} }

func (g *grid) in(x, y int) bool { return x >= 0 && y >= 0 && x < g.n && y < g.n }
func (g *grid) at(x, y int) byte {
	if !g.in(x, y) {
		return tWater
	}
	return g.t[y*g.n+x]
}
func (g *grid) land(x, y int) bool { return g.at(x, y) != tWater }

func buildable(t byte) bool { return t == tCoast || t == tGrass || t == tForest }

func dirs4() [4][2]int { return [4][2]int{{0, -1}, {1, 0}, {0, 1}, {-1, 0}} }

// noise is low-frequency value noise: random lattice values every cell
// tiles, bilinearly interpolated in integers.
type noise struct {
	cell, w int
	v       []int
}

func newNoise(r *rng, n, cell, amp int) *noise {
	w := n/cell + 2
	v := make([]int, w*w)
	for i := range v {
		v[i] = r.between(-amp, amp)
	}
	return &noise{cell: cell, w: w, v: v}
}

func (z *noise) at(x, y int) int {
	gx, gy := x/z.cell, y/z.cell
	fx, fy := x%z.cell, y%z.cell
	c := z.cell
	v00, v10 := z.v[gy*z.w+gx], z.v[gy*z.w+gx+1]
	v01, v11 := z.v[(gy+1)*z.w+gx], z.v[(gy+1)*z.w+gx+1]
	return (v00*(c-fx)*(c-fy) + v10*fx*(c-fy) + v01*(c-fx)*fy + v11*fx*fy) / (c * c)
}

// ellipse in doubled tile coordinates (cx, cy at a tile corner).
type ellipse struct{ cx, cy, rx, ry int }

// field returns 1024 at the centre falling to 0 on the rim (negative
// outside), in integers.
func (e ellipse) field(x, y int) int {
	dx, dy := int64(2*x+1-2*e.cx), int64(2*y+1-2*e.cy)
	rx, ry := int64(e.rx), int64(e.ry)
	d := dx*dx*1024/(4*rx*rx) + dy*dy*1024/(4*ry*ry)
	return int(1024 - d)
}

// landMass draws 2-4 overlapping ellipses (rocks 1-2) inside the land
// extent size, perturbs them with value noise, keeps the largest
// 4-connected land component and fills enclosed water (no lakes).
func landMass(r *rng, size int, rock bool) *grid {
	n := size + 2*margin
	g := newGrid(n)
	half := size / 2
	centre := margin + half
	k := r.between(2, 4)
	if rock {
		k = r.between(1, 2)
	}
	es := make([]ellipse, k)
	for i := range es {
		if i == 0 {
			off := half / 5
			if rock {
				off = 0
			}
			es[i] = ellipse{
				cx: centre + r.between(-off, off), cy: centre + r.between(-off, off),
				rx: half * r.between(60, 90) / 100, ry: half * r.between(60, 90) / 100,
			}
			if rock {
				es[i].rx, es[i].ry = half*r.between(105, 125)/100, half*r.between(105, 125)/100
			}
			continue
		}
		off := half * 55 / 100
		es[i] = ellipse{
			cx: centre + r.between(-off, off), cy: centre + r.between(-off, off),
			rx: max(2, half*r.between(30, 60)/100), ry: max(2, half*r.between(30, 60)/100),
		}
	}
	cell := max(4, size/5)
	amp := 380
	if rock {
		amp = 150
	}
	z := newNoise(r, n, cell, amp)
	for y := margin; y < n-margin; y++ {
		for x := margin; x < n-margin; x++ {
			best := -1 << 30
			for _, e := range es {
				best = max(best, e.field(x, y))
			}
			if best+z.at(x, y) > 0 {
				g.t[y*n+x] = tGrass
			}
		}
	}
	g.smooth()
	g.keepLargest()
	g.fillLakes()
	return g
}

// smooth removes one-tile spurs and fills one-tile notches: a land tile
// with fewer than two land 4-neighbours becomes water, a water tile with
// three or more becomes land (inside the margin), until nothing changes
// (bounded).
func (g *grid) smooth() {
	for range 8 {
		changed := false
		for y := margin; y < g.n-margin; y++ {
			for x := margin; x < g.n-margin; x++ {
				n := 0
				for _, d := range dirs4() {
					if g.land(x+d[0], y+d[1]) {
						n++
					}
				}
				i := y*g.n + x
				switch {
				case g.t[i] != tWater && n < 2:
					g.t[i] = tWater
					changed = true
				case g.t[i] == tWater && n >= 3:
					g.t[i] = tGrass
					changed = true
				}
			}
		}
		if !changed {
			return
		}
	}
}

// keepLargest keeps the largest 4-connected land component (the first in
// row-major order on ties).
func (g *grid) keepLargest() {
	comp := make([]int, len(g.t))
	best, bestSize := 0, 0
	id := 0
	for i := range g.t {
		if g.t[i] == tWater || comp[i] != 0 {
			continue
		}
		id++
		size := g.flood(i, id, comp, func(j int) bool { return g.t[j] != tWater })
		if size > bestSize {
			best, bestSize = id, size
		}
	}
	for i := range g.t {
		if g.t[i] != tWater && comp[i] != best {
			g.t[i] = tWater
		}
	}
}

// fillLakes turns water not 4-connected to the grid border into land.
func (g *grid) fillLakes() {
	comp := make([]int, len(g.t))
	water := func(j int) bool { return g.t[j] == tWater }
	for i := range g.t {
		x, y := i%g.n, i/g.n
		if (x == 0 || y == 0 || x == g.n-1 || y == g.n-1) && water(i) && comp[i] == 0 {
			g.flood(i, 1, comp, water)
		}
	}
	for i := range g.t {
		if g.t[i] == tWater && comp[i] == 0 {
			g.t[i] = tGrass
		}
	}
}

// flood marks the 4-connected component of start (tiles passing ok) with
// id and returns its size. Iterative, in a fixed order.
func (g *grid) flood(start, id int, comp []int, ok func(int) bool) int {
	stack := []int{start}
	comp[start] = id
	size := 0
	for len(stack) > 0 {
		i := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		size++
		x, y := i%g.n, i/g.n
		for _, d := range dirs4() {
			nx, ny := x+d[0], y+d[1]
			if !g.in(nx, ny) {
				continue
			}
			j := ny*g.n + nx
			if comp[j] == 0 && ok(j) {
				comp[j] = id
				stack = append(stack, j)
			}
		}
	}
	return size
}

// waterDistance returns the Chebyshev distance of every tile to the
// nearest water tile (0 on water), capped at limit.
func (g *grid) waterDistance(limit int) []int {
	d := make([]int, len(g.t))
	for i := range g.t {
		if g.t[i] == tWater {
			continue
		}
		x, y := i%g.n, i/g.n
		best := limit
		for r := 1; r < best; r++ {
			found := false
			for dy := -r; dy <= r && !found; dy++ {
				for dx := -r; dx <= r; dx++ {
					if max(abs(dx), abs(dy)) != r {
						continue
					}
					if !g.land(x+dx, y+dy) {
						found = true
						break
					}
				}
			}
			if found {
				best = r
				break
			}
		}
		d[i] = best
	}
	return d
}

func abs(v int) int {
	if v < 0 {
		return -v
	}
	return v
}

func (g *grid) landCount() int {
	n := 0
	for _, t := range g.t {
		if t != tWater {
			n++
		}
	}
	return n
}

// grow grows a blob of up to size tiles from start over tiles passing ok,
// picking a random frontier tile each step; it returns the tiles.
func grow(r *rng, g *grid, start, size int, ok func(int) bool) []int {
	in := make([]bool, len(g.t))
	in[start] = true
	out := []int{start}
	frontier := []int{}
	push := func(i int) {
		x, y := i%g.n, i/g.n
		for _, d := range dirs4() {
			nx, ny := x+d[0], y+d[1]
			if !g.in(nx, ny) {
				continue
			}
			j := ny*g.n + nx
			if !in[j] && ok(j) {
				frontier = append(frontier, j)
			}
		}
	}
	push(start)
	for len(out) < size && len(frontier) > 0 {
		k := r.intn(len(frontier))
		j := frontier[k]
		frontier[k] = frontier[len(frontier)-1]
		frontier = frontier[:len(frontier)-1]
		if in[j] {
			continue
		}
		in[j] = true
		out = append(out, j)
		push(j)
	}
	return out
}

// shape builds the tiles of one island: land mass, coast ring, mountain
// clusters with the deposit slots on their edge, forest patches and grass
// elsewhere (rocks: a two-tile coast band around a mountain core). It
// returns nil when the attempt does not fit (land outside the area
// window, no room for the slots); the caller retries with a new sub-seed.
func shape(r *rng, sc *content.SizeClass, deposits []string) *grid {
	g := landMass(r, sc.Size, sc.Rock)
	land := g.landCount()
	area := sc.Size * sc.Size
	lo, hi := area*landMinPct/100, area*landMaxPct/100
	if sc.Rock {
		lo, hi = area*rockMinPct/100, area*rockMaxPct/100
	}
	if land < lo || land > hi {
		return nil
	}
	if sc.Rock {
		dist := g.waterDistance(4)
		for i, t := range g.t {
			switch {
			case t == tWater:
			case dist[i] == 1:
				g.t[i] = tCoast
			default:
				g.t[i] = tMountain
			}
		}
		if !g.landing(r) {
			return nil
		}
	} else {
		dist := g.waterDistance(4)
		for i, t := range g.t {
			if t != tWater && dist[i] == 1 {
				g.t[i] = tCoast
			}
		}
		mountains := r.between(1, 2)
		total := land * r.between(mountainMinPct, mountainMaxPct) / 100
		for m := range mountains {
			size := total / mountains
			if m == 0 {
				size += total % mountains
			}
			var seeds []int
			for i, t := range g.t {
				if t == tGrass && dist[i] >= 4 {
					seeds = append(seeds, i)
				}
			}
			if len(seeds) == 0 {
				return nil
			}
			tiles := grow(r, g, seeds[r.intn(len(seeds))], size, func(j int) bool { return g.t[j] == tGrass && dist[j] >= 3 })
			for _, i := range tiles {
				g.t[i] = tMountain
			}
		}
		patches := r.between(1, 3)
		forest := land * r.between(forestMinPct, forestMaxPct) / 100
		for p := range patches {
			size := forest / patches
			if p == 0 {
				size += forest % patches
			}
			var seeds []int
			for i, t := range g.t {
				if t == tGrass {
					seeds = append(seeds, i)
				}
			}
			if len(seeds) == 0 {
				return nil
			}
			tiles := grow(r, g, seeds[r.intn(len(seeds))], size, func(j int) bool { return g.t[j] == tGrass })
			for _, i := range tiles {
				g.t[i] = tForest
			}
		}
		if !g.buildableConnected() || !g.has(tGrass) || !g.has(tForest) {
			return nil
		}
	}
	if !g.placeSlots(r, deposits) {
		return nil
	}
	return g
}

// landing deepens the one-tile coast of a rock to two tiles along a
// random straight four-tile stretch of shore with open water in front, so
// that a Trading Post (two land rows behind two water rows) fits.
func (g *grid) landing(r *rng) bool {
	type cand struct{ x, y, fx, fy, lx, ly int }
	var cands []cand
	for i, t := range g.t {
		if t != tCoast {
			continue
		}
		x, y := i%g.n, i/g.n
		for _, f := range dirs4() {
			lx, ly := -f[1], f[0]
			ok := true
			for k := 0; k < 4 && ok; k++ {
				bx, by := x+k*lx, y+k*ly
				ok = g.at(bx, by) == tCoast && g.at(bx+f[0], by+f[1]) == tWater && g.at(bx+2*f[0], by+2*f[1]) == tWater &&
					g.at(bx-f[0], by-f[1]) != tWater
			}
			if ok {
				cands = append(cands, cand{x, y, f[0], f[1], lx, ly})
			}
		}
	}
	if len(cands) == 0 {
		return false
	}
	c := cands[r.intn(len(cands))]
	for k := range 4 {
		ix, iy := c.x+k*c.lx-c.fx, c.y+k*c.ly-c.fy
		g.t[iy*g.n+ix] = tCoast
	}
	return true
}

// Shape parameters (percent): land of the size x size extent, mountain and
// forest shares of the land.
const (
	landMinPct     = 44
	landMaxPct     = 60
	rockMinPct     = 70
	rockMaxPct     = 100
	mountainMinPct = 4
	mountainMaxPct = 8
	forestMinPct   = 18
	forestMaxPct   = 30
)

func (g *grid) has(t byte) bool {
	for _, v := range g.t {
		if v == t {
			return true
		}
	}
	return false
}

// buildableConnected reports whether the buildable land forms one
// 4-connected component (mountains never cut an island in two: roads
// cannot cross them).
func (g *grid) buildableConnected() bool {
	comp := make([]int, len(g.t))
	ok := func(j int) bool { return buildable(g.t[j]) }
	n := 0
	for i := range g.t {
		if ok(i) && comp[i] == 0 {
			n++
			if n > 1 {
				return false
			}
			g.flood(i, n, comp, ok)
		}
	}
	return n == 1
}

// edgeMountain reports whether tile i is a mountain 4-adjacent to
// buildable land.
func (g *grid) edgeMountain(i int) bool {
	if g.t[i] != tMountain {
		return false
	}
	x, y := i%g.n, i/g.n
	for _, d := range dirs4() {
		if buildable(g.at(x+d[0], y+d[1])) {
			return true
		}
	}
	return false
}

// placeSlots places one slot per entry of kinds: two 4-adjacent edge
// mountain tiles, at Chebyshev distance >= 3 from every tile of another
// slot (no 3x3 footprint covers two slots).
func (g *grid) placeSlots(r *rng, kinds []string) bool {
	type pair struct{ a, b int }
	var cands []pair
	for i := range g.t {
		if !g.edgeMountain(i) {
			continue
		}
		x, y := i%g.n, i/g.n
		for _, d := range [2][2]int{{1, 0}, {0, 1}} {
			nx, ny := x+d[0], y+d[1]
			if g.in(nx, ny) && g.edgeMountain(ny*g.n+nx) {
				cands = append(cands, pair{i, ny*g.n + nx})
			}
		}
	}
	r.shuffle(len(cands), func(i, j int) { cands[i], cands[j] = cands[j], cands[i] })
	far := func(a, b int) bool {
		return max(abs(a%g.n-b%g.n), abs(a/g.n-b/g.n)) >= 3
	}
	for _, kind := range kinds {
		placed := false
		for _, c := range cands {
			ok := true
			for _, s := range g.slots {
				for _, t := range s.tiles {
					if !far(t, c.a) || !far(t, c.b) {
						ok = false
					}
				}
			}
			if ok {
				g.slots = append(g.slots, slot{kind: kind, tiles: [2]int{c.a, c.b}})
				g.dep[c.a], g.dep[c.b] = len(g.slots), len(g.slots)
				placed = true
				break
			}
		}
		if !placed {
			return false
		}
	}
	return true
}
