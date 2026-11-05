package archipelago

import "slices"

// Rim massifs (D-072 §4, supersedes D-058's ridge spine): a habitable
// island carries 2-4 compact massifs around its rim (medium 1-2, small
// 0-1; content: shape.massifs), on different sides, the first one
// dominant. Each massif stands on a short spine parallel to the coast,
// set back from it, so that its outer flank meets the sea as cliffs and
// its foot runs out gently inland; no massif reaches deeper than the rim
// band, so the interior stays one connected plain and the coast between
// the massifs stays beach.

const (
	// massifShareMinPct and massifShareMaxPct bound the drawn mountain
	// share of the land (all massifs together); massifCheckMinPct and
	// massifCheckMaxPct the measured mountain and cliff share (pockets
	// and spurs included) of an island with massifs.
	massifShareMinPct = 11
	massifShareMaxPct = 16
	massifCheckMinPct = 10
	massifCheckMaxPct = 19
	// massifDominantMinPct and massifDominantMaxPct bound the first
	// massif's part of the mountain share when there are several.
	massifDominantMinPct = 40
	massifDominantMaxPct = 55
	// massifRimPct is the depth of the rim band (percent of the size)
	// that holds the massifs.
	massifRimPct = 14
	// massifPeak is the minimum height of a massif (8-connected mountain
	// and cliff tiles that reach it); pockets and spurs stay below it.
	massifPeak = 2
	// armsLarge and armsSmall bound the skeleton's arms (1..n; D-058
	// part 1) of islands of at least largeSize and of smaller ones.
	armsLarge = 3
	armsSmall = 2
)

// massifHeight returns the highest rock height of a size class's
// massifs (D-072 §4: large 6, medium 5, small 3).
func massifHeight(size int) int {
	switch {
	case size >= 200:
		return 6
	case size >= largeSize:
		return 5
	}
	return 3
}

