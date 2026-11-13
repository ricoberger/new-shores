package sim

import (
	"cmp"
	"errors"
	"fmt"
	"maps"
	"slices"

	"github.com/ricoberger/new-shores/server/internal/content"
)

// Plans (D-071, MECHANICS §2 "Planning"):
//
//   - A plan is a planned building or a planned field (Island.Plans) or a
//     planned road tile (Island.PlannedRoads). It is created by the
//     placement commands with Planned set (PlaceBuilding, PlaceRoad,
//     PlaceFields), validated with every placement rule except the tier
//     lock and the cost, and costs nothing.
//   - A plan reserves its footprint: occupancy and every placement, move
//     and field check treat it as taken (roadOrPlan, occupancy). A road
//     placed on a planned road tile replaces the plan.
//   - A plan is invisible to every other rule: it is not in
//     Island.Buildings or Island.Roads, so no rate, service, reach,
//     connection, quest, unlock or summary sees it, and no plan command
//     calls afterChange or schedules anything.
//   - BuildPlan builds a plan with the normal placement at that instant
//     (tier, cost, typed errors): a planned building (a farm with its
//     planned fields), the planned fields of a farm, or a planned road
//     segment (the 4-connected planned road tiles of one type). Move and
//     demolish of a plan are the MoveBuilding / Demolish / DemolishRoad /
//     DemolishFields commands on the plan, free of charge.

// BuildPlan builds a plan (D-071). PlanID names a planned building (a
// planned farm is built with its planned fields), a planned field (its
// farm's planned fields; the farm's plan when the farm is planned) or a
// real farm (its planned fields). Tile, when set, names a planned road
// tile instead: its planned road segment is built.
type BuildPlan struct {
	IslandID string
	PlanID   int64
	Tile     *Pos
}

func (BuildPlan) isCommand() {}

// Plan returns the plan with the given ID or nil.
func (is *Island) Plan(id int64) *Building {
	for _, p := range is.Plans {
		if p.ID == id {
			return p
		}
	}
	return nil
}

// PlanAt returns the planned building or field whose footprint covers
// (x, y), or nil.
func (is *Island) PlanAt(c *content.Catalogue, x, y int) *Building {
	for _, p := range is.Plans {
		def := c.BuildingByID[p.Type]
		if def == nil {
			continue
		}
		w, h := footprint(def, p.Rotation)
		if x >= p.X && y >= p.Y && x < p.X+w && y < p.Y+h {
			return p
		}
	}
	return nil
}

// PlannedRoadAt returns the road type of the planned road tile at (x, y)
// or "".
func (is *Island) PlannedRoadAt(x, y int) string {
	if !is.InBounds(x, y) {
		return ""
	}
	return is.PlannedRoads[is.index(x, y)]
}

// addPlan stores a validated plan under the next building ID.
func addPlan(w *World, is *Island, p *Building) {
	if w.NextBuildingID < 1 {
		w.NextBuildingID = 1
	}
	p.ID = w.NextBuildingID
	w.NextBuildingID++
	is.Plans = append(is.Plans, p)
}

// removePlan drops a plan by ID.
func removePlan(is *Island, id int64) {
	is.Plans = slices.DeleteFunc(is.Plans, func(p *Building) bool { return p.ID == id })
	if len(is.Plans) == 0 {
		is.Plans = nil
	}
}

// removePlannedFields drops the planned fields of a farm (planned or not).
func removePlannedFields(is *Island, farmID int64) {
	is.Plans = slices.DeleteFunc(is.Plans, func(p *Building) bool { return p.FarmID == farmID })
	if len(is.Plans) == 0 {
		is.Plans = nil
	}
}

// plannedFieldsOf returns the planned fields of a farm, in ascending ID.
func plannedFieldsOf(is *Island, farmID int64) []*Building {
	var out []*Building
	for _, p := range is.Plans {
		if p.FarmID == farmID {
			out = append(out, p)
		}
	}
	return out
}

// planView returns the island as if its plans were built: the plans are
// buildings, the planned roads roads. It shares the buildings and must
// only be read (plan validation chains planned fields through planned
// fields, a planned quay sees the other planned quays).
func planView(is *Island) *Island {
	v := *is
	v.Buildings = slices.Concat(is.Buildings, is.Plans)
	v.Plans = nil
	if len(is.PlannedRoads) > 0 {
		v.Roads = maps.Clone(is.Roads)
		if v.Roads == nil {
			v.Roads = map[int]string{}
		}
		maps.Copy(v.Roads, is.PlannedRoads)
	}
	v.PlannedRoads = nil
	return &v
}

