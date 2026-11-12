package sim

import (
	"fmt"
	"maps"
	"slices"

	"github.com/ricoberger/new-shores/server/internal/content"
)

// Quays (D-060, MECHANICS §3): a road type on the island's shallow water.
//
//   - Shallows are the water tiles of the island's grid (not river) within
//     ShallowsReach tiles (Chebyshev) of the island's own land: a tile
//     that is neither water, river nor islet. Derived from the tiles; no
//     generator field.
//   - A quay tile stands on free shallows (no building footprint, water
//     rows included, and no road).
//   - It is a road for connectivity and carts (roads.go), coast for a
//     coastal or water-edge building, whose land rows may stand on it
//     (placing or moving the building there replaces the quay tiles), and
//     land for ship routing (searoute.go).
//   - Neither placing quay tiles nor placing or moving a berth holder or a
//     shore building may leave a harbour point of the island without a
//     way out to the open sea (ErrHarbourBlocked, D-077 §8).
//   - Quays are connected (D-077 §8): a placed quay tile reaches the
//     island's own land or a built building over edge-adjacent quay
//     tiles, built or planned (ErrQuayDisconnected); demolishing roads or
//     a building, or moving a building, may not cut a quay tile that
//     reached it off (ErrQuayWouldFloat).

// ShallowsReach is the distance (tiles, Chebyshev) from the island's own
// land within which water is shallow (D-077 §8: 8, was 3).
const ShallowsReach = 8

// ownLand reports whether a tile is the island's own land (not water,
// river or islet).
func ownLand(t string) bool {
	return t != content.TerrainWater && t != content.TerrainRiver && t != content.TerrainIslet
}

// Shallow reports whether the tile (island tiles) is shallow water.
func Shallow(is *Island, x, y int) bool {
	if !is.InBounds(x, y) || len(is.Tiles) != is.Width*is.Height || is.Tile(x, y).Terrain != content.TerrainWater {
		return false
	}
	for ty := max(y-ShallowsReach, 0); ty <= min(y+ShallowsReach, is.Height-1); ty++ {
		for tx := max(x-ShallowsReach, 0); tx <= min(x+ShallowsReach, is.Width-1); tx++ {
			if ownLand(is.Tile(tx, ty).Terrain) {
				return true
			}
		}
	}
	return false
}

// isQuay reports whether the road type is a quay.
func isQuay(c *content.Catalogue, roadType string) bool {
	def := c.BuildingByID[roadType]
	return def != nil && def.Road != nil && def.Road.Shallows
}

// quayAt reports whether the tile carries a quay.
func quayAt(is *Island, c *content.Catalogue, i int) bool {
	rt := is.Roads[i]
	return rt != "" && isQuay(c, rt)
}

// standsOnQuay reports whether a building may stand on quay tiles: a
// coastal or water-edge building (D-060).
func standsOnQuay(def *content.Building) bool {
	return def.Coastal || def.WaterRows != nil || def.Shore()
}

// checkQuayTiles validates the tiles of a quay placement: on the island,
// shallow and free.
func checkQuayTiles(is *Island, occ []int64, tiles []Pos) error {
	for _, p := range tiles {
		if !is.InBounds(p.X, p.Y) {
			return fmt.Errorf("%w: (%d,%d)", ErrOutOfBounds, p.X, p.Y)
		}
	}
	for _, p := range tiles {
		i := is.index(p.X, p.Y)
		if !Shallow(is, p.X, p.Y) {
			return fmt.Errorf("%w: (%d,%d) is %s, a quay needs shallow water (within %d tiles of the island's land)", ErrTerrain, p.X, p.Y, is.Tiles[i].Terrain, ShallowsReach)
		}
		if occ[i] != 0 || is.roadOrPlan(i) {
			return fmt.Errorf("%w: (%d,%d)", ErrOccupied, p.X, p.Y)
		}
	}
	return nil
}

// clearQuay removes the quay tiles under a building's footprint (its
// land rows; water rows never hold one).
func clearQuay(is *Island, c *content.Catalogue, def *content.Building, b *Building) {
	w, h := footprint(def, b.Rotation)
	for ty := b.Y; ty < b.Y+h; ty++ {
		for tx := b.X; tx < b.X+w; tx++ {
			if i := is.index(tx, ty); quayAt(is, c, i) {
				delete(is.Roads, i)
			}
		}
	}
}

