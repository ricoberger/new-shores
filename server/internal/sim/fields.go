package sim

import (
	"fmt"
	"slices"
	"strings"

	"github.com/ricoberger/new-shores/server/internal/content"
)

// Fields of farms (D-049, replaced by D-051 part 4: adjacency chains):
//
//   - A field is a building whose content definition has a field block:
//     a 1x1 crop tile or a 2x2 animal field. It occupies its footprint
//     like any building, has no upkeep, no recipe and no road
//     connection, and is never paused. Its content cost is charged on
//     placement; demolition refunds like any building (D-019).
//   - A field belongs to exactly one farm instance, the one it was placed
//     from (Building.FarmID, set at placement, never derived). The farm's
//     building type is the field's field.farm; a farm has exactly one
//     field type, so fields of another farm type or another farm instance
//     never chain.
//   - A field is placed only with PlaceField (the farm panel's "Add
//     field"), never free-standing (PlaceBuilding of a field fails with
//     ErrFieldNeedsFarm). The footprint must be on the island, on the
//     field's terrain, free of buildings and roads, on an island with the
//     field's fertility, and 8-adjacent (edges or corners touch) to the
//     farm's footprint or to the footprint of one of the farm's active
//     fields (ErrFieldNotAdjacent). A farm owns at most fields.max fields,
//     active or not (ErrFieldMaxReached).
//   - Active fields are computed per farm by a flood fill from the farm's
//     footprint: a field is active when it is 8-adjacent to the farm or
//     to an active field of the same farm. The chain never passes through
//     an inactive or foreign field. A field whose chain is broken (the
//     farm moved, an intermediate field demolished) is inactive: it
//     stays, counts nothing and shows StatusNotAdjacent.
//   - A farm's efficiency is min(1000, active x 1000 / fields.required)
//     per mille (0 without active fields).
//   - Moving a farm keeps its fields; a field itself cannot be moved
//     (demolish and place it again). Demolishing a farm demolishes its
//     fields, each with the refund of its own cost.
//
// The assignment is recomputed in full after every placement change of
// the island (afterChange).

// StatusNotAdjacent is the status of an inactive field: its chain to the
// farm is broken.
const StatusNotAdjacent = "not_adjacent"

// PlaceField places one field of the field building Type from the farm
// FarmID at (X, Y) (the top-left tile of the rotated footprint).
type PlaceField struct {
	IslandID string
	FarmID   int64
	Type     string
	X, Y     int
	Rotation int
}

func (PlaceField) isCommand() {}

// rectsTouch reports whether the non-overlapping rectangles a and b are
// 8-adjacent: they share an edge segment or a corner.
func rectsTouch(ax, ay, aw, ah, bx, by, bw, bh int) bool {
	return ax <= bx+bw && bx <= ax+aw && ay <= by+bh && by <= ay+ah
}

// farmFieldsOf returns the fields owned by the farm, in ascending ID.
func farmFieldsOf(is *Island, c *content.Catalogue, farmID int64) []*Building {
	var out []*Building
	for _, b := range is.Buildings {
		if b.FarmID != farmID {
			continue
		}
		if def := c.BuildingByID[b.Type]; def != nil && def.Field != nil {
			out = append(out, b)
		}
	}
	return out
}

// activeFields returns the IDs of the farm's active fields: the flood fill
// of the fields rule from the farm's footprint.
func activeFields(is *Island, c *content.Catalogue, farm *Building, fields []*Building) map[int64]bool {
	active := map[int64]bool{}
	fdef := c.BuildingByID[farm.Type]
	if fdef == nil || fdef.Fields == nil {
		return active
	}
	type rect struct{ x, y, w, h int }
	fw, fh := footprint(fdef, farm.Rotation)
	reached := []rect{{farm.X, farm.Y, fw, fh}}
	for grown := true; grown; {
		grown = false
		for _, f := range fields {
			def := c.BuildingByID[f.Type]
			if active[f.ID] || def == nil || def.Field == nil || def.Field.Type != fdef.Fields.Type {
				continue
			}
			w, h := footprint(def, f.Rotation)
			for _, r := range reached {
				if rectsTouch(r.x, r.y, r.w, r.h, f.X, f.Y, w, h) {
					active[f.ID] = true
					reached = append(reached, rect{f.X, f.Y, w, h})
					grown = true
					break
				}
			}
		}
	}
	return active
}

