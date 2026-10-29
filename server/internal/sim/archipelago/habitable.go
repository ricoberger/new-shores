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
	// the land of islands of at least ridgeLargeSize; smaller ones use the
	// ridgeSmall bounds. ridgeFlankPct is the chance of a flank spine.
	ridgeMinPct      = 15
	ridgeMaxPct      = 20
	ridgeSmallMinPct = 9
	ridgeSmallMaxPct = 11
	ridgeLargeSize   = 96
	ridgeFlankPct    = 55
	// pocketMaxPct bounds the buildable pockets cut off by the massif that
	// turn to mountain, percent of the land.
	pocketMaxPct = 10
	// harbourSide and harbourWater are the land side and the water rows
	// of a reserved harbour stretch (the shipyard's 8 x 12 with 4 water
	// rows, content: shipyard).
	harbourSide  = 8
	harbourWater = 4
	// shareSlack is the tolerance (percentage points) of the mountain
	// share around the ridge share.
	shareSlack = 3
	// isletGap is the minimum Chebyshev distance from an islet tile to the
	// main land: four water tiles between them, so that islets never
	// block the water rows of harbour sites (shipyard: 4).
	isletGap = 5
	// cliffMinPct and cliffMaxPct bound the cliff share of the coast;
	// level2MinPct and level2MaxPct the level-2 share of the land.
	cliffMinPct  = 10
	cliffMaxPct  = 25
	level2MinPct = 0
	level2MaxPct = 20
	// outlineMinPct and outlineMaxPct bound the land share of the extent
	// the skeleton's outline is cut at; landTargetMinPct and
	// landTargetMaxPct the share it grows to along the bones (before
	// smoothing); armReachPct is the most (percent of the size) the
	// bones run on past their tips to grow it, at armTipPct of the tip's
	// radius.
	outlineMinPct    = 50
	outlineMaxPct    = 56
	landTargetMinPct = 57
	landTargetMaxPct = 63
	armReachPct      = 20
	armTipPct        = 60
	// habLandMinPct and habLandMaxPct bound the land share after
	// smoothing and the coast detail.
	habLandMinPct = 48
	habLandMaxPct = 68
)

