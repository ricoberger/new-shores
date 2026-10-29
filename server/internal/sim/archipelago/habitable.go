package archipelago

import (
	"fmt"
	"slices"

	"github.com/ricoberger/new-shores/server/internal/content"
)

// islandPad is the water border of a habitable island's working grid: the
// margin of the cropped island plus room for islets off the coast.
const islandPad = 10

// Shape tuning of habitable islands (D-058).
const (
	// ridgeMinPct and ridgeMaxPct bound the mountain (and cliff) share of
	// the land.
	ridgeMinPct = 8
	ridgeMaxPct = 12
	// isletGap is the minimum Chebyshev distance from an islet tile to the
	// main land: four water tiles between them, so that islets never
	// block the water rows of harbour sites (shipyard: 4).
	isletGap = 5
	// landTargetMinPct and landTargetMaxPct bound the land share of the
	// extent a skeleton shape is cut at (before smoothing).
	landTargetMinPct = 50
	landTargetMaxPct = 56
)

// habitable builds a habitable island (D-058 part 1): skeleton land mass,
// coast ring, ridge with mountains and cliffs, the reserved plain, rivers,
// forest patches, terrace levels, islets and the deposit slots.
func habitable(r *rng, sc *content.SizeClass, deposits []string, gap int, s *scratch) *grid {
	size, sh := sc.Size, sc.Shape
	n := size + 2*islandPad
	g := newGrid(n, s)
	g.pad = islandPad
	bones := skeleton(r, r.between(sh.Arms.Min, sh.Arms.Max))
	warp := max(1, size*12/100)
	fit(bones, size, islandPad, size*8/100)
	field := boneField(bones, n)
	g.carveBays(r, bones, field, size)
	wx := newNoise(r, n, max(4, size/4), warp)
	wy := newNoise(r, n, max(4, size/4), warp)
	detail := newFBM(r, n, max(4, size/4), max(3, size*3*14/100), 5)
	zone := 46 // octagon radius, percent of size
	// The land is the target share of the extent with the highest values
	// (warped skeleton field plus detail noise).
	vals := make([]int, len(g.t))
	var sorted []int
	for y := g.pad; y < n-g.pad; y++ {
		for x := g.pad; x < n-g.pad; x++ {
			sx := min(max(x+wx.smooth(x, y), 0), n-1)
			sy := min(max(y+wy.smooth(x, y), 0), n-1)
			// The coast curves away from the extent's border instead of
			// running along it: a penalty outside an octagon.
			ax, ay := abs(2*x-2*g.pad-size+1)/2, abs(2*y-2*g.pad-size+1)/2
			oct := max(ax, ay) + min(ax, ay)/2
			pen := 0
			if over := oct - size*zone/100; over > 0 {
				pen = over * over * 3 * 2 / max(1, size/16)
			}
			vals[y*n+x] = field[sy*n+sx] + detail.at(x, y) - pen
			sorted = append(sorted, vals[y*n+x])
		}
	}
	slices.Sort(sorted)
	cut := sorted[len(sorted)-1-size*size*r.between(landTargetMinPct, landTargetMaxPct)/100]
	for y := g.pad; y < n-g.pad; y++ {
		for x := g.pad; x < n-g.pad; x++ {
			if vals[y*n+x] > cut {
				g.t[y*n+x] = tGrass
			}
		}
	}
	g.smooth()
	g.keepLargest()
	g.fillLakes()
	land := g.landCount()
	area := size * size
	if land < area*landMinPct/100 || land > area*landMaxPct/100 {
		g.s.reject = fmt.Sprintf("area<%d", land*100/area)
		if land > area*landMaxPct/100 {
			g.s.reject = "area>"
		}
		return nil
	}
	dist := g.waterDistance(4)
	for i, t := range g.t {
		if t != tWater && dist[i] == 1 {
			g.t[i] = tCoast
		}
	}
	sea := g.seaField()
	g.lvl, g.hgt = make([]int, len(g.t)), make([]int, len(g.t))
	if !g.ridge(r, bones, size, land) {
		g.s.reject = "ridge"
		return nil
	}
	if !g.fillPockets(land * ridgeMaxPct / 100) {
		g.s.reject = "pockets"
		return nil
	}
	rivers := r.between(sh.Rivers.Min, sh.Rivers.Max)
	paths := g.rivers(r, rivers, size, dist, sea)
	if len(paths) < sh.Rivers.Min {
		g.s.reject = "rivers"
		return nil
	}
	if sh.Plain > 0 && !g.reservePlain(r, sh.Plain) {
		g.s.reject = "plain"
		return nil
	}
	if !g.bridgePockets(land * 2 / 100) {
		g.s.reject = "bridges"
		return nil
	}
	if !g.forests(r, land) {
		g.s.reject = "forests"
		return nil
	}
	g.levels(r, size, sh.Levels, sea, paths)
	if !g.islets(r, size, r.between(sh.Islets.Min, sh.Islets.Max), sh.Islets.Min) {
		g.s.reject = "islets"
		return nil
	}
	if !g.placeSlots(r, deposits, gap) {
		g.s.reject = "slots"
		return nil
	}
	return g
}