// assignFields recomputes which fields are inactive and the efficiency of
// every farm on the island (fields rule above).
func assignFields(is *Island, c *content.Catalogue) {
	inactive := map[int64]bool{}
	for _, b := range is.Buildings {
		if def := c.BuildingByID[b.Type]; def != nil && def.Field != nil {
			inactive[b.ID] = true
		}
	}
	for _, b := range is.Buildings {
		def := c.BuildingByID[b.Type]
		if def == nil || def.Fields == nil {
			continue
		}
		active := activeFields(is, c, b, farmFieldsOf(is, c, b.ID))
		for id := range active {
			delete(inactive, id)
		}
		b.Efficiency = fieldEfficiency(len(active), def.Fields.Required)
	}
	for _, b := range is.Buildings {
		b.Inactive = inactive[b.ID]
	}
}

// fieldEfficiency is min(1000, active x 1000 / required) per mille.
func fieldEfficiency(active, required int) int64 {
	if required < 1 {
		return 0
	}
	return min(int64(active)*1000/int64(required), 1000)
}

// FieldSummary is the field count of a farm.
type FieldSummary struct {
	// IDs are the farm's fields (active or not) in ascending ID.
	IDs    []int64
	Active int
}

// farmFieldSummaries counts the fields of every farm on the island.
func farmFieldSummaries(is *Island, c *content.Catalogue) map[int64]*FieldSummary {
	out := map[int64]*FieldSummary{}
	for _, b := range is.Buildings {
		def := c.BuildingByID[b.Type]
		if def == nil || def.Field == nil {
			continue
		}
		s := out[b.FarmID]
		if s == nil {
			s = &FieldSummary{}
			out[b.FarmID] = s
		}
		s.IDs = append(s.IDs, b.ID)
		if !b.Inactive {
			s.Active++
		}
	}
	return out
}

// CheckFieldSite validates a field of the field building def at (x, y)
// (rotation r) from the farm: the field rule without tier, settlement and
// cost checks, in this order: the farm type matches def.Field.Farm
// (ErrFieldWrongFarm), the farm has fewer than fields.max fields
// (ErrFieldMaxReached), the footprint is on the island, on the field's
// terrain and free (ErrOutOfBounds, ErrTerrain, ErrOccupied), the island
// has the fertility (ErrNoFertility) and the footprint is 8-adjacent to
// the farm or one of its active fields (ErrFieldNotAdjacent). It is the
// check behind PlaceField and the scenario runner's rectangle helper; the
// client mirrors it for the ghost as a hint.
func CheckFieldSite(is *Island, c *content.Catalogue, farm *Building, def *content.Building, x, y, rotation int) error {
	fdef := c.BuildingByID[farm.Type]
	if def == nil || def.Field == nil {
		return fmt.Errorf("%w: not a field", ErrFieldTypeMismatch)
	}
	if fdef == nil || fdef.Fields == nil || def.Field.Farm != farm.Type || fdef.Fields.Type != def.Field.Type {
		return fmt.Errorf("%w: %s belongs to %s, not %s %d", ErrFieldWrongFarm, def.ID, def.Field.Farm, farm.Type, farm.ID)
	}
	fields := farmFieldsOf(is, c, farm.ID)
	if len(fields) >= fdef.Fields.Max {
		return fmt.Errorf("%w: %s %d has %d of %d fields", ErrFieldMaxReached, farm.Type, farm.ID, len(fields), fdef.Fields.Max)
	}
	w, h := footprint(def, rotation)
	if x < 0 || y < 0 || x > is.Width-w || y > is.Height-h {
		return fmt.Errorf("%w: %s footprint at (%d,%d)", ErrOutOfBounds, def.ID, x, y)
	}
	occ := is.occupancy(c)
	for ty := y; ty < y+h; ty++ {
		for tx := x; tx < x+w; tx++ {
			i := is.index(tx, ty)
			if t := is.Tiles[i].Terrain; !def.Field.MatchesTerrain(t) {
				return fmt.Errorf("%w: %s at (%d,%d) cannot stand on %s", ErrTerrain, def.ID, tx, ty, t)
			}
			if occ[i] != 0 || is.Roads[i] != "" {
				return fmt.Errorf("%w: (%d,%d)", ErrOccupied, tx, ty)
			}
		}
	}
	if err := checkFertility(is, def.ID, def.Field.Fertility); err != nil {
		return err
	}
	fw, fh := footprint(fdef, farm.Rotation)
	if rectsTouch(farm.X, farm.Y, fw, fh, x, y, w, h) {
		return nil
	}
	active := activeFields(is, c, farm, fields)
	for _, f := range fields {
		if !active[f.ID] {
			continue
		}
		if fd := c.BuildingByID[f.Type]; fd != nil {
			ow, oh := footprint(fd, f.Rotation)
			if rectsTouch(f.X, f.Y, ow, oh, x, y, w, h) {
				return nil
			}
		}
	}
	return fmt.Errorf("%w: %s at (%d,%d) touches neither %s %d nor one of its active fields", ErrFieldNotAdjacent, def.ID, x, y, farm.Type, farm.ID)
}