// massifs raises count massifs around the rim (D-072 §4) and reports
// whether they came out as count separate massifs. sea is the chamfer
// distance (thirds of a tile) to the nearest water. Coast tiles in a
// massif become cliff; heights fall from the massif's peak on its spine
// to 1 at its foot. g.mass records the massif (1-based) per tile.
func (g *grid) massifs(r *rng, count, size, land int, sea []int) bool {
	n := g.n
	g.mass = make([]int, len(g.t))
	// The island's centre: the mean of its land tiles.
	cx, cy, c := 0, 0, 0
	for i, t := range g.t {
		if t != tWater {
			cx, cy, c = cx+i%n, cy+i/n, c+1
		}
	}
	if c == 0 {
		return false
	}
	cx, cy = cx*16/c+8, cy*16/c+8 // x16
	rim := 3 * max(6, size*massifRimPct/100)
	total := land * r.between(massifShareMinPct, massifShareMaxPct) / 100
	areas := make([]int, count)
	if count == 1 {
		areas[0] = total
	} else {
		areas[0] = total * r.between(massifDominantMinPct, massifDominantMaxPct) / 100
		rest := total - areas[0]
		for k := 1; k < count; k++ {
			areas[k] = rest / (count - 1)
		}
		areas[count-1] += rest % (count - 1)
	}
	top := massifHeight(size)
	heading := r.intn(32)
	low := newFBM(r, n, max(4, size/6), 35, 2)
	rag := newNoise(r, n, 2, 3)
	dm := make([]int, len(g.t))
	for k := range count {
		d := heading + k*32/count + r.between(-2, 2)
		dx, dy := dir32(d)
		// The outermost land tile on the ray from the centre.
		px, py := -1, -1
		for t := 0; t < n*16; t += 8 {
			x, y := (cx+dx*t/1024)>>4, (cy+dy*t/1024)>>4
			if !g.in(x, y) {
				break
			}
			if g.t[y*n+x] != tWater {
				px, py = x, y
			}
		}
		if px < 0 {
			return false
		}
		// The spine: parallel to the coast, set back by a quarter of the
		// massif's span, half as long as that span on each side, bent.
		span := max(4, isqrt(areas[k]))
		back := max(3, span/4)
		mx, my := px*16+8-dx*back*16/1024, py*16+8-dy*back*16/1024
		tx, ty := -dy, dx // tangent
		half := span * r.between(40, 70) / 100
		bend := r.between(-span/5, span/5)
		ax, ay := mx-tx*half*16/1024, my-ty*half*16/1024
		bx, by := mx+tx*half*16/1024, my+ty*half*16/1024
		ox, oy := mx-dx*bend*16/1024, my-dy*bend*16/1024
		for i := range dm {
			dm[i] = chamferInf
		}
		stamp(dm, n, ax, ay, ox, oy, 0, 0)
		stamp(dm, n, ox, oy, bx, by, 0, 0)
		chamfer(dm, n)
		peak := top
		if k > 0 {
			peak = r.between(max(massifPeak, top-2), top)
		}
		thr := func(i, w int) int {
			return max(3, w*(100+low.at(i%n, i/n))/100+rag.at(i%n, i/n))
		}
		in := func(i, w int) bool {
			t := g.t[i]
			return t != tWater && g.mass[i] == 0 && !g.harbour[i] && sea[i] <= rim && dm[i] <= thr(i, w)
		}
		cnt := func(w int) int {
			m := 0
			for i := range g.t {
				if in(i, w) {
					m++
				}
			}
			return m
		}
		lo, hi := 3, 3*size
		for lo < hi {
			mid := (lo + hi) / 2
			if cnt(mid) >= areas[k] {
				hi = mid
			} else {
				lo = mid + 1
			}
		}
		for i := range g.t {
			if !in(i, lo) {
				continue
			}
			w := thr(i, lo)
			if g.t[i] == tCoast {
				g.t[i] = tCliff
			} else {
				g.t[i] = tMountain
			}
			g.hgt[i] = min(peak, max(1, 1+(peak-1)*(w-dm[i])/w))
			g.mass[i] = k + 1
		}
	}
	// Short spurs of one or two tiles off the foot.
	var feet []int
	for i := range g.t {
		if g.edgeMountain(i) {
			feet = append(feet, i)
		}
	}
	for range land / 300 {
		if len(feet) == 0 {
			break
		}
		i := feet[r.intn(len(feet))]
		d := dirs4()[r.intn(4)]
		x, y := i%n, i/n
		for k := 1; k <= r.between(1, 2); k++ {
			j := (y+d[1]*k)*n + x + d[0]*k
			if t := g.at(x+d[0]*k, y+d[1]*k); (t != tGrass && t != tForest) || g.harbour[j] {
				break
			}
			g.t[j], g.hgt[j], g.mass[j] = tMountain, 1, g.mass[i]
		}
	}
	g.massifCount = count
	return g.countMassifs() == count
}

// countMassifs counts the massifs: 8-connected components of mountain and
// cliff tiles that reach height massifPeak.
func (g *grid) countMassifs() int {
	n := g.n
	seen := make([]bool, len(g.t))
	rock := func(i int) bool { return g.t[i] == tMountain || g.t[i] == tCliff }
	count := 0
	var stack []int
	for s := range g.t {
		if seen[s] || !rock(s) {
			continue
		}
		seen[s] = true
		stack = append(stack[:0], s)
		peak := 0
		for len(stack) > 0 {
			i := stack[len(stack)-1]
			stack = stack[:len(stack)-1]
			peak = max(peak, g.hgt[i])
			x, y := i%n, i/n
			for dy := -1; dy <= 1; dy++ {
				for dx := -1; dx <= 1; dx++ {
					if j := (y+dy)*n + x + dx; g.in(x+dx, y+dy) && !seen[j] && rock(j) {
						seen[j] = true
						stack = append(stack, j)
					}
				}
			}
		}
		if peak >= massifPeak {
			count++
		}
	}
	return count
}

// massifOrder returns the massifs (1-based) by size, largest first: the
// order in which deposit slots spread over them.
func (g *grid) massifOrder() []int {
	if g.massifCount == 0 {
		return nil
	}
	sizes := make([]int, g.massifCount+1)
	for _, m := range g.mass {
		sizes[m]++
	}
	order := make([]int, g.massifCount)
	for k := range order {
		order[k] = k + 1
	}
	slices.SortStableFunc(order, func(a, b int) int { return sizes[b] - sizes[a] })
	return order
}
