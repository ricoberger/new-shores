package sim

import (
	"github.com/ricoberger/new-shores/server/internal/content"
)

// Geometry rules (refining MECHANICS §2, D-042):
//
//   - A building at (X, Y) with rotation r occupies the rectangle
//     [X, X+W) x [Y, Y+H), where (W, H) is the content footprint for r = 0 or
//     180 and the swapped footprint for r = 90 or 270. Rotation has no other
//     effect.
//   - A building is road-adjacent when a road lies on any tile 4-adjacent
//     to any footprint tile (footprint tiles never carry a road); no
//     particular tile or side of the footprint is special.

// footprint returns the rotated footprint size.
func footprint(def *content.Building, rotation int) (int, int) {
	if rotation == 90 || rotation == 270 {
		return def.Height, def.Width
	}
	return def.Width, def.Height
}

func validRotation(r int) bool { return r == 0 || r == 90 || r == 180 || r == 270 }

// neighbours returns the offsets of the four 4-adjacent tiles.
func neighbours() [4]Pos { return [4]Pos{{0, -1}, {1, 0}, {0, 1}, {-1, 0}} }

// adjacentRoads returns the in-bounds road tiles 4-adjacent to the
// footprint [x, x+w) x [y, y+h), in row-major order without duplicates.
func (is *Island) adjacentRoads(x, y, w, h int) []Pos {
	var out []Pos
	add := func(px, py int) {
		if is.RoadAt(px, py) != "" {
			out = append(out, Pos{px, py})
		}
	}
	for tx := x; tx < x+w; tx++ {
		add(tx, y-1)
	}
	for ty := y; ty < y+h; ty++ {
		add(x-1, ty)
		add(x+w, ty)
	}
	for tx := x; tx < x+w; tx++ {
		add(tx, y+h)
	}
	return out
}

// buildingRoads returns the road tiles adjacent to a building's footprint.
func (is *Island) buildingRoads(def *content.Building, b *Building) []Pos {
	w, h := footprint(def, b.Rotation)
	return is.adjacentRoads(b.X, b.Y, w, h)
}

// occupancy maps each tile index to the ID of the building covering it.
func (is *Island) occupancy(c *content.Catalogue) []int64 {
	occ := make([]int64, is.Width*is.Height)
	for _, b := range is.Buildings {
		def := c.BuildingByID[b.Type]
		if def == nil {
			continue
		}
		w, h := footprint(def, b.Rotation)
		for y := b.Y; y < b.Y+h; y++ {
			for x := b.X; x < b.X+w; x++ {
				if is.InBounds(x, y) {
					occ[is.index(x, y)] = b.ID
				}
			}
		}
	}
	return occ
}

// buildableTerrain reports whether buildings and roads may be placed on the
// terrain.
func buildableTerrain(t string) bool {
	return t == content.TerrainCoast || t == content.TerrainGrass || t == content.TerrainForest
}

// workAreaEfficiency computes the per-mille efficiency of a work-area
// building placed at (x, y):
//
//	efficiency = min(1, matching / required_tiles)
//
// A tile is in the work area when its centre lies within the Euclidean
// radius of the footprint centre, i.e. (2tx+1-(2x+W))^2 + (2ty+1-(2y+H))^2
// <= (2r)^2 in exact integer arithmetic. It matches when its terrain is in
// the work area's terrain list and it carries neither a building (including
// the building itself) nor a road.
func workAreaEfficiency(is *Island, occ []int64, def *content.Building, x, y, rotation int) int64 {
	wa := def.WorkArea
	if wa.RequiredTiles < 1 {
		return 0
	}
	w, h := footprint(def, rotation)
	matching := 0
	for ty := y - wa.Radius - h; ty <= y+h+wa.Radius; ty++ {
		for tx := x - wa.Radius - w; tx <= x+w+wa.Radius; tx++ {
			if !is.InBounds(tx, ty) || !inRadius(x, y, w, h, wa.Radius, tx, ty) {
				continue
			}
			if tx >= x && tx < x+w && ty >= y && ty < y+h {
				continue // own footprint
			}
			i := is.index(tx, ty)
			if occ[i] != 0 || is.Roads[i] != "" {
				continue
			}
			if wa.MatchesTerrain(is.Tiles[i].Terrain) {
				matching++
			}
		}
	}
	eff := int64(matching) * 1000 / int64(wa.RequiredTiles)
	return min(eff, 1000)
}

// recomputeEfficiency updates the efficiency of every work-area building on
// the island (MECHANICS §2: recomputed when neighbouring tiles change) and
// the field assignment and efficiency of every farm with fields (D-049).
func recomputeEfficiency(is *Island, c *content.Catalogue) {
	occ := is.occupancy(c)
	for _, b := range is.Buildings {
		def := c.BuildingByID[b.Type]
		switch {
		case def == nil, def.Fields != nil:
			// Farms with fields: assignFields below.
		case def.WorkArea == nil:
			b.Efficiency = 1000
		default:
			b.Efficiency = workAreaEfficiency(is, occ, def, b.X, b.Y, b.Rotation)
		}
	}
	assignFields(is, c)
}

// BuildingAt returns the building whose footprint covers (x, y), or nil.
func (is *Island) BuildingAt(c *content.Catalogue, x, y int) *Building {
	if !is.InBounds(x, y) {
		return nil
	}
	id := is.occupancy(c)[is.index(x, y)]
	if id == 0 {
		return nil
	}
	return is.Building(id)
}
