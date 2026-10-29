package archipelago

import "slices"

// Rivers (D-058 part 3): from a source on the ridge spine downhill to a
// mouth in a concave stretch of beach, one tile wide, widening to an
// estuary; river tiles are water inside the land that a road crosses as
// a bridge.

// riverMinPct is the minimum length of a river, percent of the island's
// span (the longer side of its bounding box).
const riverMinPct = 40

// riverTries bounds the source/mouth pairs tried per river.
const riverTries = 20

// river is one river: the main path from the source to the mouth and the
// estuary tiles beside it (of: the main index each one widens).
type river struct {
	main     []int
	side, of []int
}

// rivers draws up to count rivers (D-058 part 3, round 2): from a source
// high on the massif along the cheapest noisy downhill path to a concave
// beach at least 40 % of the island's span long, smoothed and given a
// gentle low-frequency meander; the last 6-10 tiles widen to an estuary
// of two to three tiles and the mouth opens into a small bay.
func (g *grid) rivers(r *rng, count, size int, dist, sea []int) []river {
	if count == 0 {
		return nil
	}
	n := g.n
	x0, y0, x1, y1 := n, n, 0, 0
	for i, t := range g.t {
		if t != tWater {
			x0, y0, x1, y1 = min(x0, i%n), min(y0, i/n), max(x1, i%n), max(y1, i/n)
		}
	}
	span := max(x1-x0, y1-y0) + 1
	minLen := span * riverMinPct / 100
	// Concavity of the beach: land tiles in a window around a coast tile
	// (a bay has more land around it than a cape).
	rad := max(4, size/16)
	sat := make([]int, (n+1)*(n+1))
	for y := range n {
		for x := range n {
			v := 0
			if g.t[y*n+x] != tWater {
				v = 1
			}
			sat[(y+1)*(n+1)+x+1] = v + sat[y*(n+1)+x+1] + sat[(y+1)*(n+1)+x] - sat[y*(n+1)+x]
		}
	}
	window := func(i int) int {
		x, y := i%n, i/n
		x0, y0, x1, y1 := max(0, x-rad), max(0, y-rad), min(n, x+rad+1), min(n, y+rad+1)
		return sat[y1*(n+1)+x1] - sat[y0*(n+1)+x1] - sat[y1*(n+1)+x0] + sat[y0*(n+1)+x0]
	}
	var coast []int
	for i, t := range g.t {
		x, y := i%n, i/n
		if t == tCoast && !g.inPlain(x, y, 3) && g.touches4(i, tWater) {
			coast = append(coast, i)
		}
	}
	if len(coast) == 0 {
		return nil
	}
	conc := make([]int, len(g.t))
	for _, i := range coast {
		conc[i] = window(i)
	}
	slices.SortStableFunc(coast, func(a, b int) int { return conc[b] - conc[a] })
	meander := newFBM(r, n, max(4, size/8), size*3*10/100, 3)
	wiggle := newNoise(r, n, max(3, size/24), 30)
	inBay := make([]bool, len(g.t))
	for _, i := range coast[:max(1, len(coast)*25/100)] {
		inBay[i] = true
	}
	near := make([]bool, len(g.t))
	var out []river
	for range count {
		for range riverTries {
			source, ok := g.pick(r, func(i int) bool {
				return g.t[i] == tMountain && g.hgt[i] >= 3 && dist[i] >= 4 && !near[i]
			})
			if !ok {
				break
			}
			cost, from := g.riverCosts(source, dist, sea, near, inBay, meander, wiggle)
			var bays []int
			for _, i := range coast {
				apart := true
				for _, o := range out {
					apart = apart && cheb(i, o.main[0], n) >= size/4 && cheb(i, o.main[len(o.main)-1], n) >= size/4
				}
				if inBay[i] && cost[i] >= 0 && !near[i] && apart && cheb(i, source, n) >= minLen*3/4 {
					bays = append(bays, i)
				}
			}
			if len(bays) == 0 {
				continue
			}
			slices.SortStableFunc(bays, func(a, b int) int { return cost[a] - cost[b] })
			mouth := bays[r.intn(min(len(bays), 4))]
			var rev []int
			for i := mouth; i >= 0; i = from[i] {
				rev = append(rev, i)
			}
			if g.pathLen(rev) < minLen {
				continue
			}
			path := make([]int, len(rev))
			for k, i := range rev {
				path[len(rev)-1-k] = i
			}
			onCurve := func(i int) bool {
				t := g.t[i]
				return !near[i] && !g.harbour[i] && (t == tGrass || t == tMountain) && dist[i] >= 2
			}
			amp := max(2, size/20)
			for _, a := range [4]int{amp, amp * 2 / 3, amp / 3, 0} {
				if c := g.meander(r, path, a, onCurve); c != nil {
					path = c
					break
				}
			}
			if g.pathLen(path) < minLen {
				continue
			}
			rv := g.estuary(r, river{main: path})
			for _, i := range append(slices.Clone(rv.main), rv.side...) {
				x, y := i%n, i/n
				for dy := -2; dy <= 2; dy++ {
					for dx := -2; dx <= 2; dx++ {
						if g.in(x+dx, y+dy) {
							near[(y+dy)*n+x+dx] = true
						}
					}
				}
			}
			out = append(out, rv)
			break
		}
	}
	return out
}

