package sim

import (
	"cmp"
	"fmt"
	"slices"
	"strings"

	"github.com/ricoberger/new-shores/server/internal/content"
)

// Fields of farms (D-049, superseding the implicit work area of MECHANICS
// §2 for farms):
//
//   - A field is a 1x1 building whose content definition has a field block.
//     It occupies its tile like any building, has no upkeep, no recipe and
//     no road connection, and is never paused.
//   - A tile is a valid field site for a field type when, in this order, it
//     is on the island, its terrain is in field.terrain, it carries neither
//     a building nor a road, the island has field.fertility (when set), and
//     its centre lies within the work radius of at least one farm on the
//     island whose fields.type is the field type (paused or unconnected
//     farms count).
//   - The radius test is the disc rule of the work area:
//     (2tx+1-(2x+W))^2 + (2ty+1-(2y+H))^2 <= (2r)^2 against the farm's
//     rotated footprint (x, y, W, H).
//   - Every field is assigned to the accepting farm whose radius contains
//     it and whose footprint centre is nearest to the field's tile centre
//     (exact integer squared distance of doubled coordinates); ties go to
//     the lowest farm ID. A field without such a farm is unassigned
//     (FarmID 0, status no_farm). The assignment is recomputed in full
//     after every placement change of the island (afterChange).
//   - A farm's efficiency is min(1000, assigned x 1000 / fields.required)
//     per mille (0 without fields).

// MaxFieldTiles bounds the tiles of one PlaceFields or DemolishFields
// command.
const MaxFieldTiles = 256

// StatusNoFarm is the status of a field outside the radius of every farm
// that accepts its type.
const StatusNoFarm = "no_farm"

// PlaceFields places one field of the field building Type on each tile, all
// or nothing (D-049). Fields get sequential building IDs in tile order.
type PlaceFields struct {
	IslandID string
	Type     string
	Tiles    []Pos
}

// DemolishFields removes the fields covering the tiles, all or nothing,
// with the demolition refund of D-019.
type DemolishFields struct {
	IslandID string
	Tiles    []Pos
}

func (PlaceFields) isCommand()    {}
func (DemolishFields) isCommand() {}

// inRadius reports whether the centre of tile (tx, ty) lies within radius r
// of the footprint centre of the rectangle [x, x+w) x [y, y+h).
func inRadius(x, y, w, h, r, tx, ty int) bool {
	dx, dy := 2*tx+1-(2*x+w), 2*ty+1-(2*y+h)
	return dx*dx+dy*dy <= 4*r*r
}

// farmSite is an accepting farm of a field type: its ID, rotated footprint
// and work radius.
type farmSite struct {
	id         int64
	x, y, w, h int
	radius     int
}

// contains reports whether the farm's radius contains tile (tx, ty).
func (f farmSite) contains(tx, ty int) bool { return inRadius(f.x, f.y, f.w, f.h, f.radius, tx, ty) }

// dist2 is the squared distance between the doubled centres of the farm's
// footprint and tile (tx, ty).
func (f farmSite) dist2(tx, ty int) int {
	dx, dy := 2*tx+1-(2*f.x+f.w), 2*ty+1-(2*f.y+f.h)
	return dx*dx + dy*dy
}

// acceptingFarms returns the farms on the island that accept fieldType, in
// ascending building ID.
func acceptingFarms(is *Island, c *content.Catalogue, fieldType string) []farmSite {
	var out []farmSite
	for _, b := range is.Buildings {
		def := c.BuildingByID[b.Type]
		if def == nil || def.Fields == nil || def.Fields.Type != fieldType || def.WorkArea == nil {
			continue
		}
		w, h := footprint(def, b.Rotation)
		out = append(out, farmSite{id: b.ID, x: b.X, y: b.Y, w: w, h: h, radius: def.WorkArea.Radius})
	}
	slices.SortFunc(out, func(a, b farmSite) int { return cmp.Compare(a.id, b.id) })
	return out
}

