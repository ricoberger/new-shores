// Package layout finds building sites, road paths and field drags on the
// islands of a world. It is shared by the dev fixtures (devworld) and the
// reference-game generator (sim/scenario/plan, D-067): sites are found
// programmatically on the generated terrain and validated by the server's
// own placement check (sim.SiteChecker, trial commands on a world copy).
//
// A Planner only reads its world; the trial helpers work on clones.
package layout

import (
	"slices"

	"github.com/ricoberger/new-shores/server/internal/content"
	"github.com/ricoberger/new-shores/server/internal/sim"
	"github.com/ricoberger/new-shores/server/internal/sim/archipelago"
)

// MaxCandidates bounds the sites tried per placement (nearest first).
const MaxCandidates = 600

// Planner answers layout queries on a world.
type Planner struct {
	C *content.Catalogue
	W *sim.World
	// SpareForest keeps sites and roads off the forest (forest is scenery
	// since D-059); callers retry without it when nothing else fits.
	SpareForest bool
	// NoBuild reports a tile reserved against buildings (nil: none).
	NoBuild func(island string, x, y int) bool
	// NoRoad reports a tile reserved against roads (nil: none).
	NoRoad func(island string, x, y int) bool
}

// Rotations lists the four rotations.
func Rotations() []int { return []int{0, 90, 180, 270} }

// Dims returns the width and height of a footprint at a rotation.
func Dims(def *content.Building, rot int) (int, int) {
	if rot == 90 || rot == 270 {
		return def.Height, def.Width
	}
	return def.Width, def.Height
}

// View is a snapshot of an island's occupancy for tile scans; the island
// must not change while it is used.
type View struct {
	p      *Planner
	island string
	is     *sim.Island
	occ    []int64
}

// View returns the view of an island.
func (p *Planner) View(is *sim.Island) *View {
	return &View{p: p, island: is.ID, is: is, occ: is.Occupancy(p.C)}
}

// Open reports whether a tile is buildable land without a building or road.
func (v *View) Open(x, y int) bool {
	is := v.is
	if !is.InBounds(x, y) || is.RoadAt(x, y) != "" || v.occ[y*is.Width+x] != 0 {
		return false
	}
	t := is.Tile(x, y).Terrain
	return t == content.TerrainCoast || t == content.TerrainGrass || t == content.TerrainForest
}

// spared reports a forest tile while the planner spares the forest.
func (v *View) spared(x, y int) bool {
	return v.p.SpareForest && v.is.Tile(x, y).Terrain == content.TerrainForest
}

// Free is Open, minus spared forest and tiles reserved against buildings.
func (v *View) Free(x, y int) bool {
	return v.Open(x, y) && !v.spared(x, y) && (v.p.NoBuild == nil || !v.p.NoBuild(v.island, x, y))
}

// RoadFree is Open, minus spared forest and tiles reserved against roads.
func (v *View) RoadFree(x, y int) bool {
	return v.Open(x, y) && !v.spared(x, y) && (v.p.NoRoad == nil || !v.p.NoRoad(v.island, x, y))
}

// Occupied returns the building ID on a tile (0: none).
func (v *View) Occupied(x, y int) int64 { return v.occ[y*v.is.Width+x] }

// step returns the tiles a road takes from (x, y) in direction d: the next
// tile when land is ok there, or a straight bridge over one or two free
// river tiles with ok land behind it (D-058 part 3: a road crosses a river
// straight, never along it); nil when neither. A new road tile never
// touches the side of an existing bridge (sim: the bridge would no longer
// be straight), and no bridge starts on a bridge.
func (v *View) step(x, y int, d [2]int, land func(x, y int) bool) []int {
	is := v.is
	fromRiver := is.Tile(x, y).Terrain == content.TerrainRiver
	var out []int
	for k := 1; k <= 3; k++ {
		nx, ny := x+d[0]*k, y+d[1]*k
		if !is.InBounds(nx, ny) {
			return nil
		}
		if land(nx, ny) {
			if is.RoadAt(nx, ny) == "" && v.besideBridge(nx, ny) {
				return nil
			}
			return append(out, ny*is.Width+nx)
		}
		if k == 3 || fromRiver || is.Tile(nx, ny).Terrain != content.TerrainRiver || is.RoadAt(nx, ny) != "" || v.occ[ny*is.Width+nx] != 0 {
			return nil
		}
		if v.p.NoRoad != nil && v.p.NoRoad(v.island, nx, ny) {
			return nil
		}
		// No road beside the bridge (it would run along the river).
		for _, s := range [2]int{-1, 1} {
			if sx, sy := nx+d[1]*s, ny+d[0]*s; is.InBounds(sx, sy) && is.RoadAt(sx, sy) != "" {
				return nil
			}
		}
		out = append(out, ny*is.Width+nx)
	}
	return nil
}

