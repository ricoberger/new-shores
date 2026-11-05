package archipelago

import (
	"slices"

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
	// pad is the water border around the land extent (margin, more for
	// islands whose islets lie in it).
	pad int
	t   []byte
	// lvl and hgt are the terrace level and rock height per tile (D-058).
	lvl, hgt []int
	// plain is the reserved plain square (x, y, side; side 0: none).
	plain [3]int
	// harbour marks the stretches of coast kept as straight beach for
	// harbour sites (no notches, no cliff).
	harbour []bool
	// dep holds the deposit slot (1-based index into slots) per tile, 0 for
	// none; nil until placeSlots places one.
	dep   []int
	slots []slot
	// mass holds the massif (1-based) per tile, 0 for none (D-072 §4);
	// massifCount is the number of massifs drawn.
	mass        []int
	massifCount int
	s           *scratch
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
	// foot is the reserved footprint (x, y, w, h; w 0: none), the
	// generator's own (D-072 part 2).
	foot [4]int
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

// shape builds the tiles of one island: a skeleton shape with massifs
// massifs around its rim, cliffs, a plain, rivers, forests, terrace levels
// and islets (D-058, D-072). It returns nil when the attempt does not fit
// (land outside the area window, no room for a feature or the slots); the
// caller retries with a new sub-seed.
func shape(r *rng, sc *content.SizeClass, massifs int, deposits []string, sr slotRules, s *scratch) *grid {
	return habitable(r, sc, massifs, deposits, sr, s)
}

// Shape parameters (percent): mountain and forest shares of the land (habitable islands use the
// bounds in habitable.go).
const (
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
// mountain tiles, at Chebyshev distance >= sr.gap from every tile of
// another slot, with a reserved footprint (D-072 part 2): a rectangle of
// the kind's footprint (either rotation) on mountain tiles that covers a
// tile of the slot, no other slot's tile and no earlier reservation, with
// a buildable tile 4-adjacent to it where a road can reach it. A
// candidate without one is skipped; every slot so admits its building
// next to every other (MECHANICS §2). The reservation is the generator's
// own (Verify finds such footprints on the tiles again). The slots spread
// over the massifs (D-072 §4): the k-th slot prefers the k-th massif by
// size (round robin), then any massif that holds no slot of its kind yet,
// then any edge.
func (g *grid) placeSlots(r *rng, kinds []string, sr slotRules) bool {
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
		return max(abs(a%g.n-b%g.n), abs(a/g.n-b/g.n)) >= sr.gap
	}
	order := g.massifOrder()
	massifOf := func(i int) int {
		if g.mass == nil {
			return 0
		}
		return g.mass[i]
	}
	// used[kind] holds the massifs carrying a slot of the kind.
	used := map[string][]int{}
	for k, kind := range kinds {
		want := 0
		if len(order) > 0 {
			want = order[k%len(order)]
		}
		fresh := func(c pair) bool {
			m := massifOf(c.a)
			return m != 0 && m == massifOf(c.b) && !slices.Contains(used[kind], m)
		}
		placed := false
		for pass := range 3 {
			for _, c := range cands {
				switch {
				case pass == 0 && (want == 0 || massifOf(c.a) != want || massifOf(c.b) != want || !fresh(c)):
					continue
				case pass == 1 && (len(order) < 2 || !fresh(c)):
					continue
				}
				ok := true
				for _, s := range g.slots {
					for _, t := range s.tiles {
						if !far(t, c.a) || !far(t, c.b) {
							ok = false
						}
					}
					// Never a slot inside an earlier reservation.
					for _, t := range [2]int{c.a, c.b} {
						if f := s.foot; f[2] > 0 && t%g.n >= f[0] && t%g.n < f[0]+f[2] && t/g.n >= f[1] && t/g.n < f[1]+f[3] {
							ok = false
						}
					}
				}
				if !ok {
					continue
				}
				foot, ok := g.reserve(c.a, c.b, sr.feet[kind])
				if !ok {
					continue
				}
				g.slots = append(g.slots, slot{kind: kind, tiles: [2]int{c.a, c.b}, foot: foot})
				if g.dep == nil {
					g.dep = make([]int, len(g.t))
				}
				g.dep[c.a], g.dep[c.b] = len(g.slots), len(g.slots)
				if m := massifOf(c.a); m != 0 {
					used[kind] = append(used[kind], m)
				}
				placed = true
				break
			}
			if placed {
				break
			}
		}
		if !placed {
			return false
		}
	}
	return true
}

// reserve returns the first footprint of size foot (either rotation;
// zero: no reservation needed) that covers tile a or b on mountain tiles
// only, holds no deposit tile, overlaps no slot's reservation and has a
// buildable tile 4-adjacent to it, in a fixed order.
func (g *grid) reserve(a, b int, foot [2]int) ([4]int, bool) {
	if foot[0] == 0 || foot[1] == 0 {
		return [4]int{}, true
	}
	for _, wh := range [2][2]int{foot, {foot[1], foot[0]}} {
		w, h := wh[0], wh[1]
		for _, t := range [2]int{a, b} {
			tx, ty := t%g.n, t/g.n
			for y := ty - h + 1; y <= ty; y++ {
				for x := tx - w + 1; x <= tx; x++ {
					if r := [4]int{x, y, w, h}; g.footFree(r) {
						return r, true
					}
				}
			}
		}
	}
	return [4]int{}, false
}

// footFree reports whether the rectangle r (x, y, w, h) lies on the grid
// on mountain tiles without a deposit, overlaps no reservation and has a
// buildable 4-neighbour.
func (g *grid) footFree(r [4]int) bool {
	x0, y0, w, h := r[0], r[1], r[2], r[3]
	if x0 < 0 || y0 < 0 || x0+w > g.n || y0+h > g.n {
		return false
	}
	for _, s := range g.slots {
		f := s.foot
		if f[2] > 0 && x0 < f[0]+f[2] && f[0] < x0+w && y0 < f[1]+f[3] && f[1] < y0+h {
			return false
		}
	}
	for y := y0; y < y0+h; y++ {
		for x := x0; x < x0+w; x++ {
			i := y*g.n + x
			if g.t[i] != tMountain || g.depAt(i) != 0 {
				return false
			}
		}
	}
	for x := x0; x < x0+w; x++ {
		if buildable(g.at(x, y0-1)) || buildable(g.at(x, y0+h)) {
			return true
		}
	}
	for y := y0; y < y0+h; y++ {
		if buildable(g.at(x0-1, y)) || buildable(g.at(x0+w, y)) {
			return true
		}
	}
	return false
}
