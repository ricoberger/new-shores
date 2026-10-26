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
//   - A field is placed only with PlaceField (one tile) or PlaceFields (a
//     painted rectangle, D-054), never free-standing (PlaceBuilding of a field fails with
//     ErrFieldNeedsFarm). The footprint must be on the island, on the
//     field's terrain, free of buildings and roads, on an island with the
//     field's fertility, and 4-edge adjacent (they share an edge segment; a corner
//     alone does not count) to the
//     farm's footprint or to the footprint of one of the farm's active
//     fields (ErrFieldNotAdjacent). A farm owns at most fields.max fields,
//     active or not (ErrFieldMaxReached).
//   - Active fields are computed per farm by a flood fill from the farm's
//     footprint: a field is active when it is 4-edge adjacent to the farm or
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

// MaxFieldTiles bounds the tiles of one PlaceFields or DemolishFields
// command (a painted rectangle, D-054).
const MaxFieldTiles = 512

// PlaceFields places fields of the field building Type from the farm
// FarmID at every valid anchor of Tiles (top-left tile of each field
// footprint, all with Rotation), D-054: every tile is validated with the
// rules of PlaceField against the island plus the fields accepted before
// it (cost included, cumulatively); the passes over Tiles repeat while one
// accepts a tile, until the farm's fields.max. The valid tiles are placed
// in one state change. When no tile is valid the command still succeeds
// without a state change (Result.Unchanged; every tile carries its
// reason). Duplicate tiles or more than MaxFieldTiles fail the whole
// command.
type PlaceFields struct {
	IslandID string
	FarmID   int64
	Type     string
	Tiles    []Pos
	Rotation int
}

// DemolishFields demolishes the fields of the farm FarmID covering Tiles,
// each once, with the refund of its cost; a tile without a field of the
// farm is rejected (ErrBuildingNotFound). The valid tiles are applied in
// one state change. Like PlaceFields, when no tile is valid the command
// still succeeds without a state change (Result.Unchanged; every tile
// carries its reason): a demolish rectangle painted over no field is not
// an error. Duplicate tiles or more than MaxFieldTiles fail the whole
// command.
type DemolishFields struct {
	IslandID string
	FarmID   int64
	Tiles    []Pos
}

func (PlaceFields) isCommand()    {}
func (DemolishFields) isCommand() {}

