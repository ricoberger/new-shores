package archipelago

// Skeleton shapes (D-058 part 1): an island is a trunk with arms, a
// weighted distance field around it, domain-warped and perturbed by
// multi-octave value noise. Everything is integer arithmetic.

// dir32 returns the unit vector (x, y scaled by 1024) of direction i of
// 32 (i taken modulo 32).
func dir32(i int) (int, int) {
	v := [32][2]int{
		{1024, 0}, {1004, 200}, {946, 392}, {851, 569}, {724, 724}, {569, 851}, {392, 946}, {200, 1004},
		{0, 1024}, {-200, 1004}, {-392, 946}, {-569, 851}, {-724, 724}, {-851, 569}, {-946, 392}, {-1004, 200},
		{-1024, 0}, {-1004, -200}, {-946, -392}, {-851, -569}, {-724, -724}, {-569, -851}, {-392, -946}, {-200, -1004},
		{0, -1024}, {200, -1004}, {392, -946}, {569, -851}, {724, -724}, {851, -569}, {946, -392}, {1004, -200},
	}[i&31]
	return v[0], v[1]
}

// bone is one polyline of the skeleton: points and radii in skeleton
// units (1024 = the size class's extent) until fit converts them to tile
// units x16.
type bone struct {
	x, y, r []int
	// arm marks an arm (not a trunk half); root is the trunk point index
	// of an arm's root on the trunk half it starts from (half).
	arm  bool
	half int
	root int
}

func (b *bone) add(x, y, r int) {
	b.x, b.y, b.r = append(b.x, x), append(b.y, y), append(b.r, r)
}

func (b *bone) last() (int, int) { return b.x[len(b.x)-1], b.y[len(b.y)-1] }

// skeleton draws a trunk (two halves from the centre in opposite
// directions, drifting) and arms arms rooted on it, in skeleton units.
// Bones 0 and 1 are the trunk halves; arms follow.
func skeleton(r *rng, arms int) []*bone {
	heading := r.intn(32)
	radius := r.between(150, 200)
	var out []*bone
	for h := range 2 {
		b := &bone{half: h}
		b.add(0, 0, radius)
		d := heading + 16*h
		length := r.between(260, 380)
		segs := 3
		for s := 1; s <= segs; s++ {
			d += r.between(-2, 2)
			dx, dy := dir32(d)
			px, py := b.last()
			step := length / segs
			// The trunk tapers to ~60 % of its radius at the tips.
			b.add(px+dx*step/1024, py+dy*step/1024, radius*(100-13*s)/100)
		}
		out = append(out, b)
	}
	for range arms {
		h := r.intn(2)
		trunk := out[h]
		root := r.between(1, len(trunk.x)-2)
		side := 1 - 2*r.intn(2)
		d := heading + 16*h + side*r.between(6, 10)
		b := &bone{arm: true, half: h, root: root}
		rr := trunk.r[root] * r.between(50, 70) / 100
		b.add(trunk.x[root], trunk.y[root], rr)
		length := r.between(300, 450)
		segs := 3
		for s := 1; s <= segs; s++ {
			d += r.between(-2, 2)
			dx, dy := dir32(d)
			px, py := b.last()
			step := length / segs
			b.add(px+dx*step/1024, py+dy*step/1024, rr*(100-17*s)/100)
		}
		out = append(out, b)
	}
	return out
}

// fit scales and moves the skeleton into the tile grid: the bounding box
// of the bones' discs, grown by inset tiles on every side, fills the
// extent of size tiles that starts at pad. Coordinates and radii become
// tile units x16.
func fit(bones []*bone, size, pad, inset int) {
	x0, y0, x1, y1 := 1<<30, 1<<30, -1<<30, -1<<30
	for _, b := range bones {
		for i := range b.x {
			x0, y0 = min(x0, b.x[i]-b.r[i]), min(y0, b.y[i]-b.r[i])
			x1, y1 = max(x1, b.x[i]+b.r[i]), max(y1, b.y[i]+b.r[i])
		}
	}
	span := max(x1-x0, y1-y0, 1)
	avail := max(1, size-2*inset) * 16
	cx, cy := (x0+x1)/2, (y0+y1)/2
	mid := (pad*2 + size) * 8 // the extent's centre, x16
	for _, b := range bones {
		for i := range b.x {
			b.x[i] = mid + (b.x[i]-cx)*avail/span
			b.y[i] = mid + (b.y[i]-cy)*avail/span
			b.r[i] = b.r[i] * avail / span
		}
	}
}