// seaLand reports whether an island tile blocks ships: land, river,
// islet, a road on the water (a quay, D-060) or the footprint of a shore
// building (decks: shoreDecks, D-077 §5).
func seaLand(is *Island, decks []bool, x, y int) bool {
	i := y*is.Width + x
	return is.Tiles[i].Terrain != content.TerrainWater || is.Roads[i] != "" || (decks != nil && decks[i])
}

// harbourRoutable reports whether the harbour point (HarbourAt) of every
// berth holder of the island (the Trading Post and the trading piers,
// D-060) is water that ships reach from the open sea: a 4-connected way
// over the grid's water tiles that are not land for ships (seaLand) leads
// from it to the edge of the island's grid, beyond which lies open sea.
// True without berth holders and for a point off the grid.
func harbourRoutable(c *content.Catalogue, is *Island) bool {
	if len(is.Tiles) != is.Width*is.Height {
		return true
	}
	decks := shoreDecks(c, is)
	for _, b := range is.Buildings {
		def := c.BuildingByID[b.Type]
		if b.Berths <= 0 || def == nil {
			continue
		}
		if !seaReachable(is, decks, HarbourAt(c, is, def, b.X, b.Y, b.Rotation)) {
			return false
		}
	}
	return true
}

// seaReachable reports whether ships reach the point p (archipelago
// tiles) from the edge of the island's grid (harbourRoutable).
func seaReachable(is *Island, decks []bool, p Pos) bool {
	x, y := p.X-is.X, p.Y-is.Y
	if !is.InBounds(x, y) {
		return true
	}
	if seaLand(is, decks, x, y) {
		return false
	}
	seen := make([]bool, is.Width*is.Height)
	seen[is.index(x, y)] = true
	queue := []Pos{{x, y}}
	for len(queue) > 0 {
		q := queue[0]
		queue = queue[1:]
		for _, nb := range neighbours() {
			nx, ny := q.X+nb.X, q.Y+nb.Y
			if !is.InBounds(nx, ny) {
				return true
			}
			if i := is.index(nx, ny); !seen[i] && !seaLand(is, decks, nx, ny) {
				seen[i] = true
				queue = append(queue, Pos{nx, ny})
			}
		}
	}
	return false
}

// checkHarbourAfter rejects placing or moving a berth holder or a shore
// building (at; the moved building's ID, or -1 for a new one) when a
// harbour point of the island would be closed off afterwards (D-060,
// D-077 §8, harbourRoutable). For a berth holder off quay tiles only its
// own harbour point is checked (nothing else changes for ships); a shore
// building's footprint is land for ships, so every harbour point is.
func checkHarbourAfter(is *Island, c *content.Catalogue, def *content.Building, at *Building, replaces int64) error {
	onQuay := false
	fw, fh := footprint(def, at.Rotation)
	for ty := at.Y; ty < at.Y+fh; ty++ {
		for tx := at.X; tx < at.X+fw; tx++ {
			if quayAt(is, c, is.index(tx, ty)) {
				onQuay = true
			}
		}
	}
	if !onQuay && !def.Shore() {
		if seaReachable(is, shoreDecks(c, is), HarbourAt(c, is, def, at.X, at.Y, at.Rotation)) {
			return nil
		}
		return fmt.Errorf("%w: %s at (%d,%d) has no way out to the open sea", ErrHarbourBlocked, def.ID, at.X, at.Y)
	}
	tmp := *is
	tmp.Roads = maps.Clone(is.Roads)
	tmp.Buildings = make([]*Building, 0, len(is.Buildings)+1)
	for _, b := range is.Buildings {
		if b.ID == replaces {
			b = at
		}
		tmp.Buildings = append(tmp.Buildings, b)
	}
	if replaces < 0 {
		tmp.Buildings = append(tmp.Buildings, at)
	}
	clearQuay(&tmp, c, def, at)
	if !harbourRoutable(c, &tmp) {
		return fmt.Errorf("%w: %s at (%d,%d) has no way out to the open sea", ErrHarbourBlocked, def.ID, at.X, at.Y)
	}
	return nil
}