// TileResult is the outcome of one tile of a batch command: Err is nil
// when the tile was applied, else the reason it was rejected.
type TileResult struct {
	X, Y int
	Err  error
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

// fieldGrid maps every tile of the island to 1 + the index in
// is.Buildings of the field covering it (0: no field).
func fieldGrid(is *Island, c *content.Catalogue) []int32 {
	grid := make([]int32, is.Width*is.Height)
	for k, b := range is.Buildings {
		def := c.BuildingByID[b.Type]
		if def == nil || def.Field == nil {
			continue
		}
		w, h := footprint(def, b.Rotation)
		for y := max(b.Y, 0); y < min(b.Y+h, is.Height); y++ {
			for x := max(b.X, 0); x < min(b.X+w, is.Width); x++ {
				grid[is.index(x, y)] = int32(k + 1) // #nosec G115 -- building count << 2^31
			}
		}
	}
	return grid
}

// forPerimeter calls fn with the index of every in-bounds tile 4-adjacent
// to the rectangle [x, x+w) x [y, y+h) (outside it).
func (is *Island) forPerimeter(x, y, w, h int, fn func(i int)) {
	for tx := x; tx < x+w; tx++ {
		if is.InBounds(tx, y-1) {
			fn(is.index(tx, y-1))
		}
		if is.InBounds(tx, y+h) {
			fn(is.index(tx, y+h))
		}
	}
	for ty := y; ty < y+h; ty++ {
		if is.InBounds(x-1, ty) {
			fn(is.index(x-1, ty))
		}
		if is.InBounds(x+w, ty) {
			fn(is.index(x+w, ty))
		}
	}
}

// activeFields returns the IDs of the farm's active fields: the flood fill
// of the fields rule from the farm's footprint over the farm's own fields
// of its field type (grid: fieldGrid of the island). Two non-overlapping
// rectangles share an edge segment exactly when a tile of one is
// 4-adjacent to a tile of the other, so the fill walks footprint
// perimeters.
func activeFields(is *Island, c *content.Catalogue, grid []int32, farm *Building) map[int64]bool {
	active := map[int64]bool{}
	fdef := c.BuildingByID[farm.Type]
	if fdef == nil || fdef.Fields == nil {
		return active
	}
	var queue []*Building
	visit := func(i int) {
		k := grid[i]
		if k == 0 {
			return
		}
		f := is.Buildings[k-1]
		if f.FarmID != farm.ID || active[f.ID] {
			return
		}
		if def := c.BuildingByID[f.Type]; def == nil || def.Field == nil || def.Field.Type != fdef.Fields.Type {
			return
		}
		active[f.ID] = true
		queue = append(queue, f)
	}
	fw, fh := footprint(fdef, farm.Rotation)
	is.forPerimeter(farm.X, farm.Y, fw, fh, visit)
	for len(queue) > 0 {
		f := queue[0]
		queue = queue[1:]
		w, h := footprint(c.BuildingByID[f.Type], f.Rotation)
		is.forPerimeter(f.X, f.Y, w, h, visit)
	}
	return active
}

// assignFields recomputes which fields are inactive and the efficiency of
// every farm on the island (fields rule above).
func assignFields(is *Island, c *content.Catalogue) {
	inactive := map[int64]bool{}
	hasFarm := false
	for _, b := range is.Buildings {
		def := c.BuildingByID[b.Type]
		switch {
		case def == nil:
		case def.Field != nil:
			inactive[b.ID] = true
		case def.Fields != nil:
			hasFarm = true
		}
	}
	var grid []int32
	if hasFarm && len(inactive) > 0 {
		grid = fieldGrid(is, c)
	}
	for _, b := range is.Buildings {
		def := c.BuildingByID[b.Type]
		if def == nil || def.Fields == nil {
			continue
		}
		active := 0
		if grid != nil {
			ids := activeFields(is, c, grid, b)
			for id := range ids {
				delete(inactive, id)
			}
			active = len(ids)
		}
		b.Efficiency = fieldEfficiency(active, def.Fields.Required)
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

// fieldSites validates field sites of one field building and one farm
// against the island plus the fields accepted so far (place_fields
// validates a batch tile by tile; each accepted field occupies its
// footprint and extends the farm's chain for the next tiles).
type fieldSites struct {
	is       *Island
	def      *content.Building
	farm     *Building
	w, h     int
	count    int
	max      int
	occupied []bool
	// reach marks the tiles of the farm's footprint and of its active
	// fields: a field is adjacent when a tile next to it is reached.
	reach []bool
	// c, grid and active let an accepted field re-activate the farm's
	// inactive fields it touches (a bridged chain).
	c      *content.Catalogue
	grid   []int32
	active map[int64]bool
}

// newFieldSites prepares the checks of fields of def from the farm; it
// fails with ErrFieldWrongFarm when def is not the farm's field type.
func newFieldSites(is *Island, c *content.Catalogue, farm *Building, def *content.Building, rotation int) (*fieldSites, error) {
	fdef := c.BuildingByID[farm.Type]
	if def == nil || def.Field == nil {
		return nil, fmt.Errorf("%w: not a field", ErrFieldTypeMismatch)
	}
	if fdef == nil || fdef.Fields == nil || def.Field.Farm != farm.Type || fdef.Fields.Type != def.Field.Type {
		return nil, fmt.Errorf("%w: %s belongs to %s, not %s %d", ErrFieldWrongFarm, def.ID, def.Field.Farm, farm.Type, farm.ID)
	}
	s := &fieldSites{is: is, def: def, farm: farm, max: fdef.Fields.Max, occupied: make([]bool, is.Width*is.Height), reach: make([]bool, is.Width*is.Height)}
	s.w, s.h = footprint(def, rotation)
	for i, id := range is.occupancy(c) {
		s.occupied[i] = id != 0 || is.Roads[i] != ""
	}
	fw, fh := footprint(fdef, farm.Rotation)
	s.mark(farm.X, farm.Y, fw, fh)
	fields := farmFieldsOf(is, c, farm.ID)
	s.count = len(fields)
	s.c, s.active = c, map[int64]bool{}
	if len(fields) > 0 {
		s.grid = fieldGrid(is, c)
		s.active = activeFields(is, c, s.grid, farm)
		for _, f := range fields {
			if s.active[f.ID] {
				w, h := footprint(c.BuildingByID[f.Type], f.Rotation)
				s.mark(f.X, f.Y, w, h)
			}
		}
	}
	return s, nil
}

// mark adds the rectangle's tiles to the reached area.
func (s *fieldSites) mark(x, y, w, h int) {
	for ty := max(y, 0); ty < min(y+h, s.is.Height); ty++ {
		for tx := max(x, 0); tx < min(x+w, s.is.Width); tx++ {
			s.reach[s.is.index(tx, ty)] = true
		}
	}
}

// check validates a field at (x, y), in the order of CheckFieldSite.
func (s *fieldSites) check(x, y int) error {
	is, def := s.is, s.def
	if s.count >= s.max {
		return fmt.Errorf("%w: %s %d has %d of %d fields", ErrFieldMaxReached, s.farm.Type, s.farm.ID, s.count, s.max)
	}
	if x < 0 || y < 0 || x > is.Width-s.w || y > is.Height-s.h {
		return fmt.Errorf("%w: %s footprint at (%d,%d)", ErrOutOfBounds, def.ID, x, y)
	}
	for ty := y; ty < y+s.h; ty++ {
		for tx := x; tx < x+s.w; tx++ {
			i := is.index(tx, ty)
			if t := is.Tiles[i].Terrain; !def.Field.MatchesTerrain(t) {
				return fmt.Errorf("%w: %s at (%d,%d) cannot stand on %s", ErrTerrain, def.ID, tx, ty, t)
			}
			if s.occupied[i] {
				return fmt.Errorf("%w: (%d,%d)", ErrOccupied, tx, ty)
			}
		}
	}
	if err := checkFertility(is, def.ID, def.Field.Fertility); err != nil {
		return err
	}
	adjacent := false
	is.forPerimeter(x, y, s.w, s.h, func(i int) { adjacent = adjacent || s.reach[i] })
	if !adjacent {
		return fmt.Errorf("%w: %s at (%d,%d) touches neither %s %d nor one of its active fields", ErrFieldNotAdjacent, def.ID, x, y, s.farm.Type, s.farm.ID)
	}
	return nil
}

// add records an accepted field at (x, y): it occupies its footprint and
// is active (it touches the reached area); inactive fields of the farm it
// touches become active with their chains.
func (s *fieldSites) add(x, y int) {
	for ty := y; ty < y+s.h; ty++ {
		for tx := x; tx < x+s.w; tx++ {
			s.occupied[s.is.index(tx, ty)] = true
		}
	}
	s.mark(x, y, s.w, s.h)
	s.count++
	if s.grid == nil {
		return
	}
	type rect struct{ x, y, w, h int }
	queue := []rect{{x, y, s.w, s.h}}
	ftype := s.def.Field.Type
	visit := func(i int) {
		k := s.grid[i]
		if k == 0 {
			return
		}
		f := s.is.Buildings[k-1]
		def := s.c.BuildingByID[f.Type]
		if f.FarmID != s.farm.ID || s.active[f.ID] || def == nil || def.Field == nil || def.Field.Type != ftype {
			return
		}
		s.active[f.ID] = true
		w, h := footprint(def, f.Rotation)
		s.mark(f.X, f.Y, w, h)
		queue = append(queue, rect{f.X, f.Y, w, h})
	}
	for len(queue) > 0 {
		r := queue[0]
		queue = queue[1:]
		s.is.forPerimeter(r.x, r.y, r.w, r.h, visit)
	}
}

// CheckFieldSite validates a field of the field building def at (x, y)
// (rotation r) from the farm: the field rule without tier, settlement and
// cost checks, in this order: the farm type matches def.Field.Farm
// (ErrFieldWrongFarm), the farm has fewer than fields.max fields
// (ErrFieldMaxReached), the footprint is on the island, on the field's
// terrain and free (ErrOutOfBounds, ErrTerrain, ErrOccupied), the island
// has the fertility (ErrNoFertility) and the footprint is 4-edge adjacent to
// the farm or one of its active fields (ErrFieldNotAdjacent). It is the
// check behind PlaceField and PlaceFields; the client mirrors it for the
// ghost as a hint.
func CheckFieldSite(is *Island, c *content.Catalogue, farm *Building, def *content.Building, x, y, rotation int) error {
	s, err := newFieldSites(is, c, farm, def, rotation)
	if err != nil {
		return err
	}
	return s.check(x, y)
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

// placeField is PlaceFields with one tile: the tile's error is the
// command's error.
func placeField(w *World, c *content.Catalogue, cmd PlaceField, charge bool, l *Ledger) error {
	results, err := placeFields(w, c, PlaceFields{IslandID: cmd.IslandID, FarmID: cmd.FarmID, Type: cmd.Type, Tiles: []Pos{{cmd.X, cmd.Y}}, Rotation: cmd.Rotation}, charge, l)
	if err != nil {
		return err
	}
	return results[0].Err
}

// noTileApplied reports whether every tile of a batch was rejected.
func noTileApplied(results []TileResult) bool {
	for _, r := range results {
		if r.Err == nil {
			return false
		}
	}
	return true
}

// checkBatchTiles validates the tile list of a batch command: 1 to
// MaxFieldTiles tiles without duplicates.
func checkBatchTiles(tiles []Pos) error {
	if len(tiles) == 0 {
		return fmt.Errorf("%w: no tiles", ErrInvalidCommand)
	}
	if len(tiles) > MaxFieldTiles {
		return fmt.Errorf("%w: %d tiles exceed %d", ErrInvalidCommand, len(tiles), MaxFieldTiles)
	}
	seen := make(map[Pos]bool, len(tiles))
	for _, p := range tiles {
		if seen[p] {
			return fmt.Errorf("%w: duplicate tile (%d,%d)", ErrInvalidCommand, p.X, p.Y)
		}
		seen[p] = true
	}
	return nil
}

func placeFields(w *World, c *content.Catalogue, cmd PlaceFields, charge bool, l *Ledger) ([]TileResult, error) {
	is, err := lookupIsland(w, cmd.IslandID)
	if err != nil {
		return nil, err
	}
	def := c.BuildingByID[cmd.Type]
	if def == nil {
		return nil, fmt.Errorf("%w: %q", ErrUnknownBuilding, cmd.Type)
	}
	if def.Field == nil {
		return nil, fmt.Errorf("%w: %q is not a field", ErrFieldTypeMismatch, cmd.Type)
	}
	farm := is.Building(cmd.FarmID)
	if farm == nil {
		return nil, fmt.Errorf("%w: farm %d on island %q", ErrBuildingNotFound, cmd.FarmID, cmd.IslandID)
	}
	if !validRotation(cmd.Rotation) {
		return nil, fmt.Errorf("%w: rotation %d", ErrInvalidCommand, cmd.Rotation)
	}
	if charge && !TierUnlocked(w, c, def.Tier) {
		return nil, fmt.Errorf("%w: %s needs tier %s", ErrTierLocked, def.ID, def.Tier)
	}
	if charge && !settled(is, c) {
		return nil, fmt.Errorf("%w: %q", ErrIslandNotSettled, is.ID)
	}
	if err := checkBatchTiles(cmd.Tiles); err != nil {
		return nil, err
	}
	sites, err := newFieldSites(is, c, farm, def, cmd.Rotation)
	if err != nil {
		return nil, err
	}

	// Passes over the tiles in order until a pass accepts none: a tile
	// that only touches a field accepted later in the list is accepted in
	// the next pass (the chain grows outwards from the farm).
	results := make([]TileResult, len(cmd.Tiles))
	done := make([]bool, len(cmd.Tiles))
	var order []int
	for progress := true; progress; {
		progress = false
		for i, p := range cmd.Tiles {
			if done[i] {
				continue
			}
			err := sites.check(p.X, p.Y)
			if err == nil && charge {
				err = checkCost(w, is, def.Cost, int64(len(order)+1))
			}
			results[i] = TileResult{X: p.X, Y: p.Y, Err: err}
			if err != nil {
				continue
			}
			sites.add(p.X, p.Y)
			done[i], progress = true, true
			order = append(order, i)
		}
	}
	if len(order) == 0 {
		return results, nil // no valid tile: no state change
	}

	// Validation complete: mutate.
	if charge {
		chargeCost(w, is, def.Cost, int64(len(order)), l)
	}
	if w.NextBuildingID < 1 {
		w.NextBuildingID = 1
	}
	for _, i := range order {
		p := cmd.Tiles[i]
		is.Buildings = append(is.Buildings, &Building{ID: w.NextBuildingID, Type: def.ID, X: p.X, Y: p.Y, Rotation: cmd.Rotation, Efficiency: 1000, FarmID: farm.ID})
		w.NextBuildingID++
	}
	afterChange(is, c)
	return results, nil
}

func demolishFields(w *World, c *content.Catalogue, cmd DemolishFields, l *Ledger) ([]TileResult, error) {
	is, err := lookupIsland(w, cmd.IslandID)
	if err != nil {
		return nil, err
	}
	farm := is.Building(cmd.FarmID)
	if farm == nil {
		return nil, fmt.Errorf("%w: farm %d on island %q", ErrBuildingNotFound, cmd.FarmID, cmd.IslandID)
	}
	if fdef := c.BuildingByID[farm.Type]; fdef == nil || fdef.Fields == nil {
		return nil, fmt.Errorf("%w: %s %d has no fields", ErrFieldWrongFarm, farm.Type, farm.ID)
	}
	if err := checkBatchTiles(cmd.Tiles); err != nil {
		return nil, err
	}
	occ := is.occupancy(c)
	results := make([]TileResult, len(cmd.Tiles))
	var remove []*Building
	chosen := map[int64]bool{}
	for i, p := range cmd.Tiles {
		results[i] = TileResult{X: p.X, Y: p.Y}
		if !is.InBounds(p.X, p.Y) {
			results[i].Err = fmt.Errorf("%w: (%d,%d)", ErrOutOfBounds, p.X, p.Y)
			continue
		}
		b := is.Building(occ[is.index(p.X, p.Y)])
		if b == nil || b.FarmID != farm.ID || c.BuildingByID[b.Type] == nil || c.BuildingByID[b.Type].Field == nil {
			results[i].Err = fmt.Errorf("%w: no field of %s %d at (%d,%d)", ErrBuildingNotFound, farm.Type, farm.ID, p.X, p.Y)
			continue
		}
		if !chosen[b.ID] {
			chosen[b.ID] = true
			remove = append(remove, b)
		}
	}
	if len(remove) == 0 {
		return results, nil // no valid tile: no state change
	}

	// Validation complete: mutate.
	now := w.LastEvaluatedAt.UnixMilli()
	for _, b := range remove {
		removeBuilding(is, b.ID)
		refund(is, c, c.BuildingByID[b.Type].Cost, 1, l, now)
	}
	afterChange(is, c)
	return results, nil
}