// nearestFarm returns the ID of the farm among farms (ascending ID) whose
// radius contains (tx, ty) and whose centre is nearest; 0 when none.
func nearestFarm(farms []farmSite, tx, ty int) int64 {
	var best int64
	bestD := 0
	for _, f := range farms {
		if !f.contains(tx, ty) {
			continue
		}
		if d := f.dist2(tx, ty); best == 0 || d < bestD {
			best, bestD = f.id, d
		}
	}
	return best
}

// checkFieldTile validates a field site of the field building def at
// (x, y) against occ (the occupancy to use) and the accepting farms, in
// the order of the field rule.
func checkFieldTile(is *Island, occ []int64, def *content.Building, farms []farmSite, x, y int) error {
	if !is.InBounds(x, y) {
		return fmt.Errorf("%w: (%d,%d)", ErrOutOfBounds, x, y)
	}
	i := is.index(x, y)
	if t := is.Tiles[i].Terrain; !def.Field.MatchesTerrain(t) {
		return fmt.Errorf("%w: %s at (%d,%d) cannot stand on %s", ErrTerrain, def.ID, x, y, t)
	}
	if occ[i] != 0 || is.Roads[i] != "" {
		return fmt.Errorf("%w: (%d,%d)", ErrOccupied, x, y)
	}
	if err := checkFertility(is, def.ID, def.Field.Fertility); err != nil {
		return err
	}
	if nearestFarm(farms, x, y) == 0 {
		return fmt.Errorf("%w: %s at (%d,%d)", ErrNoFarmInRange, def.ID, x, y)
	}
	return nil
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

// ValidFieldTiles returns the tiles of a candidate list (in their order)
// on which a field of the field building fieldType could be placed now:
// the field rule without tier, settlement and cost checks. It is the pure
// filter behind rectangle placement (the scenario runner's fields step;
// the client applies the same rule to its display data as a hint). The
// PlaceFields command stays the authority.
func ValidFieldTiles(is *Island, c *content.Catalogue, fieldType string, tiles []Pos) []Pos {
	def := c.BuildingByID[fieldType]
	if is == nil || def == nil || def.Field == nil {
		return nil
	}
	occ := is.occupancy(c)
	farms := acceptingFarms(is, c, def.Field.Type)
	var out []Pos
	for _, p := range tiles {
		if checkFieldTile(is, occ, def, farms, p.X, p.Y) == nil {
			out = append(out, p)
		}
	}
	return out
}

// assignFields recomputes the farm of every field and the efficiency of
// every farm on the island (fields rule above).
func assignFields(is *Island, c *content.Catalogue) {
	farms := map[string][]farmSite{}
	assigned := map[int64]int{}
	for _, b := range is.Buildings {
		def := c.BuildingByID[b.Type]
		if def == nil || def.Field == nil {
			continue
		}
		fs, ok := farms[def.Field.Type]
		if !ok {
			fs = acceptingFarms(is, c, def.Field.Type)
			farms[def.Field.Type] = fs
		}
		b.FarmID = nearestFarm(fs, b.X, b.Y)
		if b.FarmID != 0 {
			assigned[b.FarmID]++
		}
	}
	for _, b := range is.Buildings {
		def := c.BuildingByID[b.Type]
		if def == nil || def.Fields == nil {
			continue
		}
		b.Efficiency = fieldEfficiency(assigned[b.ID], def.Fields.Required)
	}
}

// fieldEfficiency is min(1000, assigned x 1000 / required) per mille.
func fieldEfficiency(assigned, required int) int64 {
	if required < 1 {
		return 0
	}
	return min(int64(assigned)*1000/int64(required), 1000)
}

// assignedFields counts the fields assigned to each farm of the island.
func assignedFields(is *Island, c *content.Catalogue) map[int64]int {
	out := map[int64]int{}
	for _, b := range is.Buildings {
		if def := c.BuildingByID[b.Type]; def != nil && def.Field != nil && b.FarmID != 0 {
			out[b.FarmID]++
		}
	}
	return out
}

func placeFields(w *World, c *content.Catalogue, cmd PlaceFields, l *Ledger) error {
	is, err := lookupIsland(w, cmd.IslandID)
	if err != nil {
		return err
	}
	def := c.BuildingByID[cmd.Type]
	if def == nil || def.Field == nil {
		return fmt.Errorf("%w: %q is not a field", ErrFieldTypeMismatch, cmd.Type)
	}
	if err := checkFieldTileList(cmd.Tiles); err != nil {
		return err
	}
	if !TierUnlocked(w, c, def.Tier) {
		return fmt.Errorf("%w: %s needs tier %s", ErrTierLocked, def.ID, def.Tier)
	}
	if !settled(is, c) {
		return fmt.Errorf("%w: %q", ErrIslandNotSettled, is.ID)
	}
	// Every tile is checked against the island before the command: the
	// whole set must be free.
	occ := is.occupancy(c)
	farms := acceptingFarms(is, c, def.Field.Type)
	for _, p := range cmd.Tiles {
		if err := checkFieldTile(is, occ, def, farms, p.X, p.Y); err != nil {
			return err
		}
	}
	n := int64(len(cmd.Tiles))
	if err := checkCost(w, is, def.Cost, n); err != nil {
		return err
	}

	// Validation complete: mutate.
	chargeCost(w, is, def.Cost, n, l)
	if w.NextBuildingID < 1 {
		w.NextBuildingID = 1
	}
	for _, p := range cmd.Tiles {
		is.Buildings = append(is.Buildings, &Building{ID: w.NextBuildingID, Type: def.ID, X: p.X, Y: p.Y, Efficiency: 1000})
		w.NextBuildingID++
	}
	afterChange(is, c)
	return nil
}

// checkFieldTileList validates the size of a field command's tile list
// and that it has no duplicates.
func checkFieldTileList(tiles []Pos) error {
	if len(tiles) == 0 || len(tiles) > MaxFieldTiles {
		return fmt.Errorf("%w: %d tiles (1 to %d)", ErrInvalidCommand, len(tiles), MaxFieldTiles)
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

func demolishFields(w *World, c *content.Catalogue, cmd DemolishFields, l *Ledger) error {
	is, err := lookupIsland(w, cmd.IslandID)
	if err != nil {
		return err
	}
	if err := checkFieldTileList(cmd.Tiles); err != nil {
		return err
	}
	occ := is.occupancy(c)
	remove := map[int64]bool{}
	count := map[string]int64{}
	for _, p := range cmd.Tiles {
		if !is.InBounds(p.X, p.Y) {
			return fmt.Errorf("%w: (%d,%d)", ErrOutOfBounds, p.X, p.Y)
		}
		b := is.Building(occ[is.index(p.X, p.Y)])
		if b == nil {
			return fmt.Errorf("%w: no building at (%d,%d) on island %q", ErrBuildingNotFound, p.X, p.Y, is.ID)
		}
		if def := c.BuildingByID[b.Type]; def == nil || def.Field == nil {
			return fmt.Errorf("%w: %s %d at (%d,%d)", ErrNotAField, b.Type, b.ID, p.X, p.Y)
		}
		remove[b.ID] = true
		count[b.Type]++
	}

	// Validation complete: mutate. Fields have no capacity, transit or
	// buffer, so only the refund applies.
	now := w.LastEvaluatedAt.UnixMilli()
	out := is.Buildings[:0]
	for _, b := range is.Buildings {
		if !remove[b.ID] {
			out = append(out, b)
		}
	}
	if len(out) == 0 {
		out = nil
	}
	is.Buildings = out
	for _, typ := range sortedKeys(count) {
		refund(is, c, c.BuildingByID[typ].Cost, count[typ], l, now)
	}
	afterChange(is, c)
	return nil
}
