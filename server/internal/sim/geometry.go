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

// WaterTile reports whether tile (tx, ty) lies in the water rows of a
// water-edge building (content water_tiles, D-051) placed at (x, y) with
// the given rotation. The water rows are the front rows: at rotation 0 the
// top rows (smallest y), at 90 the rightmost columns, at 180 the bottom
// rows and at 270 the leftmost columns. False for other buildings.
func WaterTile(def *content.Building, x, y, rotation, tx, ty int) bool {
	n := def.WaterTiles
	if n <= 0 {
		return false
	}
	w, h := footprint(def, rotation)
	switch rotation {
	case 90:
		return tx >= x+w-n
	case 180:
		return ty >= y+h-n
	case 270:
		return tx < x+n
	}
	return ty < y+n
}

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
// Occupancy returns the ID of the building covering each tile (row-major,
// 0 for none): one snapshot for scans over many tiles, where BuildingAt
// would rebuild it per tile.
func (is *Island) Occupancy(c *content.Catalogue) []int64 { return is.occupancy(c) }

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

// recomputeEfficiency resets the efficiency of every building without
// fields to full and updates the active fields and efficiency of every farm
// with fields (D-051).
func recomputeEfficiency(is *Island, c *content.Catalogue) {
	for _, b := range is.Buildings {
		def := c.BuildingByID[b.Type]
		switch {
		case def == nil, def.Fields != nil:
			// Farms with fields: assignFields below.
		default:
			b.Efficiency = 1000
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
