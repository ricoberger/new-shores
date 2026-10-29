package archipelago

import (
	"errors"
	"slices"

	"github.com/ricoberger/new-shores/server/internal/content"
	"github.com/ricoberger/new-shores/server/internal/sim"
)

// Skerries and open-sea rules (D-058): small rocks with a grass or sand
// top scattered between the islands, and a bound on the open sea inside
// the archipelago.

// skerryTries bounds the candidate positions per skerry.
const skerryTries = 200

// voidCell is the edge in tiles of the cells of the open-sea check.
const voidCell = 8

// Scenic reports whether an island is a skerry (a scenic size class).
func Scenic(rules *content.IslandRules, is *sim.Island) bool {
	sc := rules.SizeClassByID[is.SizeClass]
	return sc != nil && sc.Scenic
}

// Main returns the islands without the skerries.
func Main(rules *content.IslandRules, islands []*sim.Island) []*sim.Island {
	var out []*sim.Island
	for _, is := range islands {
		if !Scenic(rules, is) {
			out = append(out, is)
		}
	}
	return out
}

// SkerryTiles is the range of land tiles of a skerry of a class: size to
// ¾·size².
func SkerryTiles(sc *content.SizeClass) content.Range {
	return content.Range{Min: sc.Size, Max: max(sc.Size, sc.Size*sc.Size*3/4)}
}

// skerries adds the skerries of every scenic size class to the laid-out
// islands: each a blob of SkerryTiles land tiles (one top, grass or sand,
// raised one level so that its sides are rock; the core of a larger one
// two), placed next to a random island with at least StraitMin tiles of
// water (grid to grid) to every island and skerry, inside the islands'
// bounds and within NearestMax of an island. IDs continue the islands'.
func skerries(r *rng, islands []*sim.Island, rules *content.IslandRules) ([]*sim.Island, error) {
	main := len(islands)
	minX, minY, maxX, maxY := Bounds(islands[:main])
	strait := rules.StraitMin
	for _, sc := range rules.SizeClasses {
		if !sc.Scenic {
			continue
		}
		for range r.between(sc.Count.Min, sc.Count.Max) {
			is := skerry(r, sc)
			is.ID = IslandID(len(islands))
			placed := false
			for range skerryTries {
				a := islands[r.intn(main)]
				reach := rules.NearestMax
				is.X = r.between(a.X-is.Width-reach, a.X+a.Width+reach)
				is.Y = r.between(a.Y-is.Height-reach, a.Y+a.Height+reach)
				if is.X < minX || is.Y < minY || is.X+is.Width > maxX || is.Y+is.Height > maxY {
					continue
				}
				ok, near := true, false
				for _, o := range islands {
					g := Gap2(is, o)
					if g < strait*strait {
						ok = false
						break
					}
					near = near || g <= rules.NearestMax*rules.NearestMax
				}
				if ok && near {
					placed = true
					break
				}
			}
			if !placed {
				return nil, errors.New("no position for a skerry")
			}
			islands = append(islands, is)
		}
	}
	return islands, nil
}

// skerry draws the shape of one skerry at (0, 0): a 4-connected blob
// grown from one tile, cropped with the water margin.
func skerry(r *rng, sc *content.SizeClass) *sim.Island {
	tr := SkerryTiles(sc)
	want := r.between(tr.Min, tr.Max)
	top := content.TerrainGrass
	if r.intn(2) == 0 {
		top = content.TerrainCoast
	}
	blob := []sim.Pos{{}}
	in := func(p sim.Pos) bool { return slices.Contains(blob, p) }
	for len(blob) < want {
		var frontier []sim.Pos
		for _, p := range blob {
			for _, d := range dirs4() {
				q := sim.Pos{X: p.X + d[0], Y: p.Y + d[1]}
				if !in(q) && !slices.Contains(frontier, q) {
					frontier = append(frontier, q)
				}
			}
		}
		blob = append(blob, frontier[r.intn(len(frontier))])
	}
	x0, y0, x1, y1 := 0, 0, 0, 0
	for _, p := range blob {
		x0, y0, x1, y1 = min(x0, p.X), min(y0, p.Y), max(x1, p.X), max(y1, p.Y)
	}
	w, h := x1-x0+1+2*margin, y1-y0+1+2*margin
	tiles := make([]sim.Tile, w*h)
	for i := range tiles {
		tiles[i].Terrain = content.TerrainWater
	}
	for _, p := range blob {
		tiles[(p.Y-y0+margin)*w+p.X-x0+margin] = sim.Tile{Terrain: top, Level: 1}
	}
	// The core of a larger skerry (every 4-neighbour land) stands a level higher.
	if len(blob) >= 8 {
		for _, p := range blob {
			core := true
			for _, d := range dirs4() {
				core = core && in(sim.Pos{X: p.X + d[0], Y: p.Y + d[1]})
			}
			if core {
				tiles[(p.Y-y0+margin)*w+p.X-x0+margin].Level = 2
			}
		}
	}
	is := sim.NewIsland("", w, h, tiles)
	is.SizeClass = sc.ID
	return is
}