// checkFertility fails with ErrNoFertility when tag is set and the island
// lacks it.
func checkFertility(is *Island, id, tag string) error {
	if tag == "" || slices.Contains(is.Fertilities, tag) {
		return nil
	}
	have := "none"
	if len(is.Fertilities) > 0 {
		have = strings.Join(is.Fertilities, ", ")
	}
	return fmt.Errorf("%w: %s needs %s (island %q has %s)", ErrNoFertility, id, tag, is.ID, have)
}

// PlaceFieldFree places a field without tier, settlement and cost checks
// (world creation and seeding only, like PlaceFree).
func PlaceFieldFree(w *World, c *content.Catalogue, cmd PlaceField, l *Ledger) error {
	return placeField(w, c, cmd, false, l)
}

func placeField(w *World, c *content.Catalogue, cmd PlaceField, charge bool, l *Ledger) error {
	is, err := lookupIsland(w, cmd.IslandID)
	if err != nil {
		return err
	}
	def := c.BuildingByID[cmd.Type]
	if def == nil {
		return fmt.Errorf("%w: %q", ErrUnknownBuilding, cmd.Type)
	}
	if def.Field == nil {
		return fmt.Errorf("%w: %q is not a field", ErrFieldTypeMismatch, cmd.Type)
	}
	farm := is.Building(cmd.FarmID)
	if farm == nil {
		return fmt.Errorf("%w: farm %d on island %q", ErrBuildingNotFound, cmd.FarmID, cmd.IslandID)
	}
	if !validRotation(cmd.Rotation) {
		return fmt.Errorf("%w: rotation %d", ErrInvalidCommand, cmd.Rotation)
	}
	if charge && !TierUnlocked(w, c, def.Tier) {
		return fmt.Errorf("%w: %s needs tier %s", ErrTierLocked, def.ID, def.Tier)
	}
	if charge && !settled(is, c) {
		return fmt.Errorf("%w: %q", ErrIslandNotSettled, is.ID)
	}
	if err := CheckFieldSite(is, c, farm, def, cmd.X, cmd.Y, cmd.Rotation); err != nil {
		return err
	}
	if charge {
		if err := checkCost(w, is, def.Cost, 1); err != nil {
			return err
		}
	}

	// Validation complete: mutate.
	if charge {
		chargeCost(w, is, def.Cost, 1, l)
	}
	if w.NextBuildingID < 1 {
		w.NextBuildingID = 1
	}
	is.Buildings = append(is.Buildings, &Building{ID: w.NextBuildingID, Type: def.ID, X: cmd.X, Y: cmd.Y, Rotation: cmd.Rotation, Efficiency: 1000, FarmID: farm.ID})
	w.NextBuildingID++
	afterChange(is, c)
	return nil
}
