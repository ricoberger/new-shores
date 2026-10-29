package devworld

import (
	"fmt"
	"slices"

	"github.com/ricoberger/new-shores/server/internal/content"
	"github.com/ricoberger/new-shores/server/internal/sim"
	"github.com/ricoberger/new-shores/server/internal/sim/archipelago"
)

// The fixture planner finds sites on generated islands: the roomiest
// Trading Post site, a street inland from it, and building sites near an
// anchor that a dirt road can connect to the network (laid with them).

const fixtureRoad = "road_dirt"

// maxCandidates bounds the sites tried per placement (nearest first).
const maxCandidates = 600

func rotations() []int { return []int{0, 90, 180, 270} }

func dims(def *content.Building, rot int) (int, int) {
	if rot == 90 || rot == 270 {
		return def.Height, def.Width
	}
	return def.Width, def.Height
}

// view is a snapshot of an island's occupancy for the planner's tile
// scans; the island must not change while it is used.
type view struct {
	f   *fixture
	is  *sim.Island
	occ []int64
}

func (f *fixture) view(is *sim.Island) *view {
	return &view{f: f, is: is, occ: is.Occupancy(f.c)}
}

// open reports whether a tile is buildable land without a building or road.
func (v *view) open(x, y int) bool {
	is := v.is
	if !is.InBounds(x, y) || is.RoadAt(x, y) != "" || v.occ[y*is.Width+x] != 0 {
		return false
	}
	t := is.Tile(x, y).Terrain
	return t == content.TerrainCoast || t == content.TerrainGrass || t == content.TerrainForest
}

// free is open, minus forest while the planner spares it (lumberjacks
// lose efficiency with every forest tile built over).
func (v *view) free(x, y int) bool {
	return v.open(x, y) && (!v.f.spareForest || v.is.Tile(x, y).Terrain != content.TerrainForest)
}

// passable reports whether a road may run over a tile: free land or a
// river tile without a road or building (a bridge, D-058 part 3).
func (v *view) passable(x, y int) bool {
	is := v.is
	if v.free(x, y) {
		return true
	}
	return is.InBounds(x, y) && is.Tile(x, y).Terrain == content.TerrainRiver && is.RoadAt(x, y) == "" && v.occ[y*is.Width+x] == 0
}

// coversForest reports whether a footprint covers a forest tile.
func coversForest(is *sim.Island, x, y, w, h int) bool {
	for ty := y; ty < y+h; ty++ {
		for tx := x; tx < x+w; tx++ {
			if is.Tile(tx, ty).Terrain == content.TerrainForest {
				return true
			}
		}
	}
	return false
}