// planRoad places planned road tiles (D-071): settled island, free tiles
// only (no replacement of a lower road), every road rule against the
// island with its planned roads; no tier lock, no cost.
func planRoad(c *content.Catalogue, is *Island, def *content.Building, cmd PlaceRoad) error {
	if !settled(is, c) {
		return fmt.Errorf("%w: %q", ErrIslandNotSettled, is.ID)
	}
	if err := checkRoadTiles(cmd.Tiles); err != nil {
		return err
	}
	v := planView(is)
	if !def.Road.Shallows {
		// A planned road never replaces a road: every tile is free.
		if err := checkTiles(v, v.roadOccupancy(c), cmd.Tiles, allowRiver); err != nil {
			return err
		}
	}
	if err := checkRoadSite(v, c, def, cmd.Tiles); err != nil {
		return err
	}
	if is.PlannedRoads == nil {
		is.PlannedRoads = map[int]string{}
	}
	for _, p := range cmd.Tiles {
		is.PlannedRoads[is.index(p.X, p.Y)] = def.ID
	}
	return nil
}

// movePlan moves a planned building under the placement rules without
// tier and cost (D-071); its own footprint counts as free. Its planned
// fields stay where they are.
func movePlan(is *Island, c *content.Catalogue, p *Building, cmd MoveBuilding) error {
	if !validRotation(cmd.Rotation) {
		return fmt.Errorf("%w: rotation %d", ErrInvalidCommand, cmd.Rotation)
	}
	def := c.BuildingByID[p.Type]
	if def == nil {
		return fmt.Errorf("%w: %q", ErrUnknownBuilding, p.Type)
	}
	if def.Field != nil {
		return fmt.Errorf("%w: fields cannot be moved (demolish and place again)", ErrInvalidCommand)
	}
	occ := is.occupancy(c)
	for i, id := range occ {
		if id == p.ID {
			occ[i] = 0
		}
	}
	if err := checkSite(is, c, occ, def, cmd.X, cmd.Y, cmd.Rotation); err != nil {
		return err
	}
	if err := checkHarbourLane(is, c, def, cmd.X, cmd.Y, cmd.Rotation, p.ID); err != nil {
		return err
	}
	if berths := def.InitialBerths(); berths > 0 || def.Shore() {
		at := &Building{ID: -1, Type: def.ID, X: cmd.X, Y: cmd.Y, Rotation: cmd.Rotation, Berths: berths}
		if err := checkHarbourAfter(is, c, def, at, -1); err != nil {
			return err
		}
	}
	p.X, p.Y, p.Rotation = cmd.X, cmd.Y, cmd.Rotation
	return nil
}

// demolishPlan removes a plan for free: a planned farm with its planned
// fields.
func demolishPlan(is *Island, c *content.Catalogue, id int64) {
	p := is.Plan(id)
	if def := c.BuildingByID[p.Type]; def != nil && def.Fields != nil {
		removePlannedFields(is, id)
	}
	removePlan(is, id)
}

// PlannedRoadSegment returns the planned road segment through (x, y): the
// 4-connected planned road tiles of the tile's road type, in row-major
// order; nil when the tile carries no planned road.
func PlannedRoadSegment(is *Island, x, y int) []Pos {
	typ := is.PlannedRoadAt(x, y)
	if typ == "" {
		return nil
	}
	start := is.index(x, y)
	seen := map[int]bool{start: true}
	queue := []int{start}
	for len(queue) > 0 {
		i := queue[0]
		queue = queue[1:]
		px, py := i%is.Width, i/is.Width
		for _, d := range neighbours() {
			nx, ny := px+d.X, py+d.Y
			if !is.InBounds(nx, ny) {
				continue
			}
			j := is.index(nx, ny)
			if !seen[j] && is.PlannedRoads[j] == typ {
				seen[j] = true
				queue = append(queue, j)
			}
		}
	}
	out := make([]Pos, 0, len(seen))
	for _, i := range slices.Sorted(maps.Keys(seen)) {
		out = append(out, Pos{X: i % is.Width, Y: i / is.Width})
	}
	return out
}