// carveBays cuts 1-3 round bays into the field (D-058 part 1: lobed coasts):
// discs centred on the extent's border between the skeleton's tips, the
// field capped at the distance to the disc's rim.
func (g *grid) carveBays(r *rng, bones []*bone, field []int, size int) {
	n := g.n
	mid := (2*g.pad + size) * 8 // x16
	var tips []int
	for _, b := range bones {
		x, y := b.last()
		tips = append(tips, angle32(x-mid, y-mid))
	}
	bays := r.between(1, 3)
	for range bays {
		var d int
		ok := false
		for range 8 {
			d = r.intn(32)
			ok = true
			for _, t := range tips {
				if diff := (d - t + 32) % 32; diff < 4 || diff > 28 {
					ok = false
				}
			}
			if ok {
				break
			}
		}
		if !ok {
			continue
		}
		tips = append(tips, d)
		dx, dy := dir32(d)
		reach := size * 8 * r.between(85, 105) / 100 // x16: from the centre
		cx, cy := (mid+dx*reach/1024)>>4, (mid+dy*reach/1024)>>4
		rad := size * r.between(14, 24) / 100
		v := make([]int, n*n)
		for i := range v {
			v[i] = chamferInf
		}
		if cx >= 0 && cy >= 0 && cx < n && cy < n {
			v[cy*n+cx] = -rad * 3
		}
		chamfer(v, n)
		for i := range field {
			field[i] = min(field[i], v[i])
		}
	}
}

// angle32 returns the direction of 32 (dir32) closest to (x, y).
func angle32(x, y int) int {
	best, bv := 0, -1<<62
	for d := range 32 {
		dx, dy := dir32(d)
		if v := dx*x + dy*y; v > bv {
			best, bv = d, v
		}
	}
	return best
}

// seaField returns the 3-4 chamfer distance (thirds of a tile) of every
// tile to the nearest water tile (0 on water).
func (g *grid) seaField() []int {
	v := make([]int, len(g.t))
	for i, t := range g.t {
		if t != tWater {
			v[i] = chamferInf
		}
	}
	chamfer(v, g.n)
	return v
}