// chamferInf is the "far" value of a chamfer field.
const chamferInf = 1 << 28

// chamfer runs the two-pass 3-4 chamfer transform on v (n x n, values in
// thirds of a tile): afterwards v[i] = min over j of (v0[j] + d(i, j)),
// so seeds with negative values give a weighted distance field.
func chamfer(v []int, n int) {
	for y := range n {
		for x := range n {
			i := y*n + x
			m := v[i]
			if x > 0 {
				m = min(m, v[i-1]+3)
			}
			if y > 0 {
				m = min(m, v[i-n]+3)
				if x > 0 {
					m = min(m, v[i-n-1]+4)
				}
				if x < n-1 {
					m = min(m, v[i-n+1]+4)
				}
			}
			v[i] = m
		}
	}
	for y := n - 1; y >= 0; y-- {
		for x := n - 1; x >= 0; x-- {
			i := y*n + x
			m := v[i]
			if x < n-1 {
				m = min(m, v[i+1]+3)
			}
			if y < n-1 {
				m = min(m, v[i+n]+3)
				if x < n-1 {
					m = min(m, v[i+n+1]+4)
				}
				if x > 0 {
					m = min(m, v[i+n-1]+4)
				}
			}
			v[i] = m
		}
	}
}

// stamp writes value (thirds of a tile) along the segment from (x0, y0)
// to (x1, y1) (tile units x16) into v where it is lower, interpolating
// value from v0 to v1; tiles off the grid are skipped.
func stamp(v []int, n, x0, y0, x1, y1, v0, v1 int) {
	steps := max(abs(x1-x0), abs(y1-y0))/8 + 1
	for s := 0; s <= steps; s++ {
		x := (x0 + (x1-x0)*s/steps) >> 4
		y := (y0 + (y1-y0)*s/steps) >> 4
		if x < 0 || y < 0 || x >= n || y >= n {
			continue
		}
		val := v0 + (v1-v0)*s/steps
		if i := y*n + x; val < v[i] {
			v[i] = val
		}
	}
}

// boneFieldInto writes the weighted distance field of the skeleton into
// v (n x n): for every tile the largest (radius - distance) over the
// bones' points, in thirds of a tile (positive inside the discs).
func boneFieldInto(v []int, bones []*bone, n int) []int {
	for i := range v {
		v[i] = chamferInf
	}
	for _, b := range bones {
		for i := 1; i < len(b.x); i++ {
			stamp(v, n, b.x[i-1], b.y[i-1], b.x[i], b.y[i], -b.r[i-1]*3/16, -b.r[i]*3/16)
		}
	}
	chamfer(v, n)
	for i := range v {
		v[i] = -v[i]
	}
	return v
}

// smooth returns the value noise at (x, y) with smoothstep interpolation
// between the lattice values (no grid artefacts of the bilinear at).
func (z *noise) smooth(x, y int) int {
	x, y = max(x, 0), max(y, 0)
	gx, gy := x/z.cell, y/z.cell
	if gx+1 >= z.w {
		gx = z.w - 2
	}
	if gy+1 >= z.w {
		gy = z.w - 2
	}
	c := z.cell
	fx, fy := min(x-gx*c, c), min(y-gy*c, c)
	// smoothstep weights in 1/1024: s(t) = t^2 (3 - 2t).
	sx := smoothstep(fx * 1024 / c)
	sy := smoothstep(fy * 1024 / c)
	v00, v10 := z.v[gy*z.w+gx], z.v[gy*z.w+gx+1]
	v01, v11 := z.v[(gy+1)*z.w+gx], z.v[(gy+1)*z.w+gx+1]
	top := v00*(1024-sx) + v10*sx
	bot := v01*(1024-sx) + v11*sx
	return (top*(1024-sy) + bot*sy) / (1024 * 1024)
}

// smoothstep maps t in [0, 1024] to t^2 (3 - 2t), in [0, 1024].
func smoothstep(t int) int { return t * t / 1024 * (3*1024 - 2*t) / 1024 }

// fbm is a sum of value-noise octaves, each half the cell and amplitude
// of the previous one.
type fbm []*noise

func newFBM(r *rng, n, cell, amp, octaves int) fbm {
	var out fbm
	for range octaves {
		out = append(out, newNoise(r, n, max(2, cell), max(1, amp)))
		cell, amp = cell/2, amp/2
	}
	return out
}

func (f fbm) at(x, y int) int {
	s := 0
	for _, z := range f {
		s += z.smooth(x, y)
	}
	return s
}
