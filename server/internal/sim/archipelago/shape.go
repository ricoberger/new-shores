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
	tRiver
	tIslet
	tCliff
)

// margin is the water border around an island's land: the water rows of a
// Trading Post or shipyard on the outer coast must lie on the grid.
const margin = 3

// grid is an island under construction.
type grid struct {
	n int // width = height
	// pad is the water border around the land extent (margin for rocks,
	// more for habitable islands, whose islets lie in it).
	pad int
	t   []byte
	// lvl and hgt are the terrace level and rock height per tile (D-058;
	// nil for rocks until set).
	lvl, hgt []int
	// plain is the reserved plain square (x, y, side; side 0: none).
	plain [3]int
	// dep holds the deposit slot (1-based index into slots) per tile, 0 for
	// none; nil until placeSlots places one.
	dep   []int
	slots []slot
	s     *scratch
}

// scratch holds the work buffers of the shape attempts of one island,
// reused from attempt to attempt (the attempts of the large islands
// dominate the generator's time, D-054). Reuse never changes a result:
// every buffer is cleared before use.
type scratch struct {
	t     []byte
	comp  []int
	dist  []int
	stack []int
	in    []bool
	out   []int
	front []int
	// reject names the step that turned the last shape attempt down
	// (statistics of the island atlas; never read by the generator).
	reject string
}

// ints returns buf resized to n and zeroed.
func ints(buf []int, n int) []int {
	if cap(buf) < n {
		return make([]int, n)
	}
	buf = buf[:n]
	clear(buf)
	return buf
}

// slot is one deposit slot: two 4-adjacent mountain tiles on the edge of
// a mountain cluster.
type slot struct {
	kind  string
	tiles [2]int
}

// newGrid returns an all-water grid of n x n tiles on the scratch buffers
// (nil: fresh buffers).
func newGrid(n int, s *scratch) *grid {
	if s == nil {
		s = &scratch{}
	}
	if cap(s.t) < n*n {
		s.t = make([]byte, n*n)
	}
	s.t = s.t[:n*n]
	clear(s.t)
	return &grid{n: n, pad: margin, t: s.t, s: s}
}