// ridge draws the ridge spine — a trunk half from near the centre past its
// tip into the sea, branched with an arm of that half (or a spur) — and
// turns the land within a noisy band around it into mountain, coast tiles
// into cliff (D-058 part 2). The band's width gives the ridge a share of
// the land in [ridgeMinPct, ridgeMaxPct]; heights fall from 4 on the
// spine to 1 at the foot.
func (g *grid) ridge(r *rng, bones []*bone, size, land int) bool {
	n := g.n
	half := r.intn(2)
	trunk := bones[half]
	jitter := func(x, y, rad int) (int, int) {
		j := rad / 4
		return x + r.between(-j, j), y + r.between(-j, j)
	}
	type pt struct{ x, y int }
	var spine []pt
	for i := r.between(0, 1); i < len(trunk.x); i++ {
		x, y := trunk.x[i], trunk.y[i]
		if i > 0 && i < len(trunk.x)-1 {
			x, y = jitter(x, y, trunk.r[i])
		}
		spine = append(spine, pt{x, y})
	}
	// Past the tip into the sea: the ridge meets the coast as cliffs.
	k := len(trunk.x) - 1
	ex, ey := trunk.x[k]-trunk.x[k-1], trunk.y[k]-trunk.y[k-1]
	spine = append(spine, pt{trunk.x[k] + ex*2, trunk.y[k] + ey*2})
	branches := [][]pt{spine}
	arm := slices.IndexFunc(bones, func(b *bone) bool { return b.arm && b.half == half })
	if arm >= 0 {
		b := bones[arm]
		// The branch stops short of the arm's tip: a ridge from sea to
		// sea would cut the island in two.
		var br []pt
		for i := range len(b.x) - 1 {
			x, y := b.x[i], b.y[i]
			if i > 0 {
				x, y = jitter(x, y, b.r[i])
			}
			br = append(br, pt{x, y})
		}
		branches = append(branches, br)
	} else {
		// A spur off the middle of the spine.
		m := len(spine) / 2
		d := r.intn(32)
		dx, dy := dir32(d)
		l := size * 16 * r.between(12, 20) / 100
		branches = append(branches, []pt{spine[m], {spine[m].x + dx*l/1024, spine[m].y + dy*l/1024}})
	}
	dr := make([]int, n*n)
	for i := range dr {
		dr[i] = chamferInf
	}
	for _, b := range branches {
		for i := 1; i < len(b); i++ {
			stamp(dr, n, b[i-1].x, b[i-1].y, b[i].x, b[i].y, 0, 0)
		}
	}
	chamfer(dr, n)
	// The band width that gives the target share, then a noisy edge.
	// A noisy band (the width varies by +-60 %) whose width gives the
	// target share: binary search on the base width (the count grows
	// with it).
	target := land * r.between(ridgeMinPct, ridgeMaxPct) / 100
	edge := newFBM(r, n, max(4, size/8), 60, 2)
	wid := make([]int, len(g.t))
	for i := range wid {
		wid[i] = 100 + edge.at(i%n, i/n)
	}
	band := func(width int) int {
		count := 0
		for i, t := range g.t {
			if t != tWater && dr[i] <= max(3, width*wid[i]/100) {
				count++
			}
		}
		return count
	}
	lo, hi := 3, 3*size
	for lo < hi {
		mid := (lo + hi) / 2
		if band(mid) >= target {
			hi = mid
		} else {
			lo = mid + 1
		}
	}
	count := 0
	for i, t := range g.t {
		w := max(3, lo*wid[i]/100)
		if t == tWater || dr[i] > w {
			continue
		}
		if t == tCoast {
			g.t[i] = tCliff
		} else {
			g.t[i] = tMountain
		}
		g.hgt[i] = min(4, 1+3*(w-dr[i])/w)
		count++
	}
	return count > 0
}

// reservePlain picks a random side x side square of grass (the plain, D-058
// part 1); rivers keep out of it and its levels are flattened.
func (g *grid) reservePlain(r *rng, side int) bool {
	n := g.n
	sat := make([]int, (n+1)*(n+1))
	for y := range n {
		for x := range n {
			v := 0
			if g.t[y*n+x] == tGrass {
				v = 1
			}
			sat[(y+1)*(n+1)+x+1] = v + sat[y*(n+1)+x+1] + sat[(y+1)*(n+1)+x] - sat[y*(n+1)+x]
		}
	}
	full := func(i int) bool {
		x, y := i%n, i/n
		if x+side > n || y+side > n {
			return false
		}
		return sat[(y+side)*(n+1)+x+side]-sat[y*(n+1)+x+side]-sat[(y+side)*(n+1)+x]+sat[y*(n+1)+x] == side*side
	}
	i, ok := g.pick(r, full)
	if !ok {
		return false
	}
	g.plain = [3]int{i % n, i / n, side}
	return true
}

// inPlain reports whether tile (x, y) lies in the reserved plain grown by
// grow tiles.
func (g *grid) inPlain(x, y, grow int) bool {
	p := g.plain
	return p[2] > 0 && x >= p[0]-grow && y >= p[1]-grow && x < p[0]+p[2]+grow && y < p[1]+p[2]+grow
}

