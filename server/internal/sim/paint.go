package sim

import (
	"fmt"

	"github.com/ricoberger/new-shores/server/internal/content"
)

// Paint families (D-077 §2–§3, MECHANICS §3): a paint family is a 1×1
// building (hedge, garden wall, city wall, square) painted tile by tile
// with the road tools. Every tile is its own building (cost per tile,
// the usual demolition refund); the client joins neighbouring tiles of
// one family. A road-crossing family (the city wall) shares its tile
// with a road, and a gate (the gatehouse) stands between two such tiles
// and lets a road through its centre line. Nothing else reads them.

// PlacePaint paints tiles of a paint family: each tile gets one building
// (or a plan with Planned, D-071), checked like a 1×1 placement. It is a
// batch command: the per-tile results name the refused tiles; the valid
// tiles are placed (charged together; a tile the gold or materials no
// longer cover is refused).
type PlacePaint struct {
	IslandID string
	Type     string
	Tiles    []Pos
	Planned  bool
}

// DemolishPaint removes the paint-family buildings and plans on the
// tiles (a batch command; a tile without one is refused). A building is
// demolished like Demolish, a plan for free; roads under city walls stay.
type DemolishPaint struct {
	IslandID string
	Tiles    []Pos
}

func (PlacePaint) isCommand()    {}
func (DemolishPaint) isCommand() {}

func placePaint(w *World, c *content.Catalogue, cmd PlacePaint, l *Ledger) ([]TileResult, error) {
	is, err := lookupIsland(w, cmd.IslandID)
	if err != nil {
		return nil, err
	}
	def := c.BuildingByID[cmd.Type]
	if def == nil {
		return nil, fmt.Errorf("%w: %q", ErrUnknownBuilding, cmd.Type)
	}
	if def.PaintFamily == nil {
		return nil, fmt.Errorf("%w: %q is not a paint family", ErrInvalidCommand, cmd.Type)
	}
	// A plan may be of a locked tier (D-071 §2); building it checks.
	if !cmd.Planned && !TierUnlocked(w, c, def.Tier) {
		return nil, fmt.Errorf("%w: %s needs tier %s", ErrTierLocked, def.ID, def.Tier)
	}
	if !settled(is, c) {
		return nil, fmt.Errorf("%w: %q", ErrIslandNotSettled, is.ID)
	}
	if err := checkBatchTiles(cmd.Tiles); err != nil {
		return nil, err
	}
	occ := is.occupancy(c)
	results := make([]TileResult, len(cmd.Tiles))
	var order []Pos
	for i, p := range cmd.Tiles {
		err := checkSite(is, c, occ, def, p.X, p.Y, 0)
		if err == nil {
			err = checkHarbourLane(is, c, def, p.X, p.Y, 0, 0)
		}
		if err == nil && !cmd.Planned {
			err = checkCost(w, is, def.Cost, int64(len(order)+1))
		}
		results[i] = TileResult{X: p.X, Y: p.Y, Err: err}
		if err != nil {
			continue
		}
		occ[is.index(p.X, p.Y)] = -1
		order = append(order, p)
	}
	if len(order) == 0 {
		return results, nil // no valid tile: no state change
	}

	// Validation complete: mutate.
	if cmd.Planned {
		for _, p := range order {
			addPlan(w, is, &Building{Type: def.ID, X: p.X, Y: p.Y})
		}
		return results, nil
	}
	chargeCost(w, is, def.Cost, int64(len(order)), l)
	if w.NextBuildingID < 1 {
		w.NextBuildingID = 1
	}
	for _, p := range order {
		is.Buildings = append(is.Buildings, &Building{ID: w.NextBuildingID, Type: def.ID, X: p.X, Y: p.Y, Efficiency: 1000})
		w.NextBuildingID++
	}
	afterChange(is, c)
	return results, nil
}