// pathLen approximates the length in tiles of a 4-connected path: the
// straight distances between every fourth tile (a staircase counts as its
// diagonal).
func (g *grid) pathLen(path []int) int {
	n := g.n
	l2 := 0 // x16
	for k := 0; k < len(path)-1; k += 4 {
		a, b := path[k], path[min(k+4, len(path)-1)]
		dx, dy := (a%n-b%n)*16, (a/n-b/n)*16
		l2 += isqrt(dx*dx + dy*dy)
	}
	return l2 / 16
}

// estuary widens the last 6-10 tiles of a river to two tiles (the last
// half of them to three), turns them into river tiles and opens the mouth
// into a small bay: a disc of radius 2-3 around the mouth becomes sea,
// the land around it beach (cliff beside mountains).
func (g *grid) estuary(r *rng, rv river) river {
	n := g.n
	k := len(rv.main)
	l := min(r.between(6, 10), k-2)
	free := func(j int) bool {
		t := g.t[j]
		return (t == tGrass || t == tCoast || t == tForest) && !slices.Contains(rv.main, j) && !slices.Contains(rv.side, j)
	}
	sideA := r.intn(2)
	for m := k - l; m < k; m++ {
		a, b := rv.main[m-1], rv.main[m]
		fx, fy := b%n-a%n, b/n-a/n
		for s := range 2 {
			if s != sideA && m < k-l/2 {
				continue
			}
			px, py := -fy, fx
			if s == 1 {
				px, py = fy, -fx
			}
			x, y := b%n+px, b/n+py
			if g.in(x, y) && free(y*n+x) {
				rv.side = append(rv.side, y*n+x)
				rv.of = append(rv.of, m)
			}
		}
	}
	for _, i := range rv.main {
		g.t[i], g.hgt[i] = tRiver, 0
	}
	for _, i := range rv.side {
		g.t[i], g.hgt[i] = tRiver, 0
	}
	// The mouth bay.
	mouth := rv.main[k-1]
	rad := r.between(2, 3)
	mx, my := mouth%n, mouth/n
	sea := make([]bool, len(g.t))
	for y := my - rad; y <= my+rad; y++ {
		for x := mx - rad; x <= mx+rad; x++ {
			if !g.in(x, y) || (x-mx)*(x-mx)+(y-my)*(y-my) > rad*rad+rad {
				continue
			}
			i := y*n + x
			if t := g.t[i]; t != tWater && t != tCliff && t != tMountain {
				g.t[i], g.hgt[i], g.lvl[i] = tWater, 0, 0
				sea[i] = true
			}
		}
	}
	keep := func(list []int) []int {
		return slices.DeleteFunc(list, func(i int) bool { return sea[i] })
	}
	// Estuary tiles beside a main tile the bay took turn to beach.
	var side, of []int
	for k, i := range rv.side {
		switch {
		case sea[i]:
		case sea[rv.main[rv.of[k]]]:
			g.t[i], g.lvl[i] = tCoast, 0
		default:
			side, of = append(side, i), append(of, rv.of[k])
		}
	}
	rv.side, rv.of = side, of
	rv.main = keep(rv.main)
	for k, m := range rv.of {
		rv.of[k] = min(m, len(rv.main)-1)
	}
	for i := range g.t {
		if g.t[i] != tGrass && g.t[i] != tForest {
			continue
		}
		x, y := i%n, i/n
		for dy := -1; dy <= 1; dy++ {
			for dx := -1; dx <= 1; dx++ {
				if g.in(x+dx, y+dy) && sea[(y+dy)*n+x+dx] {
					g.t[i], g.lvl[i] = tCoast, 0
				}
			}
		}
	}
	return rv
}