// tradingPostSite returns the island's Trading Post site with the most
// free land within ten tiles behind it (the first on ties).
func (f *fixture) tradingPostSite(island string) (archipelago.Rect, bool) {
	is := f.w.Island(island)
	def := archipelago.TradingPost(f.c)
	if is == nil || def == nil {
		return archipelago.Rect{}, false
	}
	best, bestScore := archipelago.Rect{}, -1
	v := f.view(is)
	for _, s := range archipelago.Sites(is, f.c, def) {
		cx, cy := s.X+s.W/2, s.Y+s.H/2
		dx, dy := inland(s.Rotation)
		cx, cy = cx+dx*6, cy+dy*6
		score := 0
		for y := cy - 6; y <= cy+6; y++ {
			for x := cx - 6; x <= cx+6; x++ {
				if v.free(x, y) {
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

// inland is the direction from a water-edge building's water rows to its
// land rows (rotation 0: water at the top).
func inland(rot int) (int, int) {
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

// tradingPost returns the island's Trading Post.
func (f *fixture) tradingPost(island string) *sim.Building {
	is := f.w.Island(island)
	if is == nil {
		return nil
	}
	for _, b := range is.Buildings {
		if def := f.c.BuildingByID[b.Type]; def != nil && def.TradingPost != nil {
			return b
		}
	}
	return nil
}

func (f *fixture) tradingPostCentre(island string) sim.Pos {
	b := f.tradingPost(island)
	if b == nil {
		return sim.Pos{}
	}
	w, h := dims(f.c.BuildingByID[b.Type], b.Rotation)
	return sim.Pos{X: b.X + w/2, Y: b.Y + h/2}
}

// street lays a straight dirt road of up to n tiles from behind the
// island's Trading Post inland and remembers the town centre: the grass
// area nearest to its end.
func (f *fixture) street(island string, n int) {
	if f.err != nil {
		return
	}
	tp := f.tradingPost(island)
	if tp == nil {
		f.err = fmt.Errorf("street: no trading post on %s", island)
		return
	}
	is := f.w.Island(island)
	w, h := dims(f.c.BuildingByID[tp.Type], tp.Rotation)
	dx, dy := inland(tp.Rotation)
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
	v := f.view(is)
	for len(tiles) < n && v.free(x, y) {
		tiles = append(tiles, sim.Pos{X: x, Y: y})
		x, y = x+dx, y+dy
	}
	if len(tiles) < 3 {
		f.err = fmt.Errorf("street: only %d free tiles behind the trading post of %s", len(tiles), island)
		return
	}
	f.apply(sim.PlaceRoad{IslandID: island, Type: fixtureRoad, Tiles: tiles})
	if f.ends == nil {
		f.ends = map[string]sim.Pos{}
	}
	f.ends[island] = f.grassAnchor(island, tiles[len(tiles)-1])
}

// streetEnd returns the island's town centre.
func (f *fixture) streetEnd(island string) sim.Pos { return f.ends[island] }

// grassAnchor returns the tile nearest to from whose surroundings
// (Chebyshev radius 4) hold at least 50 free grass or coast tiles: the
// centre of a town that spares the forest; from itself when there is
// none.
func (f *fixture) grassAnchor(island string, from sim.Pos) sim.Pos {
	return f.openAnchor(island, from, 4, 50)
}

// fieldAnchor is grassAnchor for a farm's required fields: the nearest
// tile whose surroundings hold room for them (river-cut and forested
// D-058 islands have no such room next to every street).
func (f *fixture) fieldAnchor(island string, from sim.Pos, farm *content.Building) sim.Pos {
	n := 0
	if farm.Fields != nil {
		if field := f.c.FieldByType[farm.Fields.Type]; field != nil {
			n = farm.Fields.Required * field.Width * field.Height
		}
	}
	r := 4
	for (2*r+1)*(2*r+1) < n*3/2 {
		r++
	}
	return f.openAnchor(island, from, r, n*5/4)
}

// openAnchor returns the tile nearest to from whose surroundings
// (Chebyshev radius r) hold at least n open tiles that are not forest;
// from itself when there is none.
func (f *fixture) openAnchor(island string, from sim.Pos, r, n int) sim.Pos {
	is := f.w.Island(island)
	v := f.view(is)
	w, h := is.Width, is.Height
	sat := make([]int, (w+1)*(h+1))
	for y := range h {
		for x := range w {
			c := 0
			if v.open(x, y) && is.Tile(x, y).Terrain != content.TerrainForest {
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

// forestAnchor returns the tile nearest to from whose surroundings
// (Chebyshev radius 4) hold at least 30 free forest tiles, where a
// lumberjack works at full efficiency; from itself when there is none.
func (f *fixture) forestAnchor(island string, from sim.Pos) sim.Pos {
	is := f.w.Island(island)
	v := f.view(is)
	best, bestD := from, -1
	for y := range is.Height {
		for x := range is.Width {
			n := 0
			for ty := y - 4; ty <= y+4; ty++ {
				for tx := x - 4; tx <= x+4; tx++ {
					if is.InBounds(tx, ty) && is.Tile(tx, ty).Terrain == content.TerrainForest && v.open(tx, ty) {
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

type site struct{ x, y, rot, d int }

// candidates lists the anchors and rotations of a building on the island
// by distance of the footprint centre from anchor.
func (f *fixture) candidates(is *sim.Island, def *content.Building, anchor sim.Pos) []site {
	var out []site
	rots := rotations()
	if def.Width == def.Height && def.WaterTiles == 0 {
		rots = rots[:1] // the rotations of a square footprint cover the same tiles
	}
	for _, rot := range rots {
		w, h := dims(def, rot)
		for y := 0; y+h <= is.Height; y++ {
			for x := 0; x+w <= is.Width; x++ {
				dx, dy := 2*x+w-2*anchor.X-1, 2*y+h-2*anchor.Y-1
				out = append(out, site{x, y, rot, dx*dx + dy*dy})
			}
		}
	}
	slices.SortStableFunc(out, func(a, b site) int { return a.d - b.d })
	return out
}

// placeNear places a building at the valid site nearest to anchor that a
// road can connect, lays that road and returns the building's ID.
func (f *fixture) placeNear(island, typ string, anchor sim.Pos) int64 {
	return f.placeNearThen(island, typ, anchor, nil)
}

// placeNearThen is placeNear where a site only counts when then (if set)
// succeeds on the world with the building placed; a failed then is
// rolled back and the next site is tried. Sites and roads off the forest
// come first; only when there is none may they cover forest.
func (f *fixture) placeNearThen(island, typ string, anchor sim.Pos, then func(id int64) bool) int64 {
	if f.err != nil {
		return 0
	}
	f.spareForest = true
	id := f.placeOnce(island, typ, anchor, then)
	f.spareForest = false
	if f.err != nil {
		f.err = nil
		id = f.placeOnce(island, typ, anchor, then)
	}
	return id
}

func (f *fixture) placeOnce(island, typ string, anchor sim.Pos, then func(id int64) bool) int64 {
	def := f.c.BuildingByID[typ]
	is := f.w.Island(island)
	if def == nil || is == nil {
		f.err = fmt.Errorf("place %s on %s: unknown", typ, island)
		return 0
	}
	tried := 0
	reach := f.reachable(island)
	// is stays the island before any trial: try works on a world copy.
	chk := sim.NewSiteChecker(is, f.c)
	for _, s := range f.candidates(is, def, anchor) {
		w, h := dims(def, s.rot)
		if !touches(is, reach, s.x, s.y, w, h) || (f.spareForest && coversForest(is, s.x, s.y, w, h)) || !chk.Valid(def, s.x, s.y, s.rot) {
			continue
		}
		if tried++; tried > maxCandidates {
			break
		}
		path, ok := f.roadPath(island, s.x, s.y, w, h)
		backup := f.w
		if !ok || !f.try(sim.PlaceBuilding{IslandID: island, Type: typ, X: s.x, Y: s.y, Rotation: s.rot}) {
			continue
		}
		if len(path) > 0 && !f.try(sim.PlaceRoad{IslandID: island, Type: fixtureRoad, Tiles: path}) {
			f.w = backup
			continue
		}
		b := f.w.Island(island).BuildingAt(f.c, s.x, s.y)
		if b == nil {
			f.w = backup
			continue
		}
		if then != nil && !then(b.ID) {
			f.w, f.err = backup, nil
			continue
		}
		return b.ID
	}
	f.err = fmt.Errorf("no connected site for %s on %s near (%d,%d)", typ, island, anchor.X, anchor.Y)
	return 0
}

// moveOnce moves the island's newest building of the type to the nearest
// other site a road can connect.
func (f *fixture) moveOnce(island, typ string) {
	if f.err != nil {
		return
	}
	is := f.w.Island(island)
	var b *sim.Building
	for _, x := range is.Buildings {
		if x.Type == typ {
			b = x
		}
	}
	if b == nil {
		f.err = fmt.Errorf("move: no %s on %s", typ, island)
		return
	}
	def := f.c.BuildingByID[typ]
	id, from := b.ID, sim.Pos{X: b.X, Y: b.Y}
	tried := 0
	reach := f.reachable(island)
	for _, s := range f.candidates(is, def, from) {
		w, h := dims(def, s.rot)
		if (s.x == from.X && s.y == from.Y) || !touches(is, reach, s.x, s.y, w, h) {
			continue
		}
		if tried++; tried > maxCandidates {
			break
		}
		path, ok := f.roadPath(island, s.x, s.y, w, h)
		if !ok || !f.try(sim.MoveBuilding{IslandID: island, BuildingID: id, X: s.x, Y: s.y, Rotation: s.rot}) {
			continue
		}
		if len(path) > 0 && !f.try(sim.PlaceRoad{IslandID: island, Type: fixtureRoad, Tiles: path}) {
			continue
		}
		return
	}
	f.err = fmt.Errorf("move: no site for %s on %s", typ, island)
}

// paintFields paints the farm's fields with one place_fields drag (D-054)
// over the largest square ring around the farm that fits MaxFieldTiles,
// nearest anchors first, and reports whether n fields were placed (the
// world keeps them; a drag that places fewer leaves no trace).
func (f *fixture) paintFields(island string, farmID int64, typ string, n int) bool {
	w, placed := f.fieldDrag(island, farmID, typ)
	if w == nil || placed != n {
		return false
	}
	f.w = w
	return true
}

// fieldDrag applies paintFields' drag to a copy of the world and returns
// the copy and the number of fields placed (nil when the drag fails).
func (f *fixture) fieldDrag(island string, farmID int64, typ string) (*sim.World, int) {
	if f.err != nil {
		return nil, 0
	}
	is := f.w.Island(island)
	farm := is.Building(farmID)
	if farm == nil {
		return nil, 0
	}
	fw, fh := dims(f.c.BuildingByID[farm.Type], farm.Rotation)
	r := 1
	for (fw+2*(r+1))*(fh+2*(r+1)) <= sim.MaxFieldTiles {
		r++
	}
	cx, cy := 2*farm.X+fw, 2*farm.Y+fh // doubled centre
	var tiles []sim.Pos
	for y := farm.Y - r; y < farm.Y+fh+r; y++ {
		for x := farm.X - r; x < farm.X+fw+r; x++ {
			if is.InBounds(x, y) && (x < farm.X || x >= farm.X+fw || y < farm.Y || y >= farm.Y+fh) {
				tiles = append(tiles, sim.Pos{X: x, Y: y})
			}
		}
	}
	dist := func(p sim.Pos) int {
		dx, dy := 2*p.X+1-cx, 2*p.Y+1-cy
		return dx*dx + dy*dy
	}
	slices.SortStableFunc(tiles, func(a, b sim.Pos) int { return dist(a) - dist(b) })
	w := f.w.Clone()
	res, err := sim.ApplyWithResult(w, f.c, sim.PlaceFields{IslandID: island, FarmID: farmID, Type: typ, Tiles: tiles}, nil)
	if err != nil {
		return nil, 0
	}
	placed := 0
	for _, t := range res.Tiles {
		if t.Err == nil {
			placed++
		}
	}
	return w, placed
}

// roadPath returns the free tiles of the shortest road from the island's
// road network (or, without roads, from the tiles next to its Trading
// Post) to a tile next to the footprint at (x, y) of w x h; empty when the
// footprint already touches a road. ok is false when no road can reach it.
func (f *fixture) roadPath(island string, x, y, w, h int) ([]sim.Pos, bool) {
	is := f.w.Island(island)
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
	v := f.view(is)
	freeAt := func(px, py int) bool { return !inRect(px, py) && v.passable(px, py) }
	if len(queue) == 0 {
		if tp := f.tradingPost(island); tp != nil {
			tw, th := dims(f.c.BuildingByID[tp.Type], tp.Rotation)
			for _, p := range ring(tp.X, tp.Y, tw, th) {
				if freeAt(p.X, p.Y) {
					i := p.Y*is.Width + p.X
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
			nx, ny := px+d[0], py+d[1]
			if !freeAt(nx, ny) {
				continue
			}
			j := ny*is.Width + nx
			if prev[j] == -2 {
				prev[j] = i
				queue = append(queue, j)
			}
		}
	}
	return nil, false
}

// reachable marks the tiles a road from the island's network (or, without
// roads, from next to its Trading Post) can reach: road tiles and free
// tiles connected to them.
func (f *fixture) reachable(island string) []bool {
	is := f.w.Island(island)
	v := f.view(is)
	out := make([]bool, is.Width*is.Height)
	var queue []int
	for i := range out {
		if is.RoadAt(i%is.Width, i/is.Width) != "" {
			out[i] = true
			queue = append(queue, i)
		}
	}
	if len(queue) == 0 {
		if tp := f.tradingPost(island); tp != nil {
			tw, th := dims(f.c.BuildingByID[tp.Type], tp.Rotation)
			for _, p := range ring(tp.X, tp.Y, tw, th) {
				if v.free(p.X, p.Y) && !out[p.Y*is.Width+p.X] {
					out[p.Y*is.Width+p.X] = true
					queue = append(queue, p.Y*is.Width+p.X)
				}
			}
		}
	}
	for k := 0; k < len(queue); k++ {
		px, py := queue[k]%is.Width, queue[k]/is.Width
		for _, d := range [4][2]int{{0, -1}, {1, 0}, {0, 1}, {-1, 0}} {
			nx, ny := px+d[0], py+d[1]
			if v.passable(nx, ny) && !out[ny*is.Width+nx] {
				out[ny*is.Width+nx] = true
				queue = append(queue, ny*is.Width+nx)
			}
		}
	}
	return out
}

// touches reports whether a tile next to the footprint is reachable.
func touches(is *sim.Island, reach []bool, x, y, w, h int) bool {
	for _, p := range ring(x, y, w, h) {
		if is.InBounds(p.X, p.Y) && reach[p.Y*is.Width+p.X] {
			return true
		}
	}
	return false
}

// ring returns the tiles 4-adjacent to a footprint, outside it.
func ring(x, y, w, h int) []sim.Pos {
	var out []sim.Pos
	for tx := x; tx < x+w; tx++ {
		out = append(out, sim.Pos{X: tx, Y: y - 1}, sim.Pos{X: tx, Y: y + h})
	}
	for ty := y; ty < y+h; ty++ {
		out = append(out, sim.Pos{X: x - 1, Y: ty}, sim.Pos{X: x + w, Y: ty})
	}
	return out
}