// besideBridge reports whether a 4-neighbour of the tile is a river tile
// with a road (a bridge).
func (v *View) besideBridge(x, y int) bool {
	for _, d := range [4][2]int{{0, -1}, {1, 0}, {0, 1}, {-1, 0}} {
		nx, ny := x+d[0], y+d[1]
		if v.is.InBounds(nx, ny) && v.is.Tile(nx, ny).Terrain == content.TerrainRiver && v.is.RoadAt(nx, ny) != "" {
			return true
		}
	}
	return false
}

// CoversForest reports whether a footprint covers a forest tile.
func CoversForest(is *sim.Island, x, y, w, h int) bool {
	for ty := y; ty < y+h; ty++ {
		for tx := x; tx < x+w; tx++ {
			if is.Tile(tx, ty).Terrain == content.TerrainForest {
				return true
			}
		}
	}
	return false
}

// TradingPostSite returns the island's Trading Post site with the most
// free land within ten tiles behind it (the first on ties).
func (p *Planner) TradingPostSite(island string) (archipelago.Rect, bool) {
	is := p.W.Island(island)
	def := archipelago.TradingPost(p.C)
	if is == nil || def == nil {
		return archipelago.Rect{}, false
	}
	best, bestScore := archipelago.Rect{}, -1
	v := p.View(is)
	for _, s := range archipelago.Sites(is, p.C, def) {
		cx, cy := s.X+s.W/2, s.Y+s.H/2
		dx, dy := Inland(s.Rotation)
		cx, cy = cx+dx*6, cy+dy*6
		score := 0
		for y := cy - 6; y <= cy+6; y++ {
			for x := cx - 6; x <= cx+6; x++ {
				if v.Free(x, y) {
					score++
				}
			}
		}
		if score > bestScore {
			best, bestScore = s, score
		}
	}
	return best, bestScore >= 0
}

// Inland is the direction from a water-edge building's water rows to its
// land rows (rotation 0: water at the top).
func Inland(rot int) (int, int) {
	switch rot {
	case 90:
		return -1, 0
	case 180:
		return 0, -1
	case 270:
		return 1, 0
	}
	return 0, 1
}

// TradingPost returns the island's Trading Post.
func (p *Planner) TradingPost(island string) *sim.Building {
	is := p.W.Island(island)
	if is == nil {
		return nil
	}
	for _, b := range is.Buildings {
		if def := p.C.BuildingByID[b.Type]; def != nil && def.TradingPost != nil {
			return b
		}
	}
	return nil
}

// TradingPostCentre returns the centre tile of the island's Trading Post.
func (p *Planner) TradingPostCentre(island string) sim.Pos {
	b := p.TradingPost(island)
	if b == nil {
		return sim.Pos{}
	}
	w, h := Dims(p.C.BuildingByID[b.Type], b.Rotation)
	return sim.Pos{X: b.X + w/2, Y: b.Y + h/2}
}

// StreetTiles returns the free tiles of a straight street of up to n tiles
// from behind the island's Trading Post inland (nil without a Trading
// Post).
func (p *Planner) StreetTiles(island string, n int) []sim.Pos {
	tp := p.TradingPost(island)
	if tp == nil {
		return nil
	}
	is := p.W.Island(island)
	w, h := Dims(p.C.BuildingByID[tp.Type], tp.Rotation)
	dx, dy := Inland(tp.Rotation)
	// The middle of the land-side edge, one tile outside the footprint.
	x, y := tp.X+w/2, tp.Y+h/2
	switch {
	case dy > 0:
		y = tp.Y + h
	case dy < 0:
		y = tp.Y - 1
	case dx > 0:
		x = tp.X + w
	default:
		x = tp.X - 1
	}
	var tiles []sim.Pos
	v := p.View(is)
	for len(tiles) < n && v.Free(x, y) {
		tiles = append(tiles, sim.Pos{X: x, Y: y})
		x, y = x+dx, y+dy
	}
	return tiles
}

// GrassAnchor returns the tile nearest to from whose surroundings
// (Chebyshev radius 4) hold at least 50 free grass or coast tiles: the
// centre of a town that spares the forest; from itself when there is
// none.
func (p *Planner) GrassAnchor(island string, from sim.Pos) sim.Pos {
	return p.OpenAnchor(island, from, 4, 50)
}