// touches4 reports whether tile i has a 4-neighbour of terrain t.
func (g *grid) touches4(i int, t byte) bool {
	x, y := i%g.n, i/g.n
	for _, d := range dirs4() {
		if g.in(x+d[0], y+d[1]) && g.at(x+d[0], y+d[1]) == t {
			return true
		}
	}
	return false
}

func cheb(a, b, n int) int { return max(abs(a%n-b%n), abs(a/n-b/n)) }

// riverCosts runs Dijkstra from source over the tiles a river may take
// (4-connected, ties by tile index) and returns the cost and predecessor
// of every tile (cost -1: unreachable). Steps cost more uphill (away from
// the sea), on mountains (the river leaves them quickly) and next to the
// beach, plus meander noise; rivers stay off cliffs, the beach (but for
// bay tiles, which end a path) and other rivers.
func (g *grid) riverCosts(source int, dist, sea []int, near, bay []bool, meander fbm, wiggle *noise) ([]int, []int) {
	n := g.n
	cost := make([]int, len(g.t))
	from := make([]int, len(g.t))
	for i := range cost {
		cost[i] = -1
	}
	h := &minHeap{}
	cost[source] = 0
	from[source] = -1
	h.push(0, source)
	for h.len() > 0 {
		c, i := h.pop()
		if c != cost[i] || (bay[i] && i != source) {
			continue
		}
		x, y := i%n, i/n
		for _, d := range dirs4() {
			nx, ny := x+d[0], y+d[1]
			if !g.in(nx, ny) {
				continue
			}
			j := ny*n + nx
			t := g.t[j]
			if near[j] || g.harbour[j] || (!bay[j] && ((t != tGrass && t != tMountain) || dist[j] < 2)) {
				continue
			}
			// Downhill on the noisy height (the distance to the sea plus
			// meander noise) is cheap, uphill dear, and the step cost
			// itself is noisy: the river winds along the valleys of the
			// noise towards the sea, leaving the mountains quickly and
			// keeping off the beach.
			step := 10 + wiggle.smooth(nx, ny) + 30
			if up := sea[j] + meander.at(nx, ny) - sea[i] - meander.at(x, y); up > 0 {
				step += 30 * up
			}
			switch {
			case t == tMountain:
				step += 40
			case dist[j] == 2:
				step += 60
			case dist[j] == 3:
				step += 30
			}
			if nc := c + step; cost[j] < 0 || nc < cost[j] {
				cost[j], from[j] = nc, i
				h.push(nc, j)
			}
		}
	}
	return cost, from
}

