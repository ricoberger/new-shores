package sim

import (
	"fmt"
	"maps"

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
//   - Neither placing quay tiles nor moving a berth holder onto them may
//     leave the island's harbour point without a way out to the open
//     sea (ErrHarbourBlocked).

// ShallowsReach is the distance (tiles, Chebyshev) from the island's own
// land within which water is shallow.
const ShallowsReach = 3

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
	return def.Coastal || def.WaterRows != nil
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
		if occ[i] != 0 || is.Roads[i] != "" {
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
// islet or a road on the water (a quay, D-060).
func seaLand(is *Island, x, y int) bool {
	i := y*is.Width + x
	return is.Tiles[i].Terrain != content.TerrainWater || is.Roads[i] != ""
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
	for _, b := range is.Buildings {
		def := c.BuildingByID[b.Type]
		if b.Berths <= 0 || def == nil {
			continue
		}
		if !seaReachable(is, HarbourAt(is, def, b.X, b.Y, b.Rotation)) {
			return false
		}
	}
	return true
}

// seaReachable reports whether ships reach the point p (archipelago
// tiles) from the edge of the island's grid (harbourRoutable).
func seaReachable(is *Island, p Pos) bool {
	x, y := p.X-is.X, p.Y-is.Y
	if !is.InBounds(x, y) {
		return true
	}
	if seaLand(is, x, y) {
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
			if i := is.index(nx, ny); !seen[i] && !seaLand(is, nx, ny) {
				seen[i] = true
				queue = append(queue, Pos{nx, ny})
			}
		}
	}
	return false
}

// checkHarbourAfter rejects placing or moving a berth holder (at; the
// moved building's ID, or -1 for a new one: a Trading Post or a trading
// pier) when a harbour point of the island would be closed off by quays
// afterwards (D-060, harbourRoutable). Only a site on quay tiles can
// close off another berth holder; the new site's own harbour point is
// always checked.
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
	if !onQuay {
		if seaReachable(is, HarbourAt(is, def, at.X, at.Y, at.Rotation)) {
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