// FieldAnchor is GrassAnchor for a farm's required fields: the nearest
// tile whose surroundings hold room for them (river-cut and forested
// D-058 islands have no such room next to every street).
func (p *Planner) FieldAnchor(island string, from sim.Pos, farm *content.Building) sim.Pos {
	n := 0
	if farm.Fields != nil {
		if field := p.C.FieldByType[farm.Fields.Type]; field != nil {
			n = farm.Fields.Required * field.Width * field.Height
		}
	}
	r := 4
	for (2*r+1)*(2*r+1) < n*3/2 {
		r++
	}
	return p.OpenAnchor(island, from, r, n*5/4)
}

// OpenAnchor returns the tile nearest to from whose surroundings
// (Chebyshev radius r) hold at least n open tiles that are not forest and
// not reserved against buildings; from itself when there is none.
func (p *Planner) OpenAnchor(island string, from sim.Pos, r, n int) sim.Pos {
	is := p.W.Island(island)
	v := p.View(is)
	w, h := is.Width, is.Height
	sat := make([]int, (w+1)*(h+1))
	for y := range h {
		for x := range w {
			c := 0
			if v.Open(x, y) && is.Tile(x, y).Terrain != content.TerrainForest && (p.NoBuild == nil || !p.NoBuild(island, x, y)) {
				c = 1
			}
			sat[(y+1)*(w+1)+x+1] = c + sat[y*(w+1)+x+1] + sat[(y+1)*(w+1)+x] - sat[y*(w+1)+x]
		}
	}
	best, bestD := from, -1
	for y := range h {
		for x := range w {
			x0, y0, x1, y1 := max(0, x-r), max(0, y-r), min(w, x+r+1), min(h, y+r+1)
			if sat[y1*(w+1)+x1]-sat[y0*(w+1)+x1]-sat[y1*(w+1)+x0]+sat[y0*(w+1)+x0] < n {
				continue
			}
			if d := (x-from.X)*(x-from.X) + (y-from.Y)*(y-from.Y); bestD < 0 || d < bestD {
				best, bestD = sim.Pos{X: x, Y: y}, d
			}
		}
	}
	return best
}

// ForestAnchor returns the tile nearest to from whose surroundings
// (Chebyshev radius 4) hold at least 30 free forest tiles, and that a
// road from the island's network reaches (not across a river or up a
// cliff); from itself when there is none. Lumberjacks go to the forest
// edge: their tree plots (D-059) stand on grass or forest and keep the
// town's open land free.
func (p *Planner) ForestAnchor(island string, from sim.Pos) sim.Pos {
	is := p.W.Island(island)
	v := p.View(is)
	reach := p.Reachable(island)
	best, bestD := from, -1
	for y := range is.Height {
		for x := range is.Width {
			if !reach[y*is.Width+x] {
				continue
			}
			n := 0
			for ty := y - 4; ty <= y+4; ty++ {
				for tx := x - 4; tx <= x+4; tx++ {
					if is.InBounds(tx, ty) && is.Tile(tx, ty).Terrain == content.TerrainForest && v.Open(tx, ty) && (p.NoBuild == nil || !p.NoBuild(island, tx, ty)) {
						n++
					}
				}
			}
			if n < 30 {
				continue
			}
			if d := (x-from.X)*(x-from.X) + (y-from.Y)*(y-from.Y); bestD < 0 || d < bestD {
				best, bestD = sim.Pos{X: x, Y: y}, d
			}
		}
	}
	return best
}

// Site is a candidate anchor and rotation of a building with the doubled
// squared distance of its footprint centre from the anchor.
type Site struct{ X, Y, Rot, D int }

// Candidates lists the anchors and rotations of a building on the island
// by distance of the footprint centre from anchor.
func Candidates(is *sim.Island, def *content.Building, anchor sim.Pos) []Site {
	var out []Site
	rots := Rotations()
	if def.Width == def.Height && def.WaterRows == nil {
		rots = rots[:1] // the rotations of a square footprint cover the same tiles
	}
	for _, rot := range rots {
		w, h := Dims(def, rot)
		for y := 0; y+h <= is.Height; y++ {
			for x := 0; x+w <= is.Width; x++ {
				dx, dy := 2*x+w-2*anchor.X-1, 2*y+h-2*anchor.Y-1
				out = append(out, Site{x, y, rot, dx*dx + dy*dy})
			}
		}
	}
	slices.SortStableFunc(out, func(a, b Site) int { return a.D - b.D })
	return out
}