// meander smooths a river path and gives it a gentle meander: the path
// (tile centres) is averaged over seventeen tiles, shifted sideways by
// low-frequency value noise of up to amp tiles along its length (zero at
// the source and the mouth), sampled every six tiles and joined by a
// Catmull-Rom spline rasterised 4-connected. The source and the mouth
// stay; nil when a curve tile is not ok (interior) or the curve does not
// stay a simple chain.
func (g *grid) meander(r *rng, path []int, amp int, ok func(i int) bool) []int {
	n := g.n
	const stride = 6
	k := len(path)
	if k < 3*stride {
		return nil
	}
	type pt struct{ x, y int } // x16
	px, py := make([]int, k), make([]int, k)
	for m, i := range path {
		px[m], py[m] = (i%n)*16+8, (i/n)*16+8
	}
	sx, sy := make([]int, k), make([]int, k)
	for m := range k {
		a, b := max(0, m-8), min(k-1, m+8)
		w := min(m-a, b-m) // symmetric window: the ends stay
		for j := m - w; j <= m+w; j++ {
			sx[m] += px[j]
			sy[m] += py[j]
		}
		sx[m] /= 2*w + 1
		sy[m] /= 2*w + 1
	}
	// Lateral offset noise along the path: lattice every cell tiles.
	cell := max(12, min(24, k/3))
	lat := make([]int, k/cell+3)
	for j := range lat {
		lat[j] = r.between(-amp*16, amp*16)
	}
	offset := func(m int) int {
		j, f := m/cell, (m%cell)*1024/cell
		s := smoothstep(f)
		v := (lat[j]*(1024-s) + lat[j+1]*s) / 1024
		taper := min(m, k-1-m, stride) // ramps in over the first and last tiles
		return v * taper / stride
	}
	var ctl []pt
	for m := 0; m < k; m += stride {
		x, y := sx[m], sy[m]
		if m > 0 {
			a, b := max(0, m-3), min(k-1, m+3)
			tx, ty := sx[b]-sx[a], sy[b]-sy[a]
			if l := isqrt(tx*tx + ty*ty); l > 0 {
				o := offset(m)
				x, y = x-ty*o/l, y+tx*o/l
			}
		}
		ctl = append(ctl, pt{x, y})
	}
	last := path[k-1]
	end := pt{(last%n)*16 + 8, (last/n)*16 + 8}
	if (k-1)%stride == 0 {
		ctl[len(ctl)-1] = end
	} else {
		ctl = append(ctl, end)
	}
	at := func(j int) pt { return ctl[min(max(j, 0), len(ctl)-1)] }
	var out []int
	add := func(x, y int) bool {
		if !g.in(x, y) {
			return false
		}
		i := y*n + x
		if len(out) > 0 {
			p := out[len(out)-1]
			qx, qy := p%n, p/n
			if p == i {
				return true
			}
			if abs(qx-x) > 1 || abs(qy-y) > 1 {
				return false
			}
			if qx != x && qy != y {
				// A diagonal step: go round the corner that is ok.
				c := qy*n + x
				if !ok(c) {
					c = y*n + qx
				}
				out = append(out, c)
			}
		}
		out = append(out, i)
		return true
	}
	for j := 0; j+1 < len(ctl); j++ {
		p0, p1, p2, p3 := at(j-1), at(j), at(j+1), at(j+2)
		const steps = 64
		for s := 0; s < steps; s++ {
			t := s * 1024 / steps
			t2 := t * t / 1024
			t3 := t2 * t / 1024
			cr := func(a, b, c, d int) int {
				return (2*b*1024 + (c-a)*t + (2*a-5*b+4*c-d)*t2 + (3*b-a-3*c+d)*t3) / 2048
			}
			if !add(cr(p0.x, p1.x, p2.x, p3.x)>>4, cr(p0.y, p1.y, p2.y, p3.y)>>4) {
				return nil
			}
		}
	}
	if !add(last%n, last/n) {
		return nil
	}
	// The curve must run from the source to the mouth through ok tiles,
	// 4-connected, without touching itself.
	pos := make(map[int]int, len(out))
	for m, i := range out {
		if _, dup := pos[i]; dup {
			return nil
		}
		pos[i] = m
	}
	for m, i := range out {
		for _, d := range dirs4() {
			if g.in(i%n+d[0], i/n+d[1]) {
				if o, on := pos[i+d[1]*n+d[0]]; on && abs(o-m) > 1 {
					return nil
				}
			}
		}
		if m > 0 && m < len(out)-1 && !ok(i) {
			return nil
		}
		if m > 0 && abs(i%n-out[m-1]%n)+abs(i/n-out[m-1]/n) != 1 {
			return nil
		}
	}
	if out[0] != path[0] {
		return nil
	}
	return out
}

// minHeap is a binary heap of (cost, tile) pairs ordered by cost, then
// tile index (deterministic ties).
type minHeap struct{ c, i []int }

func (h *minHeap) len() int { return len(h.c) }

func (h *minHeap) less(a, b int) bool {
	return h.c[a] < h.c[b] || (h.c[a] == h.c[b] && h.i[a] < h.i[b])
}

func (h *minHeap) swap(a, b int) {
	h.c[a], h.c[b] = h.c[b], h.c[a]
	h.i[a], h.i[b] = h.i[b], h.i[a]
}

func (h *minHeap) push(c, i int) {
	h.c, h.i = append(h.c, c), append(h.i, i)
	k := len(h.c) - 1
	for k > 0 {
		p := (k - 1) / 2
		if !h.less(k, p) {
			break
		}
		h.swap(k, p)
		k = p
	}
}

func (h *minHeap) pop() (int, int) {
	c, i := h.c[0], h.i[0]
	last := len(h.c) - 1
	h.swap(0, last)
	h.c, h.i = h.c[:last], h.i[:last]
	k := 0
	for {
		l, r, m := 2*k+1, 2*k+2, k
		if l < last && h.less(l, m) {
			m = l
		}
		if r < last && h.less(r, m) {
			m = r
		}
		if m == k {
			break
		}
		h.swap(k, m)
		k = m
	}
	return c, i
}
