package sim

import (
	"fmt"
	"slices"

	"github.com/ricoberger/new-shores/server/internal/content"
)

// Harbour lanes (D-078 §1, MECHANICS §2–§3):
//
//   - Every berth holder (content `harbour_lane`: the Trading Post, trading
//     piers, depots, the shipyard, the repair crane, the Kontor), built or
//     planned, owns a lane in front of its water edge: the footprint's
//     width plus one tile on each side, laneDepth rows deep (rows 1 to
//     laneDepth before the front row, rotation-aware like water rows).
//     Every tile of that rectangle on the island counts, land or water.
//   - Neither a quay tile, nor a footprint tile of a shore building, nor a
//     paint-family tile may lie on another building's lane
//     (ErrHarbourLane).
//   - Symmetrically, a berth holder may not be placed or moved so that its
//     lane covers a quay (built or planned), a shore building or a paint
//     tile (built or planned).
//   - A building never blocks itself: a moved holder ignores its old lane
//     and its own old footprint.
//   - The D-077 §8 open-harbour check and the harbour point / berth
//     keep-out of shore buildings (shoreKeepOut) stay in addition.

// laneDepth is the depth (rows) of a harbour lane (D-078 §1).
const laneDepth = 4

// laneTiles returns the harbour lane of a berth holder def at (x, y)
// with the rotation (island tiles, in bounds only), nil when def holds
// no lane.
func laneTiles(is *Island, def *content.Building, x, y, rotation int) []Pos {
	if !def.HarbourLane {
		return nil
	}
	out := make([]Pos, 0, (def.Width+2)*laneDepth)
	for row := 1; row <= laneDepth; row++ {
		for column := -1; column <= def.Width; column++ {
			p := waterPosition(def, x, y, rotation, column, -row)
			if is.InBounds(p.X, p.Y) {
				out = append(out, p)
			}
		}
	}
	return out
}

// LaneTiles is laneTiles for the API and the display (the selected berth
// holder's lane outline).
func LaneTiles(is *Island, def *content.Building, x, y, rotation int) []Pos {
	return laneTiles(is, def, x, y, rotation)
}

// harbourLanes marks the lane tiles of the island's berth holders, built
// and planned, except the building or plan skip (row-major; nil when the
// island has no lane).
func harbourLanes(is *Island, c *content.Catalogue, skip int64) []bool {
	var m []bool
	for _, b := range slices.Concat(is.Buildings, is.Plans) {
		def := c.BuildingByID[b.Type]
		if b.ID == skip || def == nil || !def.HarbourLane {
			continue
		}
		if m == nil {
			m = make([]bool, is.Width*is.Height)
		}
		for _, p := range laneTiles(is, def, b.X, b.Y, b.Rotation) {
			m[is.index(p.X, p.Y)] = true
		}
	}
	return m
}

// laneBound reports whether a building of def is kept off harbour lanes:
// a shore building or a paint family (quays: checkQuayLane).
func laneBound(def *content.Building) bool {
	return def.Shore() || def.PaintFamily != nil
}

// checkHarbourLane validates a building site against the harbour lanes
// (D-078 §1): a shore building or a paint tile stays off the lanes of the
// other berth holders, and a berth holder's own lane covers no quay,
// shore building or paint tile. self is the ID of the moved building or
// plan (0 for a new one); it never blocks itself.
func checkHarbourLane(is *Island, c *content.Catalogue, def *content.Building, x, y, rotation int, self int64) error {
	if laneBound(def) {
		if lanes := harbourLanes(is, c, self); lanes != nil {
			fw, fh := footprint(def, rotation)
			for ty := y; ty < y+fh; ty++ {
				for tx := x; tx < x+fw; tx++ {
					if is.InBounds(tx, ty) && lanes[is.index(tx, ty)] {
						return fmt.Errorf("%w: %s at (%d,%d) covers the harbour lane at (%d,%d)", ErrHarbourLane, def.ID, x, y, tx, ty)
					}
				}
			}
		}
	}
	lane := laneTiles(is, def, x, y, rotation)
	if len(lane) == 0 {
		return nil
	}
	bound := make([]bool, is.Width*is.Height)
	for _, b := range slices.Concat(is.Buildings, is.Plans) {
		bd := c.BuildingByID[b.Type]
		if b.ID == self || bd == nil || !laneBound(bd) {
			continue
		}
		w, h := footprint(bd, b.Rotation)
		for ty := b.Y; ty < b.Y+h; ty++ {
			for tx := b.X; tx < b.X+w; tx++ {
				if is.InBounds(tx, ty) {
					bound[is.index(tx, ty)] = true
				}
			}
		}
	}
	for _, p := range lane {
		i := is.index(p.X, p.Y)
		quay := (is.Roads[i] != "" && isQuay(c, is.Roads[i])) || (is.PlannedRoads[i] != "" && isQuay(c, is.PlannedRoads[i]))
		if quay || bound[i] {
			return fmt.Errorf("%w: the lane of %s at (%d,%d) would cover (%d,%d)", ErrHarbourLane, def.ID, x, y, p.X, p.Y)
		}
	}
	return nil
}

// checkQuayLane rejects quay tiles on a harbour lane (D-078 §1).
func checkQuayLane(is *Island, c *content.Catalogue, tiles []Pos) error {
	lanes := harbourLanes(is, c, 0)
	if lanes == nil {
		return nil
	}
	for _, p := range tiles {
		if lanes[is.index(p.X, p.Y)] {
			return fmt.Errorf("%w: a quay at (%d,%d) would lie on a harbour lane", ErrHarbourLane, p.X, p.Y)
		}
	}
	return nil
}
