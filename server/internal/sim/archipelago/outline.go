package archipelago

// Outline checks (D-058 part 1): large and medium islands keep a deep bay
// and a peninsula, so that their outline does not round off into a disc.

const (
	// bayMinPct is the least depth of the deepest bay, percent of the
	// island's span: the largest distance of a sea tile inside the convex
	// hull of the land to the hull's rim.
	bayMinPct = 15
	// peninsulaOpenPct is the radius (percent of the span) of the opening
	// that removes the peninsulas from the land; peninsulaMinPct the least
	// reach of the longest one beyond the opened body.
	peninsulaOpenPct = 16
	peninsulaMinPct  = 10
)

// outlineOK reports whether the land has a bay of at least bayMinPct and
// a peninsula of at least peninsulaMinPct of its span (large and medium
// islands).
func (g *grid) outlineOK() bool {
	land := make([]bool, len(g.t))
	for i, t := range g.t {
		land[i] = t != tWater
	}
	span, bay, pen := outlineOf(land, g.n, g.n)
	switch {
	case bay*100 < span*bayMinPct && pen*100 < span*peninsulaMinPct:
		g.s.reject = "outline: no bay, no peninsula"
	case bay*100 < span*bayMinPct:
		g.s.reject = "outline: no bay"
	case pen*100 < span*peninsulaMinPct:
		g.s.reject = "outline: no peninsula"
	default:
		return true
	}
	return false
}

// outlineOf measures the land mask land (w x h): the span (larger side of
// the land's bounding box), the depth of the deepest bay and the reach of
// the longest peninsula, in tiles x16. Integer arithmetic only.
func outlineOf(land []bool, w, h int) (span, bay, pen int) {
	x0, y0, x1, y1 := w, h, -1, -1
	var pts [][2]int
	for y := range h {
		l, r := -1, -1
		for x := range w {
			if land[y*w+x] {
				if l < 0 {
					l = x
				}
				r = x
			}
		}
		if l < 0 {
			continue
		}
		x0, x1, y0, y1 = min(x0, l), max(x1, r), min(y0, y), max(y1, y)
		pts = append(pts, [2]int{l, y}, [2]int{r, y})
	}
	if x1 < 0 {
		return 0, 0, 0
	}
	span = max(x1-x0, y1-y0) + 1
	return span * 16, bayDepth(land, w, h, hull(pts)), peninsulaReach(land, w, h, span, peninsulaOpenPct)
}

// cross returns the z component of (a - o) x (b - o).
func cross(o, a, b [2]int) int {
	return (a[0]-o[0])*(b[1]-o[1]) - (a[1]-o[1])*(b[0]-o[0])
}

// hull returns the convex hull of pts in counter-clockwise order
// (monotone chain; pts are sorted by y, then x, per row as built by
// outline, and re-sorted here).
func hull(pts [][2]int) [][2]int {
	ps := append([][2]int(nil), pts...)
	// insertion sort by x, then y: the rows come in y order already.
	for i := 1; i < len(ps); i++ {
		for j := i; j > 0 && (ps[j][0] < ps[j-1][0] || (ps[j][0] == ps[j-1][0] && ps[j][1] < ps[j-1][1])); j-- {
			ps[j], ps[j-1] = ps[j-1], ps[j]
		}
	}
	if len(ps) < 3 {
		return ps
	}
	var lo, hi [][2]int
	for _, p := range ps {
		for len(lo) >= 2 && cross(lo[len(lo)-2], lo[len(lo)-1], p) <= 0 {
			lo = lo[:len(lo)-1]
		}
		lo = append(lo, p)
	}
	for i := len(ps) - 1; i >= 0; i-- {
		p := ps[i]
		for len(hi) >= 2 && cross(hi[len(hi)-2], hi[len(hi)-1], p) <= 0 {
			hi = hi[:len(hi)-1]
		}
		hi = append(hi, p)
	}
	return append(lo[:len(lo)-1], hi[:len(hi)-1]...)
}

// bayDepth returns the largest distance (tiles x16) of a water tile
// inside the convex hull hl to the hull's rim.
func bayDepth(land []bool, w, h int, hl [][2]int) int {
	if len(hl) < 3 {
		return 0
	}
	lens := make([]int, len(hl))
	for i := range hl {
		a, b := hl[i], hl[(i+1)%len(hl)]
		lens[i] = max(1, isqrt((b[0]-a[0])*(b[0]-a[0])+(b[1]-a[1])*(b[1]-a[1])))
	}
	best := 0
	for y := range h {
		for x := range w {
			if land[y*w+x] {
				continue
			}
			p := [2]int{x, y}
			d := 1 << 30
			for i := range hl {
				c := cross(hl[i], hl[(i+1)%len(hl)], p)
				if c <= 0 {
					d = -1
					break
				}
				d = min(d, c*16/lens[i])
			}
			best = max(best, d)
		}
	}
	return best
}

// peninsulaReach returns the reach (tiles x16) of the longest peninsula:
// the land is opened with a disc of peninsulaOpenPct of the span (eroded,
// then dilated); the reach is the largest distance of a land tile to the
// opened body.
func peninsulaReach(land []bool, w, h, span, openPct int) int {
	n := max(w, h)
	e := max(1, span*openPct/100) * 3 // thirds of a tile
	v := make([]int, n*n)
	for i := range v {
		v[i] = 0
		if x, y := i%n, i/n; x < w && y < h && land[y*w+x] {
			v[i] = chamferInf
		}
	}
	chamfer(v, n) // distance to water
	body := make([]int, n*n)
	for i := range body {
		body[i] = chamferInf
		if v[i] >= e {
			body[i] = 0
		}
	}
	chamfer(body, n) // distance to the eroded core
	for i := range body {
		if body[i] <= e {
			body[i] = 0
		} else {
			body[i] = chamferInf
		}
	}
	chamfer(body, n) // distance to the opened body
	best := 0
	for y := range h {
		for x := range w {
			if land[y*w+x] {
				best = max(best, body[y*n+x])
			}
		}
	}
	return best * 16 / 3
}