func demolishPaint(w *World, c *content.Catalogue, cmd DemolishPaint, l *Ledger) ([]TileResult, error) {
	is, err := lookupIsland(w, cmd.IslandID)
	if err != nil {
		return nil, err
	}
	if err := checkBatchTiles(cmd.Tiles); err != nil {
		return nil, err
	}
	occ := is.occupancy(c)
	results := make([]TileResult, len(cmd.Tiles))
	var ids []int64
	for i, p := range cmd.Tiles {
		results[i] = TileResult{X: p.X, Y: p.Y}
		if !is.InBounds(p.X, p.Y) {
			results[i].Err = fmt.Errorf("%w: (%d,%d)", ErrOutOfBounds, p.X, p.Y)
			continue
		}
		id := occ[is.index(p.X, p.Y)]
		b := is.Building(id)
		if b == nil {
			b = is.Plan(id)
		}
		if def := paintDef(c, b); def == nil {
			results[i].Err = fmt.Errorf("%w: no paint family at (%d,%d)", ErrBuildingNotFound, p.X, p.Y)
			continue
		}
		ids = append(ids, id)
	}
	for _, id := range ids {
		if is.Plan(id) != nil {
			demolishPlan(is, c, id)
			continue
		}
		if err := demolish(w, c, Demolish{IslandID: is.ID, BuildingID: id}, l); err != nil {
			return nil, err
		}
	}
	return results, nil
}

// paintDef returns the content of a paint-family building, or nil.
func paintDef(c *content.Catalogue, b *Building) *content.Building {
	if b == nil {
		return nil
	}
	if def := c.BuildingByID[b.Type]; def != nil && def.PaintFamily != nil {
		return def
	}
	return nil
}

// roadCrossing reports whether a road may share tile (tx, ty) of a
// building of def at (x, y) with the rotation: every tile of a
// road-crossing paint family (the city wall's arch) and the centre line of
// a gate along its passage (north–south at 0 and 180, east–west at 90 and
// 270).
func roadCrossing(def *content.Building, x, y, rotation, tx, ty int) bool {
	if def.PaintFamily != nil && def.PaintFamily.RoadCrossing {
		return true
	}
	if !def.Gate {
		return false
	}
	w, h := footprint(def, rotation)
	if rotation == 90 || rotation == 270 {
		return ty == y+h/2
	}
	return tx == x+w/2
}

// roadOccupancy is the occupancy for road placement: tiles a road may
// share with their building (roadCrossing) count as free.
func (is *Island) roadOccupancy(c *content.Catalogue) []int64 {
	occ := is.occupancy(c)
	for _, b := range append(is.Buildings[:len(is.Buildings):len(is.Buildings)], is.Plans...) {
		def := c.BuildingByID[b.Type]
		if def == nil || (def.PaintFamily == nil && !def.Gate) {
			continue
		}
		w, h := footprint(def, b.Rotation)
		for ty := b.Y; ty < b.Y+h; ty++ {
			for tx := b.X; tx < b.X+w; tx++ {
				if is.InBounds(tx, ty) && roadCrossing(def, b.X, b.Y, b.Rotation, tx, ty) {
					occ[is.index(tx, ty)] = 0
				}
			}
		}
	}
	return occ
}

// gateWallTiles returns the two tiles a gate of def at (x, y) needs a
// road-crossing paint family on: beside the middle of the two sides its
// passage does not cross.
func gateWallTiles(def *content.Building, x, y, rotation int) [2]Pos {
	w, h := footprint(def, rotation)
	if rotation == 90 || rotation == 270 {
		return [2]Pos{{X: x + w/2, Y: y - 1}, {X: x + w/2, Y: y + h}}
	}
	return [2]Pos{{X: x - 1, Y: y + h/2}, {X: x + w, Y: y + h/2}}
}

// checkGateWalls validates a gate site (D-077 §3): a road-crossing paint
// family (built or planned) stands on both gateWallTiles.
func checkGateWalls(is *Island, c *content.Catalogue, occ []int64, def *content.Building, x, y, rotation int) error {
	for _, p := range gateWallTiles(def, x, y, rotation) {
		ok := false
		if is.InBounds(p.X, p.Y) {
			id := occ[is.index(p.X, p.Y)]
			b := is.Building(id)
			if b == nil {
				b = is.Plan(id)
			}
			if pd := paintDef(c, b); pd != nil && pd.PaintFamily.RoadCrossing {
				ok = true
			}
		}
		if !ok {
			return fmt.Errorf("%w: %s at (%d,%d) needs a wall at (%d,%d)", ErrGateNeedsWall, def.ID, x, y, p.X, p.Y)
		}
	}
	return nil
}
