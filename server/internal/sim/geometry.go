package sim

import (
	"github.com/ricoberger/new-shores/server/internal/content"
)

// Geometry rules (refining MECHANICS §2):
//
//   - A building at (X, Y) with rotation r occupies the rectangle
//     [X, X+W) x [Y, Y+H), where (W, H) is the content footprint for r = 0 or
//     180 and the swapped footprint for r = 90 or 270.
//   - The entrance tile is the middle tile of the front edge; the front faces
//     south (+y) at 0, west (-x) at 90, north (-y) at 180 and east (+x) at
//     270. "Middle" rounds towards the lower coordinate at 0/90 and towards
//     the higher coordinate at 180/270, so that rotating by 180 degrees
//     mirrors the entrance.
//   - A road "touches" the entrance when it is on one of the four tiles
//     4-adjacent to the entrance tile (necessarily outside the footprint).

// footprint returns the rotated footprint size.
func footprint(def *content.Building, rotation int) (int, int) {
	if rotation == 90 || rotation == 270 {
		return def.Height, def.Width
	}
	return def.Width, def.Height
}

func validRotation(r int) bool { return r == 0 || r == 90 || r == 180 || r == 270 }

// entrance returns the entrance tile of a building placed at (x, y).
func entrance(def *content.Building, x, y, rotation int) Pos {
	w, h := footprint(def, rotation)
	switch rotation {
	case 90:
		return Pos{X: x, Y: y + (h-1)/2}
	case 180:
		return Pos{X: x + w - 1 - (w-1)/2, Y: y}
	case 270:
		return Pos{X: x + w - 1, Y: y + h - 1 - (h-1)/2}
	default:
		return Pos{X: x + (w-1)/2, Y: y + h - 1}
	}
}

// neighbours returns the offsets of the four 4-adjacent tiles.
func neighbours() [4]Pos { return [4]Pos{{0, -1}, {1, 0}, {0, 1}, {-1, 0}} }

// roadsAt returns the in-bounds road tiles 4-adjacent to p.
func (is *Island) roadsAt(p Pos) []Pos {
	var out []Pos
	for _, d := range neighbours() {
		q := Pos{p.X + d.X, p.Y + d.Y}
		if is.RoadAt(q.X, q.Y) != "" {
			out = append(out, q)
		}
	}
	return out
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
	w, h := footprint(def, rotation)
	cx2, cy2 := 2*x+w, 2*y+h
	r2 := 4 * wa.Radius * wa.Radius
	matching := 0
	for ty := y - wa.Radius - h; ty <= y+h+wa.Radius; ty++ {
		for tx := x - wa.Radius - w; tx <= x+w+wa.Radius; tx++ {
			if !is.InBounds(tx, ty) {
				continue
			}
			dx, dy := 2*tx+1-cx2, 2*ty+1-cy2
			if dx*dx+dy*dy > r2 {
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
// the island (MECHANICS §2: recomputed when neighbouring tiles change).
func recomputeEfficiency(is *Island, c *content.Catalogue) {
	occ := is.occupancy(c)
	for _, b := range is.Buildings {
		def := c.BuildingByID[b.Type]
		if def == nil {
			continue
		}
		if def.WorkArea == nil {
			b.Efficiency = 1000
			continue
		}
		b.Efficiency = workAreaEfficiency(is, occ, def, b.X, b.Y, b.Rotation)
	}
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
