package archipelago

import "slices"

// Rivers (D-058 part 3): from a source on the ridge spine downhill to a
// mouth in a concave stretch of beach, one tile wide, two at the mouth;
// river tiles are water inside the land that a road crosses as a bridge.

// riverTries bounds the source/mouth pairs tried per river.
const riverTries = 12

// rivers draws up to count rivers and returns their paths (source to
// mouth; widened mouth tiles appended as -1-index).
func (g *grid) rivers(r *rng, count, size int, dist, sea []int) [][]int {
	if count == 0 {
		return nil
	}
	n := g.n
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
	for _, i := range coast[:max(1, len(coast)*20/100)] {
		inBay[i] = true
	}
	near := make([]bool, len(g.t))
	var out [][]int
	for range count {
		for range riverTries {
			source, ok := g.pick(r, func(i int) bool {
				return g.t[i] == tMountain && g.hgt[i] >= 3 && dist[i] >= 4 && !near[i]
			})
			if !ok {
				break
			}
			cost, from := g.riverCosts(source, dist, sea, near, inBay, meander, wiggle)
			// The mouth: one of the cheapest bays at least size/5 away.
			var bays []int
			for _, i := range coast {
				apart := true
				for _, o := range out {
					apart = apart && cheb(i, o[0], n) >= size/4 && cheb(i, mouthOf(o), n) >= size/4
				}
				if inBay[i] && cost[i] >= 0 && !near[i] && apart && cheb(i, source, n) >= size/4 {
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
			if len(rev) < size/6 {
				continue
			}
			path := make([]int, len(rev))
			for k, i := range rev {
				path[len(rev)-1-k] = i
			}
			onCurve := func(i int) bool {
				t := g.t[i]
				return !near[i] && (t == tGrass || t == tMountain) && dist[i] >= 2
			}
			for _, sway := range [3]int{3, 6, 0} {
				if c := g.curve(r, path, sway, onCurve); c != nil {
					path = c
					break
				}
			}
			path = g.widenMouth(path)
			for _, i := range path {
				if i < 0 {
					i = -1 - i
				}
				g.t[i] = tRiver
				g.hgt[i] = 0
				x, y := i%n, i/n
				for dy := -2; dy <= 2; dy++ {
					for dx := -2; dx <= 2; dx++ {
						if g.in(x+dx, y+dy) {
							near[(y+dy)*n+x+dx] = true
						}
					}
				}
			}
			out = append(out, path)
			break
		}
	}
	return out
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

// mouthOf returns the mouth tile of a river path (its last main tile).
func mouthOf(path []int) int {
	for k := len(path) - 1; k >= 0; k-- {
		if path[k] >= 0 {
			return path[k]
		}
	}
	return path[0]
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
			if near[j] || (!bay[j] && ((t != tGrass && t != tMountain) || dist[j] < 2)) {
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

// curve smooths a river path into a winding curve: control points every
// 7 tiles (stride), shifted sideways at random, joined by a Catmull-Rom
// spline and rasterised 4-connected. Control points move up to
// stride/sway tiles (sway 0: not at all). The source and the mouth
// stay; nil when a curve tile is not ok (interior) or the curve fails to
// stay a simple chain.
func (g *grid) curve(r *rng, path []int, sway int, ok func(i int) bool) []int {
	n := g.n
	const stride = 7
	if len(path) < 2*stride {
		return nil
	}
	type pt struct{ x, y int } // x16
	var ctl []pt
	for k := 0; k < len(path); k += stride {
		i := path[k]
		x, y := (i%n)*16+8, (i/n)*16+8
		if k > 0 && sway > 0 {
			x += r.between(-stride*16/sway, stride*16/sway)
			y += r.between(-stride*16/sway, stride*16/sway)
		}
		ctl = append(ctl, pt{x, y})
	}
	last := path[len(path)-1]
	end := pt{(last%n)*16 + 8, (last/n)*16 + 8}
	if len(path)%stride == 1 {
		ctl[len(ctl)-1] = end
	} else {
		ctl = append(ctl, end)
	}
	at := func(k int) pt { return ctl[min(max(k, 0), len(ctl)-1)] }
	var out []int
	add := func(x, y int) bool {
		if !g.in(x, y) {
			return false
		}
		i := y*n + x
		if len(out) > 0 {
			p := out[len(out)-1]
			px, py := p%n, p/n
			if p == i {
				return true
			}
			if px != x && py != y {
				// A diagonal step: go round the corner that is ok.
				c := py*n + x
				if !ok(c) {
					c = y*n + px
				}
				out = append(out, c)
			}
		}
		out = append(out, i)
		return true
	}
	for k := 0; k+1 < len(ctl); k++ {
		p0, p1, p2, p3 := at(k-1), at(k), at(k+1), at(k+2)
		const steps = 64
		for s := 0; s < steps; s++ {
			// Catmull-Rom with t = s/steps.
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
	// 4-connected, without revisiting a tile.
	seen := map[int]bool{}
	pos := map[int]int{}
	for k, i := range out {
		pos[i] = k
	}
	for k, i := range out {
		// No touching itself: a 4-neighbour on the curve is the previous
		// or next tile.
		for _, d := range dirs4() {
			if g.in(i%n+d[0], i/n+d[1]) {
				if m, on := pos[i+d[1]*n+d[0]]; on && abs(m-k) > 1 {
					return nil
				}
			}
		}
		if seen[i] || (k > 0 && k < len(out)-1 && !ok(i)) {
			return nil
		}
		if k > 0 && abs(i%n-out[k-1]%n)+abs(i/n-out[k-1]/n) != 1 {
			return nil
		}
		seen[i] = true
	}
	if out[0] != path[0] {
		return nil
	}
	return out
}

// widenMouth makes the last three tiles of a path two wide: each gets its
// neighbour on one side (perpendicular to the flow, the same side for
// all) when that is grass or beach; the added tiles are appended as
// -1-index.
func (g *grid) widenMouth(path []int) []int {
	n := g.n
	k := len(path)
	if k < 4 {
		return path
	}
	out := path
	for side := range 2 {
		var add []int
		for m := k - 3; m < k; m++ {
			a, b := path[m-1], path[m]
			fx, fy := b%n-a%n, b/n-a/n
			px, py := -fy, fx
			if side == 1 {
				px, py = fy, -fx
			}
			x, y := b%n+px, b/n+py
			if !g.in(x, y) {
				continue
			}
			j := y*n + x
			if (g.t[j] == tGrass || g.t[j] == tCoast) && !g.inPlain(x, y, 0) {
				add = append(add, -1-j)
			}
		}
		if len(add) >= 2 {
			return append(out, add...)
		}
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