// habitable builds a habitable island (D-058 part 1, round 2): skeleton
// land mass, harbour stretches and coast detail, coast ring, massif with
// mountains and cliffs, terrace levels with cliff coast, rivers with
// estuaries, the plain on one level, forest patches, the share checks,
// islets and the deposit slots.
func habitable(r *rng, sc *content.SizeClass, deposits []string, gap int, s *scratch) *grid {
	size, sh := sc.Size, sc.Shape
	// The skeleton fills the extent of size tiles; the bones may run on
	// past it by up to reach tiles on every side.
	reach := size * armReachPct / 100
	n := size + 2*islandPad + 2*reach
	g := newGrid(n, s)
	g.pad = islandPad
	bones := skeleton(r, r.between(sh.Arms.Min, sh.Arms.Max))
	warp := max(1, size*12/100)
	fit(bones, size, islandPad+reach, size*8/100)
	bays := g.carveBays(r, bones, size)
	wx := newNoise(r, n, max(4, size/4), warp)
	wy := newNoise(r, n, max(4, size/4), warp)
	detail := newFBM(r, n, max(4, size/4), max(3, size*3*14/100), 5)
	// The outline is the outlineMinPct..outlineMaxPct share of the extent
	// with the highest values (warped skeleton field plus detail noise);
	// the land grows from there to the landTarget share along the
	// bones: arms and trunk halves run on past their tips, the cut value
	// stays, so the body does not swell into a disc.
	vals := make([]int, len(g.t))
	sorted := make([]int, 0, size*size)
	lb := g.newLandBase(wx, wy, detail)
	g.landValues(vals, bones, 0, bays, lb, size)
	for y := g.pad; y < n-g.pad; y++ {
		sorted = append(sorted, vals[y*n+g.pad:y*n+n-g.pad]...)
	}
	slices.Sort(sorted)
	cut := sorted[len(sorted)-1-size*size*r.between(outlineMinPct, outlineMaxPct)/100]
	want := size * size * r.between(landTargetMinPct, landTargetMaxPct) / 100
	count := func() int {
		c := 0
		for y := g.pad; y < n-g.pad; y++ {
			for _, v := range vals[y*n+g.pad : y*n+n-g.pad] {
				if v > cut {
					c++
				}
			}
		}
		return c
	}
	// Binary search of the run past the tips (tile units x16).
	lo, hi := 0, reach*16
	for lo < hi {
		mid := (lo + hi) / 2
		g.landValues(vals, bones, mid, bays, lb, size)
		if count() >= want {
			hi = mid
		} else {
			lo = mid + 1
		}
	}
	g.landValues(vals, bones, lo, bays, lb, size)
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
	g.coastDetail(r, size)
	land := g.landCount()
	area := size * size
	if land < area*habLandMinPct/100 || land > area*habLandMaxPct/100 {
		g.s.reject = fmt.Sprintf("area<%d", land*100/area)
		if land > area*habLandMaxPct/100 {
			g.s.reject = "area>"
		}
		return nil
	}
	if size >= ridgeLargeSize && !g.outlineOK() {
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
	if !g.fillPockets(land * pocketMaxPct / 100) {
		g.s.reject = "pockets"
		return nil
	}
	g.plateaus(r, size, sh.Levels, sea)
	rivers := g.rivers(r, r.between(sh.Rivers.Min, sh.Rivers.Max), size, dist, sea)
	if len(rivers) < sh.Rivers.Min {
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
	g.riverLevels(rivers, sh.Levels)
	if why := g.shares(size); why != "" {
		g.s.reject = why
		return nil
	}
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

// carveBays returns the cap of 1-3 round bays (D-058 part 1: lobed
// coasts): discs centred on the extent's border between the skeleton's
// tips; the field is capped at the distance to the nearest disc's rim.
func (g *grid) carveBays(r *rng, bones []*bone, size int) []int {
	n := g.n
	field := make([]int, n*n)
	for i := range field {
		field[i] = chamferInf
	}
	mid := g.n * 8 // x16
	var tips []int
	for _, b := range bones {
		x, y := b.last()
		tips = append(tips, angle32(x-mid, y-mid))
	}
	bays := r.between(1, 3)
	v := make([]int, n*n)
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
	return field
}

// landBase holds the per-tile parts of the land value that do not depend
// on the bones' run: the domain-warped source tile, the detail noise and
// the octagon distance from the working grid's centre.
type landBase struct {
	src, detail, oct []int
	// field is the work buffer of the skeleton field.
	field []int
}

// newLandBase computes the landBase of the working grid's inner tiles
// (domain warp (wx, wy), detail noise).
func (g *grid) newLandBase(wx, wy *noise, detail fbm) *landBase {
	n := g.n
	lb := &landBase{src: make([]int, n*n), detail: make([]int, n*n), oct: make([]int, n*n), field: make([]int, n*n)}
	for y := g.pad; y < n-g.pad; y++ {
		for x := g.pad; x < n-g.pad; x++ {
			i := y*n + x
			sx := min(max(x+wx.smooth(x, y), 0), n-1)
			sy := min(max(y+wy.smooth(x, y), 0), n-1)
			lb.src[i] = sy*n + sx
			lb.detail[i] = detail.at(x, y)
			ax, ay := abs(2*x-n+1)/2, abs(2*y-n+1)/2
			lb.oct[i] = max(ax, ay) + min(ax, ay)/2
		}
	}
	return lb
}

// landValues fills vals with the land value of the working grid's
// tiles: the skeleton field of bones that run on past their tips by run
// (tile units x16, tapering), capped by the bays, domain warped, plus
// detail noise, minus the penalty outside an octagon (the coast curves
// away from the extent's border; the octagon grows with the run).
func (g *grid) landValues(vals []int, bones []*bone, run int, bays []int, lb *landBase, size int) {
	n := g.n
	grown := make([]*bone, len(bones))
	for k, b := range bones {
		c := *b
		c.x, c.y, c.r = slices.Clone(b.x), slices.Clone(b.y), slices.Clone(b.r)
		if m := len(c.x); run > 0 && m >= 2 {
			dx, dy := c.x[m-1]-c.x[m-2], c.y[m-1]-c.y[m-2]
			l := max(1, isqrt(dx*dx+dy*dy))
			c.add(c.x[m-1]+dx*run/l, c.y[m-1]+dy*run/l, c.r[m-1]*armTipPct/100)
		}
		grown[k] = &c
	}
	field := boneFieldInto(lb.field, grown, n)
	zone := size*46/100 + run/16 // octagon radius: 46 % of size
	pw := max(1, size/16)
	for y := g.pad; y < n-g.pad; y++ {
		for x := g.pad; x < n-g.pad; x++ {
			i := y*n + x
			pen := 0
			if over := lb.oct[i] - zone; over > 0 {
				pen = over * over * 3 * 2 / pw
			}
			src := lb.src[i]
			vals[i] = min(field[src], bays[src]) + lb.detail[i] - pen
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

// isqrt returns the integer square root of v >= 0.
func isqrt(v int) int {
	if v <= 0 {
		return 0
	}
	x := v
	y := (x + 1) / 2
	for y < x {
		x = y
		y = (x + v/x) / 2
	}
	return x
}

// ridgeShare returns the mountain share of the land (percent bounds) of a
// size class: large and medium islands carry massifs of 15-20 %, small
// ones about 10 % (D-058 round 2).
func ridgeShare(size int) (int, int) {
	if size >= ridgeLargeSize {
		return ridgeMinPct, ridgeMaxPct
	}
	return ridgeSmallMinPct, ridgeSmallMaxPct
}

// ridge draws the ridge spine and turns the land around it into a massif
// (D-058 part 2, round 2). The spine is either a flank spine — the whole
// trunk shifted to one side, so that one flank of the island is rock and
// the plain lies on the other — or a centre spine from near the centre
// along a trunk half past its tip into the sea, branched with an arm of
// that half. Spurs branch off both. The massif's half-width varies along
// the spine with low-frequency noise (1-5 tiles, more on large islands),
// grows at branch points, and its edge is ragged (fine noise on the
// threshold, short spurs of one or two tiles); a binary search on the
// width scale gives the target share of the land. Coast tiles in the
// massif become cliff; heights fall from 4 on the spine to 1 at the foot.
func (g *grid) ridge(r *rng, bones []*bone, size, land int) bool {
	n := g.n
	type pt struct{ x, y int } // tile units x16
	var branches [][]pt
	var joints []pt
	jitter := func(x, y, rad int) (int, int) {
		j := rad / 4
		return x + r.between(-j, j), y + r.between(-j, j)
	}
	spur := func(from pt, d, length int) []pt {
		dx, dy := dir32(d)
		l := size * 16 * length / 100
		mid := pt{from.x + dx*l/2048 + r.between(-24, 24), from.y + dy*l/2048 + r.between(-24, 24)}
		return []pt{from, mid, {from.x + dx*l/1024, from.y + dy*l/1024}}
	}
	spurs := r.between(1, 2)
	if size < ridgeLargeSize {
		spurs = r.intn(2)
	}
	if r.intn(100) < ridgeFlankPct {
		// The flank spine: tip of half 1 to tip of half 0, shifted
		// sideways by 45-75 % of the trunk's radius.
		h0, h1 := bones[0], bones[1]
		ax, ay := h0.x[len(h0.x)-1]-h1.x[len(h1.x)-1], h0.y[len(h0.y)-1]-h1.y[len(h1.y)-1]
		l := max(1, isqrt(ax*ax+ay*ay))
		side := 1 - 2*r.intn(2)
		nx, ny := -ay*side, ax*side
		off := r.between(45, 75)
		var spine []pt
		add := func(b *bone, i int) {
			x, y := b.x[i]+nx*b.r[i]*off/100/l, b.y[i]+ny*b.r[i]*off/100/l
			if i > 0 && i < len(b.x)-1 {
				x, y = jitter(x, y, b.r[i])
			}
			spine = append(spine, pt{x, y})
		}
		for i := len(h1.x) - 1; i >= 1; i-- {
			add(h1, i)
		}
		for i := range h0.x {
			add(h0, i)
		}
		// Each end runs on past the tip by up to a radius (often into
		// the sea: cliffs).
		k := len(spine) - 1
		for _, e := range [2][2]int{{0, 1}, {k, k - 1}} {
			a, b := spine[e[0]], spine[e[1]]
			f := r.between(0, 100)
			ex, ey := (a.x-b.x)*f/100, (a.y-b.y)*f/100
			if e[0] == 0 {
				spine = append([]pt{{a.x + ex, a.y + ey}}, spine...)
			} else {
				spine = append(spine, pt{a.x + ex, a.y + ey})
			}
		}
		branches = append(branches, spine)
		// Spurs run outwards (away from the plain side).
		base := angle32(nx, ny)
		for range spurs {
			m := r.between(1, len(spine)-2)
			branches = append(branches, spur(spine[m], base+r.between(-5, 5), r.between(10, 18)))
			joints = append(joints, spine[m])
		}
	} else {
		half := r.intn(2)
		trunk := bones[half]
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
		branches = append(branches, spine)
		joints = append(joints, spine[0])
		arm := slices.IndexFunc(bones, func(b *bone) bool { return b.arm && b.half == half })
		if arm >= 0 {
			b := bones[arm]
			// The branch stops short of the arm's tip: a ridge from sea
			// to sea would cut the island in two.
			var br []pt
			for i := range len(b.x) - 1 {
				x, y := b.x[i], b.y[i]
				if i > 0 {
					x, y = jitter(x, y, b.r[i])
				}
				br = append(br, pt{x, y})
			}
			branches = append(branches, br)
			joints = append(joints, br[0])
		}
		for range spurs {
			m := r.between(1, len(spine)-2)
			branches = append(branches, spur(spine[m], r.intn(32), r.between(10, 20)))
			joints = append(joints, spine[m])
		}
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
	// Branch points are broad: the field starts below zero there.
	for _, j := range joints {
		if x, y := j.x>>4, j.y>>4; g.in(x, y) {
			dr[y*n+x] = min(dr[y*n+x], -3*r.between(1, max(1, size/40)))
		}
	}
	chamfer(dr, n)
	lo, hi := ridgeShare(size)
	target := land * r.between(lo, hi) / 100
	maxW := 3 * max(5, size/16) // half-width, thirds of a tile
	low := newFBM(r, n, max(4, size/5), 75, 2)
	rag := newNoise(r, n, 2, 4)
	wid := make([]int, len(g.t))
	for i := range wid {
		wid[i] = min(max(100+low.at(i%n, i/n), 20), 180)
	}
	thr := func(i, scale int) int {
		return min(max(scale*wid[i]/100, 3), maxW) + rag.at(i%n, i/n)
	}
	band := func(scale int) int {
		count := 0
		for i, t := range g.t {
			if t != tWater && dr[i] <= thr(i, scale) && !g.harbour[i] {
				count++
			}
		}
		return count
	}
	a, b := 3, 3*size
	for a < b {
		mid := (a + b) / 2
		if band(mid) >= target {
			b = mid
		} else {
			a = mid + 1
		}
	}
	count := 0
	for i, t := range g.t {
		w := max(3, thr(i, a))
		if t == tWater || dr[i] > w || g.harbour[i] {
			continue
		}
		if t == tCoast {
			g.t[i] = tCliff
		} else {
			g.t[i] = tMountain
		}
		g.hgt[i] = min(4, max(1, 1+3*(w-dr[i])/w))
		count++
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
			if t := g.at(x+d[0]*k, y+d[1]*k); (t != tGrass && t != tForest) || g.harbour[(y+d[1]*k)*n+x+d[0]*k] {
				break
			}
			g.t[(y+d[1]*k)*n+x+d[0]*k] = tMountain
			g.hgt[(y+d[1]*k)*n+x+d[0]*k] = 1
		}
	}
	return count > 0
}

// reservePlain picks a random side x side square of grass on one level
// (the plain, D-058 part 1); without one, the grass square with the
// largest share (at least 70 %) of one level is levelled.
func (g *grid) reservePlain(r *rng, side int) bool {
	n := g.n
	var sats [content.MaxLevel + 1][]int
	for l := range sats {
		sat := make([]int, (n+1)*(n+1))
		for y := range n {
			for x := range n {
				v := 0
				if g.t[y*n+x] == tGrass && g.lvl[y*n+x] == l {
					v = 1
				}
				sat[(y+1)*(n+1)+x+1] = v + sat[y*(n+1)+x+1] + sat[(y+1)*(n+1)+x] - sat[y*(n+1)+x]
			}
		}
		sats[l] = sat
	}
	full := func(i int) bool {
		x, y := i%n, i/n
		if x+side > n || y+side > n {
			return false
		}
		sat := sats[g.lvl[i]]
		return sat[(y+side)*(n+1)+x+side]-sat[y*(n+1)+x+side]-sat[(y+side)*(n+1)+x]+sat[y*(n+1)+x] == side*side
	}
	i, ok := g.pick(r, full)
	if !ok {
		// No square lies on one level: take the grass square with the
		// largest share of one level (at least 70 %) and level it.
		count := func(i, l int) int {
			x, y := i%n, i/n
			if x+side > n || y+side > n {
				return 0
			}
			sat := sats[l]
			return sat[(y+side)*(n+1)+x+side] - sat[y*(n+1)+x+side] - sat[(y+side)*(n+1)+x] + sat[y*(n+1)+x]
		}
		best, bl, bc := -1, 0, side*side*70/100-1
		for j := range g.t {
			c, cl, total := 0, 0, 0
			for l := range sats {
				v := count(j, l)
				total += v
				if v > c {
					c, cl = v, l
				}
			}
			if total == side*side && c > bc {
				best, bl, bc = j, cl, c
			}
		}
		if best < 0 {
			return false
		}
		i = best
		for y := i / n; y < i/n+side; y++ {
			for x := i % n; x < i%n+side; x++ {
				g.lvl[y*n+x] = bl
			}
		}
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

// plateaus sets the terrace level of every land tile (D-058 part 4,
// round 2): broad irregular plateaus from value noise with large cells
// (about a third of the island) plus a gentle rise with the distance to
// the sea, cut at two thresholds. The first threshold is chosen so that
// cliff coast (coast tiles at level 1 or 2, with the ridge's cliffs)
// makes up cliffPct of the coast: levels and coast are one shape. The
// second gives level 2 a random share of the land (some islands stay
// mostly flat, some get a high flank). Level regions smaller than an
// island-dependent minimum join their neighbours (few edges). Coast at
// level 1 or 2 becomes cliff (no beach).
func (g *grid) plateaus(r *rng, size, top int, sea []int) {
	n := g.n
	big := newNoise(r, n, max(6, size/3), 1000)
	mid := newNoise(r, n, max(4, size/8), 260)
	fine := newNoise(r, n, max(3, size/24), 70)
	ramp := max(3, size/8) * 3
	p := make([]int, len(g.t))
	land := func(t byte) bool { return t != tWater && t != tRiver && t != tIslet }
	var beach, all []int
	cliffs, coast := 0, 0
	for i, t := range g.t {
		g.lvl[i] = 0
		if !land(t) {
			continue
		}
		x, y := i%n, i/n
		p[i] = big.smooth(x, y) + mid.smooth(x, y) + fine.smooth(x, y) + 400*min(sea[i], ramp)/ramp
		all = append(all, p[i])
		switch t {
		case tCoast:
			beach = append(beach, p[i])
			coast++
		case tCliff:
			cliffs++
			coast++
		}
	}
	if top == 0 || len(all) == 0 {
		return
	}
	desc := func(v []int) { slices.Sort(v); slices.Reverse(v) }
	desc(beach)
	desc(all)
	share := r.between(cliffMinPct, cliffMaxPct)
	k2 := 0
	if top >= 2 {
		k2 = len(all) * r.between(level2MinPct, level2MaxPct) / 100
	}
	beachAt := func(i int) bool { return g.t[i] == tCoast && (g.harbour == nil || !g.harbour[i]) }
	// levelAt sets the levels for the first threshold at the want-th
	// highest beach value and returns the cliff share of the shore
	// (percent) it gives.
	levelAt := func(want int) int {
		t1 := all[0] + 1
		if want > 0 && len(beach) > 0 {
			t1 = beach[min(want, len(beach))-1]
		}
		t2 := t1 + 1<<20
		if k2 > 0 {
			t2 = max(t1+1, all[k2-1])
		}
		for i, t := range g.t {
			if !land(t) {
				continue
			}
			switch {
			case p[i] >= t2:
				g.lvl[i] = 2
			case p[i] >= t1:
				g.lvl[i] = 1
			default:
				g.lvl[i] = 0
			}
		}
		// Small level regions join the level most common around them.
		minArea := max(8, size*size/250)
		comp := make([]int, len(g.t))
		for range 3 {
			clear(comp)
			changed := false
			id := 0
			for s := range g.t {
				if !land(g.t[s]) || comp[s] != 0 {
					continue
				}
				id++
				l := g.lvl[s]
				tiles := []int{s}
				comp[s] = id
				var around [content.MaxLevel + 1]int
				for k := 0; k < len(tiles); k++ {
					x, y := tiles[k]%n, tiles[k]/n
					for _, d := range dirs4() {
						if !g.in(x+d[0], y+d[1]) {
							continue
						}
						j := (y+d[1])*n + x + d[0]
						if !land(g.t[j]) {
							continue
						}
						if g.lvl[j] != l {
							around[g.lvl[j]]++
						} else if comp[j] == 0 {
							comp[j] = id
							tiles = append(tiles, j)
						}
					}
				}
				if len(tiles) >= minArea {
					continue
				}
				best, most := -1, 0
				for lv, c := range around {
					if c > most {
						best, most = lv, c
					}
				}
				if best >= 0 {
					for _, i := range tiles {
						g.lvl[i] = best
					}
					changed = true
				}
			}
			if !changed {
				break
			}
		}
		cl, shore := 0, 0
		for i, t := range g.t {
			if (t == tCoast || t == tCliff) && g.touches4(i, tWater) {
				shore++
				if t == tCliff || (beachAt(i) && g.lvl[i] > 0) {
					cl++
				}
			}
		}
		return 100 * cl / max(1, shore)
	}
	// The first threshold follows the wanted cliff share: start from the
	// beach count, correct by the measured share (harbour stretches and
	// small regions change it) up to four times.
	want := coast*share/100 - cliffs
	for range 4 {
		got := levelAt(want)
		if got >= cliffMinPct && got <= cliffMaxPct && abs(got-share) <= 3 {
			break
		}
		want = max(0, want+(share-got)*coast/100)
	}
	for i, t := range g.t {
		switch {
		case t == tCoast && g.harbour != nil && g.harbour[i]:
			g.lvl[i] = 0
		case t == tCoast && g.lvl[i] > 0:
			g.t[i] = tCliff
		}
	}
}

// shares checks the round-2 shares (D-058): the cliff share of the shore
// within cliffMinPct..cliffMaxPct and the mountain (and cliff) share of
// the land within a few points of the class's ridge share. It returns the
// failed rule or "".
func (g *grid) shares(size int) string {
	cl, shore, rock, land := 0, 0, 0, 0
	for i, t := range g.t {
		switch t {
		case tWater, tIslet:
			continue
		case tMountain, tCliff:
			rock++
		}
		land++
		if (t == tCoast || t == tCliff) && g.touches4(i, tWater) {
			shore++
			if t == tCliff {
				cl++
			}
		}
	}
	if c := 100 * cl / max(1, shore); c < cliffMinPct || c > cliffMaxPct {
		return "cliff share"
	}
	lo, hi := ridgeShare(size)
	if m := 100 * rock / max(1, land); m < lo-shareSlack || m > hi+shareSlack {
		return "mountain share"
	}
	return ""
}

// harbourSites reserves harbour stretches before the coast gets its
// detail: up to max(3, size/24) spread rectangles of the shipyard's size
// (8 x 8 land behind 4 water rows, every orientation) on the plain land
// mass. Their tiles (grown by one) get no notch, no cliff, no ridge and
// no river, so that the Trading Post and shipyard sites the verification
// requires remain (a shipyard rectangle holds a Trading Post's too).
func (g *grid) harbourSites(r *rng, size int) []bool {
	n := g.n
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
	landIn := func(x, y, w, h int) int {
		if x < 0 || y < 0 || x+w > n || y+h > n {
			return -1
		}
		return sat[(y+h)*(n+1)+x+w] - sat[y*(n+1)+x+w] - sat[(y+h)*(n+1)+x] + sat[y*(n+1)+x]
	}
	const side, wet = harbourSide, harbourWater
	type rect struct{ x, y, w, h int }
	// site reports whether the rectangle of orientation d with its
	// corner at tile i has all land in its land part and all water in its
	// water part.
	site := func(i, d int) bool {
		x, y := i%n, i/n
		var l, w rect
		switch d {
		case 0: // water north
			w, l = rect{x, y, side, wet}, rect{x, y + wet, side, side}
		case 1: // water south
			l, w = rect{x, y, side, side}, rect{x, y + side, side, wet}
		case 2: // water west
			w, l = rect{x, y, wet, side}, rect{x + wet, y, side, side}
		default: // water east
			l, w = rect{x, y, side, side}, rect{x + side, y, wet, side}
		}
		return landIn(l.x, l.y, l.w, l.h) == side*side && landIn(w.x, w.y, w.w, w.h) == 0
	}
	type cand struct{ i, d int }
	var cands []cand
	for i := range g.t {
		for d := range 4 {
			if site(i, d) {
				cands = append(cands, cand{i, d})
			}
		}
	}
	r.shuffle(len(cands), func(a, b int) { cands[a], cands[b] = cands[b], cands[a] })
	out := make([]bool, len(g.t))
	var picked []int
	for _, c := range cands {
		if len(picked) == max(3, size/24) {
			break
		}
		if slices.ContainsFunc(picked, func(p int) bool { return cheb(p, c.i, n) < size/4 }) {
			continue
		}
		picked = append(picked, c.i)
		x, y := c.i%n, c.i/n
		w, h := side, side+wet
		if c.d >= 2 {
			w, h = side+wet, side
		}
		for yy := y - 1; yy <= y+h; yy++ {
			for xx := x - 1; xx <= x+w; xx++ {
				if g.in(xx, yy) {
					out[yy*n+xx] = true
				}
			}
		}
	}
	return out
}

// riverLevels steps every river down from the source to the mouth: a
// river tile lies no higher than the previous one and its lowest land
// neighbour; estuary tiles take the level of their main tile.
func (g *grid) riverLevels(rivers []river, top int) {
	n := g.n
	land := func(t byte) bool { return t != tWater && t != tRiver && t != tIslet }
	for _, rv := range rivers {
		at := make([]int, len(rv.main))
		prev := top
		for m, i := range rv.main {
			x, y := i%n, i/n
			l := prev
			for _, d := range dirs4() {
				if g.in(x+d[0], y+d[1]) && land(g.at(x+d[0], y+d[1])) {
					l = min(l, g.lvl[(y+d[1])*n+x+d[0]])
				}
			}
			g.lvl[i], prev, at[m] = l, l, l
		}
		for k, i := range rv.side {
			g.lvl[i] = at[rv.of[k]]
		}
	}
}

// coastDetail cuts small inlets and one- or two-tile notches into about a
// third of the coast (stretches chosen by noise), keeping the rest smooth
// for harbour sites; spurs it leaves are removed.
func (g *grid) coastDetail(r *rng, size int) {
	n := g.n
	depth := slices.Clone(g.waterDistance(4))
	zone := newNoise(r, n, max(4, size/6), 1000)
	var coast []int
	for i, t := range g.t {
		if t != tWater && g.touches4(i, tWater) {
			coast = append(coast, i)
		}
	}
	if len(coast) == 0 {
		return
	}
	vals := make([]int, len(coast))
	for k, i := range coast {
		vals[k] = zone.smooth(i%n, i/n)
	}
	sorted := slices.Clone(vals)
	slices.Sort(sorted)
	cut := sorted[len(sorted)*2/3]
	r.shuffle(len(coast), func(a, b int) { coast[a], coast[b] = coast[b], coast[a]; vals[a], vals[b] = vals[b], vals[a] })
	blocked := make([]bool, len(g.t))
	inside := func(x, y int) bool { return x >= g.pad && y >= g.pad && x < n-g.pad && y < n-g.pad }
	// Harbour stretches: coast around spread anchors stays straight beach
	// (no notch here, no cliff in plateaus), so that Trading Post and
	// shipyard sites remain.
	g.harbour = g.harbourSites(r, size)
	for i, h := range g.harbour {
		blocked[i] = blocked[i] || h
	}
	for k, i := range coast {
		if vals[k] < cut || blocked[i] || g.t[i] == tWater || r.intn(2) != 0 {
			continue
		}
		var carve []int
		if r.intn(3) == 0 {
			carve = slices.Clone(grow(r, g, i, r.between(4, 14), func(j int) bool { return g.t[j] != tWater && depth[j] <= 3 }))
		} else {
			carve = []int{i}
			if r.intn(2) == 0 {
				x, y := i%n, i/n
				d := dirs4()[r.intn(4)]
				if g.in(x+d[0], y+d[1]) && g.t[(y+d[1])*n+x+d[0]] != tWater {
					carve = append(carve, (y+d[1])*n+x+d[0])
				}
			}
		}
		for _, j := range carve {
			g.t[j] = tWater
			x, y := j%n, j/n
			for dy := -3; dy <= 3; dy++ {
				for dx := -3; dx <= 3; dx++ {
					if inside(x+dx, y+dy) {
						blocked[(y+dy)*n+x+dx] = true
					}
				}
			}
		}
	}
	// Remove the spurs (land with fewer than two land 4-neighbours).
	for range 8 {
		changed := false
		for y := g.pad; y < n-g.pad; y++ {
			for x := g.pad; x < n-g.pad; x++ {
				i := y*n + x
				if g.t[i] == tWater {
					continue
				}
				c := 0
				for _, j := range [4]int{i - n, i + 1, i + n, i - 1} {
					if g.t[j] != tWater {
						c++
					}
				}
				if c < 2 {
					g.t[i] = tWater
					changed = true
				}
			}
		}
		if !changed {
			break
		}
	}
	g.keepLargest()
	g.fillLakes()
}

// islets places count islets (decor rocks and sand bars, D-058 part 1):
// blobs of 2-6 water tiles (one or two of 6-15 on large and medium
// islands) turned islet, at least isletGap tiles off the
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
	// A few large islets (rock with a grass top: the renderer's height 2
	// core) on large and medium islands, the rest small rocks and sand
	// bars.
	large := 0
	if size >= ridgeLargeSize {
		large = r.between(1, 2)
	}
	for k := range count {
		seed, ok := g.pick(r, free)
		if !ok {
			break
		}
		want := r.between(2, 6)
		if k < large {
			want = r.between(6, 15)
		}
		tiles := slices.Clone(grow(r, g, seed, want, free))
		rock := k < large || r.intn(3) > 0
		for _, i := range tiles {
			g.t[i] = tIslet
		}
		for _, i := range tiles {
			switch {
			case k < large && len(tiles) >= 6:
				// The core (every 4-neighbour an islet) stands higher.
				g.hgt[i] = 1
				x, y := i%n, i/n
				core := true
				for _, d := range dirs4() {
					core = core && g.at(x+d[0], y+d[1]) == tIslet
				}
				if core {
					g.hgt[i] = 2
				}
			case rock:
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