// FieldDrag applies a place_fields drag (D-054) over the largest square
// ring around the farm that fits MaxFieldTiles, nearest anchors first, to
// a copy of the world, and returns the copy and the anchors of the fields
// placed in drag order (nil when the drag fails). keep (if set) filters
// the drag's tiles.
func (p *Planner) FieldDrag(island string, farmID int64, typ string, keep func(x, y int) bool) (*sim.World, []sim.Pos) {
	is := p.W.Island(island)
	if is == nil {
		return nil, nil
	}
	farm := is.Building(farmID)
	if farm == nil {
		return nil, nil
	}
	fw, fh := Dims(p.C.BuildingByID[farm.Type], farm.Rotation)
	r := 1
	for (fw+2*(r+1))*(fh+2*(r+1)) <= sim.MaxFieldTiles {
		r++
	}
	cx, cy := 2*farm.X+fw, 2*farm.Y+fh // doubled centre
	var tiles []sim.Pos
	for y := farm.Y - r; y < farm.Y+fh+r; y++ {
		for x := farm.X - r; x < farm.X+fw+r; x++ {
			if is.InBounds(x, y) && (x < farm.X || x >= farm.X+fw || y < farm.Y || y >= farm.Y+fh) && (keep == nil || keep(x, y)) {
				tiles = append(tiles, sim.Pos{X: x, Y: y})
			}
		}
	}
	dist := func(q sim.Pos) int {
		dx, dy := 2*q.X+1-cx, 2*q.Y+1-cy
		return dx*dx + dy*dy
	}
	slices.SortStableFunc(tiles, func(a, b sim.Pos) int { return dist(a) - dist(b) })
	w := p.W.Clone()
	res, err := sim.ApplyWithResult(w, p.C, sim.PlaceFields{IslandID: island, FarmID: farmID, Type: typ, Tiles: tiles}, nil)
	if err != nil {
		return nil, nil
	}
	var placed []sim.Pos
	for _, t := range res.Tiles {
		if t.Err == nil {
			placed = append(placed, sim.Pos{X: t.X, Y: t.Y})
		}
	}
	return w, placed
}

// RoadPath returns the free tiles of the shortest road from the island's
// road network (or, without roads, from the tiles next to its Trading
// Post) to a tile next to the footprint at (x, y) of w x h; empty when the
// footprint already touches a road. ok is false when no road can reach it.
func (p *Planner) RoadPath(island string, x, y, w, h int) ([]sim.Pos, bool) {
	is := p.W.Island(island)
	inRect := func(px, py int) bool { return px >= x && px < x+w && py >= y && py < y+h }
	n := is.Width * is.Height
	prev := make([]int, n)
	for i := range prev {
		prev[i] = -2 // unvisited
	}
	var queue []int
	for i := range n {
		px, py := i%is.Width, i/is.Width
		if is.RoadAt(px, py) != "" {
			prev[i] = -1
			queue = append(queue, i)
		}
	}
	v := p.View(is)
	freeAt := func(px, py int) bool { return !inRect(px, py) && v.RoadFree(px, py) }
	if len(queue) == 0 {
		if tp := p.TradingPost(island); tp != nil {
			tw, th := Dims(p.C.BuildingByID[tp.Type], tp.Rotation)
			for _, q := range Ring(tp.X, tp.Y, tw, th) {
				if freeAt(q.X, q.Y) {
					i := q.Y*is.Width + q.X
					if prev[i] == -2 {
						prev[i] = -1
						queue = append(queue, i)
					}
				}
			}
		}
	}
	target := func(i int) bool {
		px, py := i%is.Width, i/is.Width
		for _, d := range [4][2]int{{0, -1}, {1, 0}, {0, 1}, {-1, 0}} {
			if inRect(px+d[0], py+d[1]) {
				return true
			}
		}
		return false
	}
	for k := 0; k < len(queue); k++ {
		i := queue[k]
		if target(i) {
			var path []sim.Pos
			for j := i; j >= 0; j = prev[j] {
				px, py := j%is.Width, j/is.Width
				if is.RoadAt(px, py) == "" {
					path = append(path, sim.Pos{X: px, Y: py})
				}
			}
			slices.Reverse(path)
			return path, true
		}
		px, py := i%is.Width, i/is.Width
		for _, d := range [4][2]int{{0, -1}, {1, 0}, {0, 1}, {-1, 0}} {
			run := v.step(px, py, d, freeAt)
			if len(run) == 0 || slices.ContainsFunc(run, func(j int) bool { return prev[j] != -2 }) {
				continue
			}
			for k, j := range run {
				prev[j] = i
				if k > 0 {
					prev[j] = run[k-1]
				}
			}
			queue = append(queue, run[len(run)-1])
		}
	}
	return nil, false
}