// bridgeComponents labels the 4-connected components of buildable tiles
// where a straight crossing of one or two river tiles also connects (a
// bridge, D-058 part 3). ok tells buildable tiles, river the river tiles.
func bridgeComponents(w, h int, ok, river func(i int) bool, comp []int, stack []int) ([]int, int) {
	id := 0
	for s := range comp {
		if comp[s] != 0 || !ok(s) {
			continue
		}
		id++
		comp[s] = id
		stack = append(stack[:0], s)
		for len(stack) > 0 {
			i := stack[len(stack)-1]
			stack = stack[:len(stack)-1]
			x, y := i%w, i/w
			for _, d := range dirs4() {
				for step := 1; step <= 3; step++ {
					nx, ny := x+d[0]*step, y+d[1]*step
					if nx < 0 || ny < 0 || nx >= w || ny >= h {
						break
					}
					j := ny*w + nx
					if ok(j) {
						if comp[j] == 0 {
							comp[j] = id
							stack = append(stack, j)
						}
						break
					}
					if !river(j) {
						break
					}
				}
			}
		}
	}
	return stack[:0], id
}

// bridgePockets is fillPockets with bridges: buildable tiles not
// connected to the largest bridge component become mountain, unless more
// than limit tiles are cut off.
func (g *grid) bridgePockets(limit int) bool {
	g.s.comp = ints(g.s.comp, len(g.t))
	comp := g.s.comp
	var n int
	g.s.stack, n = bridgeComponents(g.n, g.n, func(i int) bool { return buildable(g.t[i]) }, func(i int) bool { return g.t[i] == tRiver }, comp, g.s.stack)
	sizes := make([]int, n+1)
	for _, c := range comp {
		sizes[c]++
	}
	best, total := 0, 0
	for id := 1; id <= n; id++ {
		total += sizes[id]
		if best == 0 || sizes[id] > sizes[best] {
			best = id
		}
	}
	if total-sizes[best] > limit {
		return false
	}
	for i, c := range comp {
		if c != 0 && c != best {
			g.t[i] = tMountain
			g.hgt[i] = 1
		}
	}
	return true
}

// forests grows 1-3 forest patches over grass, the forest share of the
// land in [forestMinPct, forestMaxPct].
func (g *grid) forests(r *rng, land int) bool {
	patches := r.between(1, 3)
	forest := land * r.between(forestMinPct, forestMaxPct) / 100
	for p := range patches {
		size := forest / patches
		if p == 0 {
			size += forest % patches
		}
		seed, ok := g.pick(r, func(i int) bool { return g.t[i] == tGrass })
		if !ok {
			return false
		}
		tiles := grow(r, g, seed, size, func(j int) bool { return g.t[j] == tGrass })
		for _, i := range tiles {
			g.t[i] = tForest
		}
	}
	return g.has(tGrass) && g.has(tForest)
}