// quayAnchored returns the quay tiles (built in roads or planned in
// plans) that reach an anchor over edge-adjacent quay tiles: the island's
// own land or a tile in solid (the footprints of built buildings,
// buildingTiles). Anchors and the flood are 4-connected (D-077 §8).
func quayAnchored(is *Island, c *content.Catalogue, roads, plans map[int]string, solid []bool) map[int]bool {
	quay := func(i int) bool {
		return (roads[i] != "" && isQuay(c, roads[i])) || (plans[i] != "" && isQuay(c, plans[i]))
	}
	anchored := map[int]bool{}
	var queue []int
	seed := func(tiles map[int]string) {
		for i := range tiles {
			if anchored[i] || !quay(i) {
				continue
			}
			x, y := i%is.Width, i/is.Width
			for _, nb := range neighbours() {
				nx, ny := x+nb.X, y+nb.Y
				if !is.InBounds(nx, ny) {
					continue
				}
				j := is.index(nx, ny)
				if ownLand(is.Tiles[j].Terrain) || (solid != nil && solid[j]) {
					anchored[i] = true
					queue = append(queue, i)
					break
				}
			}
		}
	}
	seed(roads)
	seed(plans)
	for len(queue) > 0 {
		i := queue[0]
		queue = queue[1:]
		x, y := i%is.Width, i/is.Width
		for _, nb := range neighbours() {
			nx, ny := x+nb.X, y+nb.Y
			if !is.InBounds(nx, ny) {
				continue
			}
			if j := is.index(nx, ny); !anchored[j] && quay(j) {
				anchored[j] = true
				queue = append(queue, j)
			}
		}
	}
	return anchored
}

// buildingTiles marks the footprints of the island's built buildings,
// with plans: also its planned ones (D-071): solid ground a quay may be
// anchored to.
func buildingTiles(is *Island, c *content.Catalogue, plans bool) []bool {
	solid := make([]bool, is.Width*is.Height)
	all := is.Buildings
	if plans {
		all = slices.Concat(is.Buildings, is.Plans)
	}
	for _, b := range all {
		def := c.BuildingByID[b.Type]
		if def == nil {
			continue
		}
		w, h := footprint(def, b.Rotation)
		for y := b.Y; y < b.Y+h; y++ {
			for x := b.X; x < b.X+w; x++ {
				if is.InBounds(x, y) {
					solid[is.index(x, y)] = true
				}
			}
		}
	}
	return solid
}

// hasQuay reports whether the island has a built or planned quay tile.
func hasQuay(is *Island, c *content.Catalogue) bool {
	for _, tiles := range []map[int]string{is.Roads, is.PlannedRoads} {
		for _, rt := range tiles {
			if isQuay(c, rt) {
				return true
			}
		}
	}
	return false
}

// checkQuaysConnected rejects quay tiles of a placement that would not
// reach the island's land or a building over quay tiles
// (ErrQuayDisconnected): roads are the quay tiles that count with the
// placement, solid what the buildings anchor (buildingTiles). A built
// quay counts built quays and buildings, a planned one also plans (the
// plan view, D-071).
func checkQuaysConnected(is *Island, c *content.Catalogue, roads map[int]string, tiles []Pos) error {
	anchored := quayAnchored(is, c, roads, nil, buildingTiles(is, c, false))
	for _, p := range tiles {
		if !anchored[is.index(p.X, p.Y)] {
			return fmt.Errorf("%w: (%d,%d) touches neither land nor a quay connected to land", ErrQuayDisconnected, p.X, p.Y)
		}
	}
	return nil
}

// checkQuaysStay rejects a change after which a quay tile that reached the
// island's land or a building before no longer does (ErrQuayWouldFloat):
// built quays over built quays and buildings, planned ones over both
// built and planned (D-071). after is the island after the change, a copy
// with its own Roads, PlannedRoads, Buildings and Plans. Quays that
// floated before (placed before D-077) never block a change.
func checkQuaysStay(before, after *Island, c *content.Catalogue) error {
	if !hasQuay(before, c) {
		return nil
	}
	for _, plans := range []bool{false, true} {
		var pb, pa map[int]string
		if plans {
			pb, pa = before.PlannedRoads, after.PlannedRoads
		}
		was := quayAnchored(before, c, before.Roads, pb, buildingTiles(before, c, plans))
		now := quayAnchored(after, c, after.Roads, pa, buildingTiles(after, c, plans))
		for _, i := range slices.Sorted(maps.Keys(was)) {
			if now[i] {
				continue
			}
			if (after.Roads[i] != "" && isQuay(c, after.Roads[i])) || (pa[i] != "" && isQuay(c, pa[i])) {
				return fmt.Errorf("%w: the quay at (%d,%d) would touch neither land nor a quay connected to land", ErrQuayWouldFloat, i%before.Width, i/before.Width)
			}
		}
	}
	return nil
}