// Reachable marks the tiles a road from the island's network (or, without
// roads, from next to its Trading Post) can reach: road tiles and free
// tiles connected to them by land or straight bridges.
func (p *Planner) Reachable(island string) []bool {
	is := p.W.Island(island)
	v := p.View(is)
	out := make([]bool, is.Width*is.Height)
	var queue []int
	for i := range out {
		if is.RoadAt(i%is.Width, i/is.Width) != "" {
			out[i] = true
			queue = append(queue, i)
		}
	}
	if len(queue) == 0 {
		if tp := p.TradingPost(island); tp != nil {
			tw, th := Dims(p.C.BuildingByID[tp.Type], tp.Rotation)
			for _, q := range Ring(tp.X, tp.Y, tw, th) {
				if v.RoadFree(q.X, q.Y) && !out[q.Y*is.Width+q.X] {
					out[q.Y*is.Width+q.X] = true
					queue = append(queue, q.Y*is.Width+q.X)
				}
			}
		}
	}
	for k := 0; k < len(queue); k++ {
		px, py := queue[k]%is.Width, queue[k]/is.Width
		for _, d := range [4][2]int{{0, -1}, {1, 0}, {0, 1}, {-1, 0}} {
			run := v.step(px, py, d, v.RoadFree)
			if len(run) == 0 || out[run[len(run)-1]] {
				continue
			}
			out[run[len(run)-1]] = true // bridge tiles stay unmarked
			queue = append(queue, run[len(run)-1])
		}
	}
	return out
}

// RoadDistances returns, per tile, the number of new road tiles a road
// from the island's network (or, without roads, from next to its Trading
// Post) needs to reach and include it, as RoadPath lays them: 0 on road
// tiles, -1 where no road reaches (bridge tiles stay -1).
func (p *Planner) RoadDistances(island string) []int {
	is := p.W.Island(island)
	v := p.View(is)
	dist := make([]int, is.Width*is.Height)
	for i := range dist {
		dist[i] = -1
	}
	var queue []int
	for i := range dist {
		if is.RoadAt(i%is.Width, i/is.Width) != "" {
			dist[i] = 0
			queue = append(queue, i)
		}
	}
	if len(queue) == 0 {
		if tp := p.TradingPost(island); tp != nil {
			tw, th := Dims(p.C.BuildingByID[tp.Type], tp.Rotation)
			for _, q := range Ring(tp.X, tp.Y, tw, th) {
				if v.RoadFree(q.X, q.Y) && dist[q.Y*is.Width+q.X] < 0 {
					dist[q.Y*is.Width+q.X] = 1
					queue = append(queue, q.Y*is.Width+q.X)
				}
			}
		}
	}
	// Runs cost their length, so the queue is ordered by a bucket per
	// distance (a bridge run is at most three tiles).
	for k := 0; k < len(queue); k++ {
		i := queue[k]
		px, py := i%is.Width, i/is.Width
		for _, d := range [4][2]int{{0, -1}, {1, 0}, {0, 1}, {-1, 0}} {
			run := v.step(px, py, d, v.RoadFree)
			if len(run) == 0 {
				continue
			}
			end := run[len(run)-1]
			nd := dist[i] + len(run)
			if is.RoadAt(end%is.Width, end/is.Width) != "" || (dist[end] >= 0 && dist[end] <= nd) {
				continue
			}
			dist[end] = nd
			queue = append(queue, end)
		}
	}
	return dist
}

// Touches reports whether a tile next to the footprint is reachable.
func Touches(is *sim.Island, reach []bool, x, y, w, h int) bool {
	for _, q := range Ring(x, y, w, h) {
		if is.InBounds(q.X, q.Y) && reach[q.Y*is.Width+q.X] {
			return true
		}
	}
	return false
}

// Ring returns the tiles 4-adjacent to a footprint, outside it.
func Ring(x, y, w, h int) []sim.Pos {
	var out []sim.Pos
	for tx := x; tx < x+w; tx++ {
		out = append(out, sim.Pos{X: tx, Y: y - 1}, sim.Pos{X: tx, Y: y + h})
	}
	for ty := y; ty < y+h; ty++ {
		out = append(out, sim.Pos{X: x - 1, Y: ty}, sim.Pos{X: x + w, Y: ty})
	}
	return out
}
