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

// waterPosition maps a column and distance from the front row to an island
// tile. Columns run along the front; rotation changes only the water-facing
// side (0 north, 90 east, 180 south, 270 west).
func waterPosition(def *content.Building, x, y, rotation, column, row int) Pos {
	switch rotation {
	case 90:
		return Pos{x + def.Height - 1 - row, y + column}
	case 180:
		return Pos{x + column, y + def.Height - 1 - row}
	case 270:
		return Pos{x + row, y + column}
	default:
		return Pos{x + column, y + row}
	}
}

// waterDepths chooses the contiguous water prefix of each column, clamped to
// the content bounds. checkSite then rejects mismatches: too little water
// remains required water, too much (or water after land) becomes invalid land.
// Call only after footprint bounds validation. A quay terminates the prefix.
func waterDepths(is *Island, c *content.Catalogue, def *content.Building, x, y, rotation int) []int {
	if def.WaterRows == nil {
		return nil
	}
	depths := make([]int, def.Width)
	for column := range depths {
		k := 0
		for k < def.WaterRows.Max {
			p := waterPosition(def, x, y, rotation, column, k)
			i := is.index(p.X, p.Y)
			if is.Tiles[i].Terrain != content.TerrainWater || quayAt(is, c, i) {
				break
			}
			k++
		}
		depths[column] = max(k, def.WaterRows.Min)
	}
	return depths
}

// waterAt reports whether the tile belongs to its column's chosen prefix.
func waterAt(def *content.Building, depths []int, x, y, rotation, tx, ty int) bool {
	if depths == nil {
		return false
	}
	column, row := tx-x, ty-y
	switch rotation {
	case 90:
		column, row = ty-y, x+def.Height-1-tx
	case 180:
		row = y + def.Height - 1 - ty
	case 270:
		column, row = ty-y, tx-x
	}
	return row < depths[column]
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