// landGap2 is the squared Euclidean distance between the nearest land
// tiles of two islands (tile to tile), checked up to limit tiles; limit²
// when none are closer.
func landGap2(a, b *sim.Island, limit int) int {
	if g := Gap2(a, b); g >= limit*limit {
		return limit * limit
	}
	best := limit * limit
	for ay := range a.Height {
		for ax := range a.Width {
			if a.Tiles[ay*a.Width+ax].Terrain == content.TerrainWater {
				continue
			}
			px, py := a.X+ax, a.Y+ay
			for by := max(0, py-limit-b.Y); by <= min(b.Height-1, py+limit-b.Y); by++ {
				for bx := max(0, px-limit-b.X); bx <= min(b.Width-1, px+limit-b.X); bx++ {
					if b.Tiles[by*b.Width+bx].Terrain == content.TerrainWater {
						continue
					}
					dx, dy := b.X+bx-px, b.Y+by-py
					best = min(best, dx*dx+dy*dy)
				}
			}
		}
	}
	return best
}

// MaxVoid is an upper bound in tiles of the distance from any sea point
// inside the convex hull of the islands' land to the nearest land: an
// 8-connected chamfer distance (≥ the Euclidean one) over voidCell-tile
// cells, plus the diagonal of a cell for the points inside a cell.
func MaxVoid(islands []*sim.Island) int {
	if len(islands) == 0 {
		return 0
	}
	minX, minY, maxX, maxY := Bounds(islands)
	nx, ny := (maxX-minX)/voidCell+1, (maxY-minY)/voidCell+1
	land := make([]bool, nx*ny)
	var cells []sim.Pos
	for _, is := range islands {
		for y := range is.Height {
			for x := range is.Width {
				if is.Tiles[y*is.Width+x].Terrain == content.TerrainWater {
					continue
				}
				land[((is.Y+y-minY)/voidCell)*nx+(is.X+x-minX)/voidCell] = true
			}
		}
	}
	for k, l := range land {
		if l {
			cells = append(cells, sim.Pos{X: k % nx, Y: k / nx})
		}
	}
	hull := convexHull(cells)
	// Chamfer distance (cells × 10, diagonal 14) from the land cells.
	const unset = 1 << 30
	dist := make([]int, nx*ny)
	for k := range dist {
		dist[k] = unset
		if land[k] {
			dist[k] = 0
		}
	}
	pass := func(k, i, j int, ds [4][3]int) {
		for _, d := range ds {
			ni, nj := i+d[0], j+d[1]
			if ni < 0 || nj < 0 || ni >= nx || nj >= ny {
				continue
			}
			if v := dist[nj*nx+ni] + d[2]; v < dist[k] {
				dist[k] = v
			}
		}
	}
	fwd := [4][3]int{{-1, 0, 10}, {-1, -1, 14}, {0, -1, 10}, {1, -1, 14}}
	bwd := [4][3]int{{1, 0, 10}, {1, 1, 14}, {0, 1, 10}, {-1, 1, 14}}
	for j := range ny {
		for i := range nx {
			pass(j*nx+i, i, j, fwd)
		}
	}
	for j := ny - 1; j >= 0; j-- {
		for i := nx - 1; i >= 0; i-- {
			pass(j*nx+i, i, j, bwd)
		}
	}
	worst := 0
	for k, d := range dist {
		if d == 0 || d == unset || !insideHull(hull, sim.Pos{X: k % nx, Y: k / nx}) {
			continue
		}
		worst = max(worst, d)
	}
	if worst == 0 {
		return 0
	}
	// Cells to tiles, rounded up, plus a cell's diagonal.
	return (worst*voidCell+9)/10 + voidCell*3/2
}

// convexHull is the convex hull of points (Andrew's monotone chain,
// counter-clockwise in a y-down grid seen as y-up, without collinear
// points).
func convexHull(pts []sim.Pos) []sim.Pos {
	pts = slices.Clone(pts)
	slices.SortFunc(pts, func(a, b sim.Pos) int {
		if a.X != b.X {
			return a.X - b.X
		}
		return a.Y - b.Y
	})
	pts = slices.Compact(pts)
	if len(pts) < 3 {
		return pts
	}
	cross := func(o, a, b sim.Pos) int { return (a.X-o.X)*(b.Y-o.Y) - (a.Y-o.Y)*(b.X-o.X) }
	var h []sim.Pos
	for _, p := range pts {
		for len(h) >= 2 && cross(h[len(h)-2], h[len(h)-1], p) <= 0 {
			h = h[:len(h)-1]
		}
		h = append(h, p)
	}
	lower := len(h) + 1
	for i := len(pts) - 2; i >= 0; i-- {
		p := pts[i]
		for len(h) >= lower && cross(h[len(h)-2], h[len(h)-1], p) <= 0 {
			h = h[:len(h)-1]
		}
		h = append(h, p)
	}
	return h[:len(h)-1]
}

// insideHull reports whether p lies inside or on a convex hull (in the
// order of convexHull).
func insideHull(h []sim.Pos, p sim.Pos) bool {
	if len(h) < 3 {
		return false
	}
	for i := range h {
		a, b := h[i], h[(i+1)%len(h)]
		if (b.X-a.X)*(p.Y-a.Y)-(b.Y-a.Y)*(p.X-a.X) < 0 {
			return false
		}
	}
	return true
}