func buildPlan(w *World, c *content.Catalogue, cmd BuildPlan, l *Ledger) error {
	is, err := lookupIsland(w, cmd.IslandID)
	if err != nil {
		return err
	}
	if cmd.Tile != nil {
		tiles := PlannedRoadSegment(is, cmd.Tile.X, cmd.Tile.Y)
		if len(tiles) == 0 {
			return fmt.Errorf("%w: no planned road at (%d,%d)", ErrPlanNotFound, cmd.Tile.X, cmd.Tile.Y)
		}
		// PlaceRoad validates completely before it mutates and replaces
		// the planned tiles it covers.
		return placeRoad(w, c, PlaceRoad{IslandID: is.ID, Type: is.PlannedRoadAt(cmd.Tile.X, cmd.Tile.Y), Tiles: tiles}, l)
	}
	p := is.Plan(cmd.PlanID)
	if p == nil {
		if b := is.Building(cmd.PlanID); b != nil && len(plannedFieldsOf(is, b.ID)) > 0 {
			return buildAtomically(w, is.ID, l, func(w *World, is *Island, l *Ledger) error {
				return buildPlannedFields(w, c, is, b.ID, b.ID, l)
			})
		}
		return fmt.Errorf("%w: %d on island %q", ErrPlanNotFound, cmd.PlanID, is.ID)
	}
	if p.FarmID != 0 {
		// A planned field builds its farm's planned fields, or the
		// planned farm with them.
		return buildPlan(w, c, BuildPlan{IslandID: is.ID, PlanID: p.FarmID}, l)
	}
	return buildAtomically(w, is.ID, l, func(w *World, is *Island, l *Ledger) error {
		plan := *p
		removePlan(is, plan.ID)
		if err := placeBuilding(w, c, PlaceBuilding{IslandID: is.ID, Type: plan.Type, X: plan.X, Y: plan.Y, Rotation: plan.Rotation}, true, l); err != nil {
			return err
		}
		if len(plannedFieldsOf(is, plan.ID)) == 0 {
			return nil
		}
		return buildPlannedFields(w, c, is, plan.ID, w.NextBuildingID-1, l)
	})
}

// buildAtomically runs build on a copy of the world and keeps the copy
// only when it succeeds: building a farm with its fields is several
// placements that succeed or fail together.
func buildAtomically(w *World, islandID string, l *Ledger, build func(*World, *Island, *Ledger) error) error {
	cw := w.Clone()
	cl := NewLedger()
	if err := build(cw, cw.Island(islandID), cl); err != nil {
		return err
	}
	// Keep the island pointers callers may hold.
	islands := w.Islands()
	*w = *cw
	for i, is := range islands {
		*is = *w.Islands()[i]
		w.ReplaceIsland(is)
	}
	l.merge(cl)
	return nil
}

// buildPlannedFields builds the planned fields of the farm plan oldFarm
// as fields of the built farm newFarm (the same ID for a real farm's
// planned fields). The fields are placed like PlaceFields; a field that
// cannot be afforded fails the whole build, a field whose site is no
// longer valid stays planned (now of newFarm). When no field could be
// built the first field's error is returned.
func buildPlannedFields(w *World, c *content.Catalogue, is *Island, oldFarm, newFarm int64, l *Ledger) error {
	fields := plannedFieldsOf(is, oldFarm)
	removePlannedFields(is, oldFarm)
	type group struct {
		typ string
		rot int
	}
	var keys []group
	tiles := map[group][]*Building{}
	for _, f := range fields {
		k := group{f.Type, f.Rotation}
		if tiles[k] == nil {
			keys = append(keys, k)
		}
		tiles[k] = append(tiles[k], f)
	}
	built := 0
	var first error
	for _, k := range keys {
		fs := tiles[k]
		pos := make([]Pos, len(fs))
		for i, f := range fs {
			pos[i] = Pos{f.X, f.Y}
		}
		results, err := placeFields(w, c, PlaceFields{IslandID: is.ID, FarmID: newFarm, Type: k.typ, Tiles: pos, Rotation: k.rot}, true, l)
		if err != nil {
			return err
		}
		for i, r := range results {
			switch {
			case r.Err == nil:
				built++
			case errors.Is(r.Err, ErrInsufficientGold), errors.Is(r.Err, ErrInsufficientMaterials):
				return r.Err
			default:
				if first == nil {
					first = r.Err
				}
				kept := *fs[i]
				kept.FarmID = newFarm
				is.Plans = append(is.Plans, &kept)
			}
		}
	}
	slices.SortFunc(is.Plans, func(a, b *Building) int { return cmp.Compare(a.ID, b.ID) })
	if built == 0 && first != nil && oldFarm == newFarm {
		return first
	}
	return nil
}