// levels sets the terrace level of every land tile (D-058 part 4): bands
// of the distance to the sea with a noisy edge, capped at top; beaches
// stay at 0; one-tile specks join their neighbours; the plain is flat (its
// most common level); rivers step down monotonically towards the mouth
// and lie no higher than their banks.
func (g *grid) levels(r *rng, size, top int, sea []int, paths [][]int) {
	n := g.n
	b1 := max(3, size/24) * 3
	b2 := b1 + max(4, size/10)*3
	edge := newNoise(r, n, max(4, size/10), b1/2+1)
	for i, t := range g.t {
		g.lvl[i] = 0
		if t == tWater || t == tCoast || t == tIslet {
			continue
		}
		d := sea[i] + edge.smooth(i%n, i/n)
		switch {
		case d >= b2:
			g.lvl[i] = 2
		case d >= b1:
			g.lvl[i] = 1
		}
		g.lvl[i] = min(g.lvl[i], top)
	}
	land := func(t byte) bool { return t != tWater && t != tRiver && t != tIslet }
	for range 2 {
		for i, t := range g.t {
			if !land(t) || t == tCoast {
				continue
			}
			x, y := i%n, i/n
			var count [content.MaxLevel + 1]int
			for _, d := range dirs4() {
				if g.in(x+d[0], y+d[1]) && land(g.at(x+d[0], y+d[1])) {
					count[g.lvl[(y+d[1])*n+x+d[0]]]++
				}
			}
			for l, c := range count {
				if c >= 3 && l != g.lvl[i] {
					g.lvl[i] = l
				}
			}
		}
	}
	if p := g.plain; p[2] > 0 {
		// The plain is flat: its most common level over a noisy disc
		// around the square (never smaller than the square's corners).
		var count [content.MaxLevel + 1]int
		for y := p[1]; y < p[1]+p[2]; y++ {
			for x := p[0]; x < p[0]+p[2]; x++ {
				count[g.lvl[y*n+x]]++
			}
		}
		mode := 0
		for l, c := range count {
			if c > count[mode] {
				mode = l
			}
		}
		cx, cy := 2*p[0]+p[2]-1, 2*p[1]+p[2]-1 // x2
		rim := newNoise(r, n, max(4, p[2]/3), p[2]/5+1)
		for y := p[1] - p[2]; y < p[1]+2*p[2]; y++ {
			for x := p[0] - p[2]; x < p[0]+2*p[2]; x++ {
				if !g.in(x, y) || !land(g.at(x, y)) || g.at(x, y) == tCoast {
					continue
				}
				rad := 2 * (p[2]*80/100 + rim.smooth(x, y))
				rad = max(rad, p[2]*145/100)
				dx, dy := 2*x-cx, 2*y-cy
				if dx*dx+dy*dy <= rad*rad || g.inPlain(x, y, 0) {
					g.lvl[y*n+x] = mode
				}
			}
		}
	}
	for _, path := range paths {
		// path runs from the source to the mouth; widened mouth tiles
		// follow the main path (marked negative: -1 - index).
		prev := top
		for _, i := range path {
			if i < 0 {
				continue
			}
			x, y := i%n, i/n
			l := prev
			for _, d := range dirs4() {
				if g.in(x+d[0], y+d[1]) && land(g.at(x+d[0], y+d[1])) {
					l = min(l, g.lvl[(y+d[1])*n+x+d[0]])
				}
			}
			g.lvl[i], prev = l, l
		}
		for _, i := range path {
			if i < 0 {
				w := -1 - i
				g.lvl[w] = 0
			}
		}
	}
}

// islets places count islets (decor rocks and sand bars, D-058 part 1):
// blobs of 1-8 water tiles turned islet, at least isletGap tiles off the
// land and two tiles apart, near the coast; at least least of them.
func (g *grid) islets(r *rng, size, count, least int) bool {
	if count == 0 {
		return true
	}
	n := g.n
	// Chebyshev distance to land (non-water), capped.
	far := isletGap + max(2, size/24)
	ld := make([]int, len(g.t))
	queue := g.s.stack[:0]
	for i, t := range g.t {
		if t != tWater {
			queue = append(queue, i)
		} else {
			ld[i] = -1
		}
	}
	for head := 0; head < len(queue); head++ {
		i := queue[head]
		if ld[i] >= far {
			continue
		}
		x, y := i%n, i/n
		for dy := -1; dy <= 1; dy++ {
			for dx := -1; dx <= 1; dx++ {
				if g.in(x+dx, y+dy) && ld[(y+dy)*n+x+dx] == -1 {
					ld[(y+dy)*n+x+dx] = ld[i] + 1
					queue = append(queue, (y+dy)*n+x+dx)
				}
			}
		}
	}
	g.s.stack = queue[:0]
	blocked := make([]bool, len(g.t))
	free := func(i int) bool {
		x, y := i%n, i/n
		return ld[i] >= isletGap && ld[i] <= far && !blocked[i] && x > 0 && y > 0 && x < n-1 && y < n-1
	}
	placed := 0
	for range count {
		seed, ok := g.pick(r, free)
		if !ok {
			break
		}
		tiles := grow(r, g, seed, r.between(2, 8), free)
		rock := r.intn(3) > 0
		for _, i := range tiles {
			g.t[i] = tIslet
			if rock {
				g.hgt[i] = r.between(1, 2)
			}
		}
		for _, i := range tiles {
			x, y := i%n, i/n
			for dy := -2; dy <= 2; dy++ {
				for dx := -2; dx <= 2; dx++ {
					if g.in(x+dx, y+dy) {
						blocked[(y+dy)*n+x+dx] = true
					}
				}
			}
		}
		placed++
	}
	return placed >= least
}