func (g *grid) in(x, y int) bool { return x >= 0 && y >= 0 && x < g.n && y < g.n }
func (g *grid) at(x, y int) byte {
	if !g.in(x, y) {
		return tWater
	}
	return g.t[y*g.n+x]
}

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
func landMass(r *rng, size int, rock bool, s *scratch) *grid {
	n := size + 2*margin
	g := newGrid(n, s)
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
// three or more becomes land (inside the pad), until nothing changes
// (bounded).
func (g *grid) smooth() {
	for range 8 {
		changed := false
		for y := g.pad; y < g.n-g.pad; y++ {
			for x := g.pad; x < g.n-g.pad; x++ {
				i := y*g.n + x
				// Inside the margin every neighbour is on the grid.
				n := 0
				for _, j := range [4]int{i - g.n, i + 1, i + g.n, i - 1} {
					if g.t[j] != tWater {
						n++
					}
				}
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
	g.s.comp = ints(g.s.comp, len(g.t))
	comp := g.s.comp
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
	g.s.comp = ints(g.s.comp, len(g.t))
	comp := g.s.comp
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
	stack := append(g.s.stack[:0], start)
	comp[start] = id
	size := 0
	visit := func(j int) {
		if comp[j] == 0 && ok(j) {
			comp[j] = id
			stack = append(stack, j)
		}
	}
	for len(stack) > 0 {
		i := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		size++
		x, y := i%g.n, i/g.n
		// dirs4 order: up, right, down, left.
		if y > 0 {
			visit(i - g.n)
		}
		if x < g.n-1 {
			visit(i + 1)
		}
		if y < g.n-1 {
			visit(i + g.n)
		}
		if x > 0 {
			visit(i - 1)
		}
	}
	g.s.stack = stack[:0]
	return size
}

// waterDistance returns the Chebyshev distance of every tile to the
// nearest water tile (0 on water; tiles off the grid count as water),
// capped at limit: a breadth-first search over the 8-neighbourhood from
// all water tiles at once.
func (g *grid) waterDistance(limit int) []int {
	g.s.dist = ints(g.s.dist, len(g.t))
	d := g.s.dist
	queue := g.s.stack[:0]
	for i, t := range g.t {
		x, y := i%g.n, i/g.n
		switch {
		case t == tWater:
		case x == 0 || y == 0 || x == g.n-1 || y == g.n-1:
			d[i] = 1
			queue = append(queue, i)
		default:
			d[i] = -1
		}
	}
	for i, t := range g.t {
		if t != tWater {
			continue
		}
		x, y := i%g.n, i/g.n
		for dy := -1; dy <= 1; dy++ {
			for dx := -1; dx <= 1; dx++ {
				nx, ny := x+dx, y+dy
				if g.in(nx, ny) && d[ny*g.n+nx] == -1 {
					d[ny*g.n+nx] = 1
					queue = append(queue, ny*g.n+nx)
				}
			}
		}
	}
	for head := 0; head < len(queue); head++ {
		i := queue[head]
		if d[i] >= limit {
			continue
		}
		x, y := i%g.n, i/g.n
		for dy := -1; dy <= 1; dy++ {
			for dx := -1; dx <= 1; dx++ {
				nx, ny := x+dx, y+dy
				if g.in(nx, ny) && d[ny*g.n+nx] == -1 {
					d[ny*g.n+nx] = d[i] + 1
					queue = append(queue, ny*g.n+nx)
				}
			}
		}
	}
	for i := range d {
		if d[i] == -1 || d[i] > limit {
			d[i] = limit
		}
	}
	g.s.stack = queue[:0]
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
// picking a random frontier tile each step; it returns the tiles (valid
// until the next grow).
func grow(r *rng, g *grid, start, size int, ok func(int) bool) []int {
	if cap(g.s.in) < len(g.t) {
		g.s.in = make([]bool, len(g.t))
	}
	in := g.s.in[:len(g.t)]
	clear(in)
	in[start] = true
	out := append(g.s.out[:0], start)
	frontier := g.s.front[:0]
	defer func() { g.s.out, g.s.front = out[:0], frontier[:0] }()
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

// shape builds the tiles of one island. A habitable island is a
// skeleton shape with a ridge, cliffs, a plain, rivers, forests, terrace
// levels and islets (habitable, D-058); a rock is a blob with a two-tile
// coast band around a mountain core. It returns nil when the attempt does
// not fit (land outside the area window, no room for a feature or the
// slots); the caller retries with a new sub-seed.
func shape(r *rng, sc *content.SizeClass, deposits []string, gap int, s *scratch) *grid {
	if !sc.Rock {
		return habitable(r, sc, deposits, gap, s)
	}
	g := landMass(r, sc.Size, true, s)
	land := g.landCount()
	area := sc.Size * sc.Size
	if land < area*rockMinPct/100 || land > area*rockMaxPct/100 {
		return nil
	}
	dist := g.waterDistance(4)
	g.lvl, g.hgt = make([]int, len(g.t)), make([]int, len(g.t))
	for i, t := range g.t {
		switch {
		case t == tWater:
		case dist[i] == 1:
			g.t[i] = tCoast
		default:
			g.t[i] = tMountain
			g.hgt[i] = min(dist[i]-1, 3)
		}
	}
	if !g.landing(r) {
		return nil
	}
	for i, t := range g.t {
		if t == tCoast {
			g.hgt[i] = 0
		}
	}
	if !g.placeSlots(r, deposits, gap) {
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

// pick returns the k-th tile in row-major order passing ok, k drawn
// uniformly from their count (one draw, like indexing a list of them).
func (g *grid) pick(r *rng, ok func(int) bool) (int, bool) {
	n := 0
	for i := range g.t {
		if ok(i) {
			n++
		}
	}
	if n == 0 {
		return 0, false
	}
	k := r.intn(n)
	for i := range g.t {
		if ok(i) {
			if k == 0 {
				return i, true
			}
			k--
		}
	}
	return 0, false
}

func (g *grid) has(t byte) bool {
	for _, v := range g.t {
		if v == t {
			return true
		}
	}
	return false
}

// fillPockets turns every 4-connected component of buildable land but the
// largest (the first in row-major order on ties) into mountain, unless
// they hold more than limit tiles together: then the mountains cut the
// island in two and it reports false.
func (g *grid) fillPockets(limit int) bool {
	g.s.comp = ints(g.s.comp, len(g.t))
	comp := g.s.comp
	ok := func(j int) bool { return buildable(g.t[j]) }
	best, bestSize, total, id := 0, 0, 0, 0
	for i := range g.t {
		if !ok(i) || comp[i] != 0 {
			continue
		}
		id++
		size := g.flood(i, id, comp, ok)
		total += size
		if size > bestSize {
			best, bestSize = id, size
		}
	}
	if total-bestSize > limit {
		return false
	}
	for i := range g.t {
		if comp[i] != 0 && comp[i] != best {
			g.t[i] = tMountain
		}
	}
	return true
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
// mountain tiles, at Chebyshev distance >= gap from every tile of another
// slot (gap is the longest side of a deposit building, so no footprint
// covers two slots: a mine occupies exactly one, MECHANICS §2).
func (g *grid) placeSlots(r *rng, kinds []string, gap int) bool {
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
		return max(abs(a%g.n-b%g.n), abs(a/g.n-b/g.n)) >= gap
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
				if g.dep == nil {
					g.dep = make([]int, len(g.t))
				}
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
