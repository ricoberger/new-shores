package sim

import (
	"fmt"

	"github.com/ricoberger/new-shores/server/internal/content"
)

// Shore placement (D-077 §5, MECHANICS §2): a building with
// `placement: shore` (trading pier, depot, shipyard, repair crane, harbour
// tower, harbour statue, Kontor) stands on the water's edge or out on the
// water against a quay.
//
//   - Every footprint tile is free sea water (shallows included; no river)
//     or free level-0 buildable land or a quay (replaced, no refund, as for
//     a water-edge building, D-060).
//   - At least one footprint tile is water (ErrShoreNeedsWater).
//   - The back edge — the side opposite the front: the bottom row at
//     rotation 0, the left column at 90, the top row at 180, the right
//     column at 270 — touches land or quay along its full length: for
//     each back-row tile, the tile itself or the tile behind it is the
//     island's own land or a quay (ErrShoreBackEdge).
//   - No footprint tile lies on the harbour lane or a berth tile of the
//     island's Trading Post or trading piers (shoreKeepOut,
//     ErrHarbourBlocked).
//   - For ships the footprint is land (shoreDecks): the sea grid, the
//     harbour points and the open-sea checks treat it like a quay.

// shoreBehind is the tile behind a footprint column (row = depth):
// waterPosition is linear in its column and row, so it extends past the
// footprint (rows < 0 lie in front of it).
func shoreBehind(def *content.Building, x, y, rotation, column int) Pos {
	return waterPosition(def, x, y, rotation, column, def.Height)
}

// checkShoreSite validates a shore site (after the bounds check of
// checkSite): tiles, water, back edge, keep-out. Quay tiles under the
// footprint are returned in quay (replaced on placement).
func checkShoreSite(is *Island, c *content.Catalogue, occ []int64, def *content.Building, x, y, rotation int) error {
	fw, fh := footprint(def, rotation)
	water := 0
	for ty := y; ty < y+fh; ty++ {
		for tx := x; tx < x+fw; tx++ {
			i := is.index(tx, ty)
			t := is.Tiles[i].Terrain
			switch {
			case occ[i] != 0 || is.PlannedRoads[i] != "":
				return fmt.Errorf("%w: (%d,%d)", ErrOccupied, tx, ty)
			case quayAt(is, c, i):
				// A quay counts as land and is replaced (D-060).
			case is.Roads[i] != "":
				return fmt.Errorf("%w: (%d,%d)", ErrOccupied, tx, ty)
			case t == content.TerrainWater:
				water++
			case !buildableTerrain(t):
				return fmt.Errorf("%w: (%d,%d) is %s", ErrTerrain, tx, ty, t)
			}
		}
	}
	// Low shore (D-075 §1): the land part stands at terrace level 0.
	for ty := y; ty < y+fh; ty++ {
		for tx := x; tx < x+fw; tx++ {
			i := is.index(tx, ty)
			if t := is.Tiles[i].Terrain; t != content.TerrainWater && is.Tiles[i].Level != 0 {
				return fmt.Errorf("%w: %s at (%d,%d): land tile (%d,%d) is at level %d", ErrNeedsLowShore, def.ID, x, y, tx, ty, is.Tiles[i].Level)
			}
		}
	}
	if water == 0 {
		return fmt.Errorf("%w: %s at (%d,%d)", ErrShoreNeedsWater, def.ID, x, y)
	}
	shoreLand := func(p Pos) bool {
		if !is.InBounds(p.X, p.Y) {
			return false
		}
		i := is.index(p.X, p.Y)
		return ownLand(is.Tiles[i].Terrain) || quayAt(is, c, i)
	}
	for column := range def.Width {
		back := waterPosition(def, x, y, rotation, column, def.Height-1)
		if !shoreLand(back) && !shoreLand(shoreBehind(def, x, y, rotation, column)) {
			return fmt.Errorf("%w: %s at (%d,%d): back edge at (%d,%d) is open water", ErrShoreBackEdge, def.ID, x, y, back.X, back.Y)
		}
	}
	keep := shoreKeepOut(is, c)
	for ty := y; ty < y+fh; ty++ {
		for tx := x; tx < x+fw; tx++ {
			if keep[Pos{tx, ty}] {
				return fmt.Errorf("%w: %s at (%d,%d) covers the harbour lane or a berth at (%d,%d)", ErrHarbourBlocked, def.ID, x, y, tx, ty)
			}
		}
	}
	return nil
}

// shoreLane is the depth (tiles) of the harbour lane in front of a berth
// holder: up to and one beyond its harbour point (harbourOffset).
const shoreLane = harbourOffset + 1

// shoreKeepOut returns the water tiles (island tiles) a shore building
// must leave free (D-077 §5): for every berth holder of the island (the
// Trading Post and the trading piers), its harbour lane — the strip in
// front of its front edge, the footprint's width, shoreLane tiles deep — and its harbour point (HarbourAt); for a
// trading pier also its berth tiles, the two flank columns beside its
// whole depth. Only water tiles count.
func shoreKeepOut(is *Island, c *content.Catalogue) map[Pos]bool {
	out := map[Pos]bool{}
	add := func(p Pos) {
		if is.InBounds(p.X, p.Y) && is.Tile(p.X, p.Y).Terrain == content.TerrainWater {
			out[p] = true
		}
	}
	for _, b := range is.Buildings {
		def := c.BuildingByID[b.Type]
		if def == nil || (def.TradingPost == nil && def.Pier == nil) {
			continue
		}
		for column := range def.Width {
			for row := 1; row <= shoreLane; row++ {
				add(waterPosition(def, b.X, b.Y, b.Rotation, column, -row))
			}
		}
		if def.Pier != nil {
			for row := range def.Height {
				add(waterPosition(def, b.X, b.Y, b.Rotation, -1, row))
				add(waterPosition(def, b.X, b.Y, b.Rotation, def.Width, row))
			}
		}
		h := HarbourAt(c, is, def, b.X, b.Y, b.Rotation)
		add(Pos{h.X - is.X, h.Y - is.Y})
	}
	return out
}

// shoreDecks marks the footprint tiles of the island's shore buildings
// (row-major): land for ships (D-077 §5). Nil when there is none (or no
// catalogue).
func shoreDecks(c *content.Catalogue, is *Island) []bool {
	if c == nil {
		return nil
	}
	var m []bool
	for _, b := range is.Buildings {
		def := c.BuildingByID[b.Type]
		if def == nil || !def.Shore() {
			continue
		}
		if m == nil {
			m = make([]bool, is.Width*is.Height)
		}
		w, h := footprint(def, b.Rotation)
		for ty := b.Y; ty < b.Y+h; ty++ {
			for tx := b.X; tx < b.X+w; tx++ {
				if is.InBounds(tx, ty) {
					m[is.index(tx, ty)] = true
				}
			}
		}
	}
	return m
}
