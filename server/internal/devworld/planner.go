package devworld

import (
	"fmt"

	"github.com/ricoberger/new-shores/server/internal/content"
	"github.com/ricoberger/new-shores/server/internal/layout"
	"github.com/ricoberger/new-shores/server/internal/sim"
	"github.com/ricoberger/new-shores/server/internal/sim/archipelago"
)

// The fixture planner finds sites on generated islands: the roomiest
// Trading Post site, a street inland from it, and building sites near an
// anchor that a dirt road can connect to the network (laid with them).

const fixtureRoad = "road_dirt"

// lp returns the layout planner over the fixture's world.
func (f *fixture) lp() *layout.Planner {
	return &layout.Planner{C: f.c, W: f.w, SpareForest: f.spareForest}
}

func (f *fixture) tradingPostSite(island string) (archipelago.Rect, bool) {
	return f.lp().TradingPostSite(island)
}

func (f *fixture) tradingPost(island string) *sim.Building { return f.lp().TradingPost(island) }

func (f *fixture) tradingPostCentre(island string) sim.Pos { return f.lp().TradingPostCentre(island) }

// street lays a straight dirt road of up to n tiles from behind the
// island's Trading Post inland and remembers the town centre: the grass
// area nearest to its end.
func (f *fixture) street(island string, n int) {
	if f.err != nil {
		return
	}
	if f.tradingPost(island) == nil {
		f.err = fmt.Errorf("street: no trading post on %s", island)
		return
	}
	tiles := f.lp().StreetTiles(island, n)
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

func (f *fixture) grassAnchor(island string, from sim.Pos) sim.Pos {
	return f.lp().GrassAnchor(island, from)
}

func (f *fixture) fieldAnchor(island string, from sim.Pos, farm *content.Building) sim.Pos {
	return f.lp().FieldAnchor(island, from, farm)
}

func (f *fixture) forestAnchor(island string, from sim.Pos) sim.Pos {
	return f.lp().ForestAnchor(island, from)
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
	for _, s := range layout.Candidates(is, def, anchor) {
		w, h := layout.Dims(def, s.Rot)
		if !layout.Touches(is, reach, s.X, s.Y, w, h) || (f.spareForest && layout.CoversForest(is, s.X, s.Y, w, h)) || !chk.Valid(def, s.X, s.Y, s.Rot) {
			continue
		}
		if tried++; tried > layout.MaxCandidates {
			break
		}
		path, ok := f.roadPath(island, s.X, s.Y, w, h)
		backup := f.w
		if !ok || !f.try(sim.PlaceBuilding{IslandID: island, Type: typ, X: s.X, Y: s.Y, Rotation: s.Rot}) {
			continue
		}
		if len(path) > 0 && !f.try(sim.PlaceRoad{IslandID: island, Type: fixtureRoad, Tiles: path}) {
			f.w = backup
			continue
		}
		b := f.w.Island(island).BuildingAt(f.c, s.X, s.Y)
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
	for _, s := range layout.Candidates(is, def, from) {
		w, h := layout.Dims(def, s.Rot)
		if (s.X == from.X && s.Y == from.Y) || !layout.Touches(is, reach, s.X, s.Y, w, h) {
			continue
		}
		if tried++; tried > layout.MaxCandidates {
			break
		}
		path, ok := f.roadPath(island, s.X, s.Y, w, h)
		if !ok || !f.try(sim.MoveBuilding{IslandID: island, BuildingID: id, X: s.X, Y: s.Y, Rotation: s.Rot}) {
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
	w, placed := f.lp().FieldDrag(island, farmID, typ, nil)
	return w, len(placed)
}

func (f *fixture) roadPath(island string, x, y, w, h int) ([]sim.Pos, bool) {
	return f.lp().RoadPath(island, x, y, w, h)
}

func (f *fixture) reachable(island string) []bool { return f.lp().Reachable(island) }
