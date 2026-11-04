package sim

import (
	"errors"
	"maps"
	"slices"

	"github.com/ricoberger/new-shores/server/internal/content"
)

// PlanDisplay is a planned building or a planned field (D-071). Planned
// is always true. A planned field carries the ID of its farm (planned or
// real) and no cost; a planned building carries PlanCost, which for a
// planned farm includes its planned fields.
type PlanDisplay struct {
	ID       int64            `json:"id"`
	Type     string           `json:"type"`
	X        int              `json:"x"`
	Y        int              `json:"y"`
	Rotation int              `json:"rotation"`
	Planned  bool             `json:"planned"`
	FarmID   *int64           `json:"farm_id,omitempty"`
	PlanCost *PlanCostDisplay `json:"plan_cost,omitempty"`
}

// PlannedRoadDisplay is a planned road segment (D-071): the 4-connected
// planned road tiles of one road type (row-major order), built together
// by build_plan on any of its tiles. Planned is always true.
type PlannedRoadDisplay struct {
	Type     string            `json:"type"`
	Planned  bool              `json:"planned"`
	Tiles    []PositionDisplay `json:"tiles"`
	PlanCost PlanCostDisplay   `json:"plan_cost"`
}

// PlannedFieldsDisplay is set on a real farm with planned fields: their
// IDs (ascending) and what building them costs (build_plan on the farm).
type PlannedFieldsDisplay struct {
	IDs      []int64         `json:"ids"`
	PlanCost PlanCostDisplay `json:"plan_cost"`
}

// PlanCostDisplay is what building a plan costs now (milli-gold and
// milli-units per good) and, when build_plan would fail at the payload's
// instant, the first failing reason as an API error code (PlanReasons):
// the server's validation, so the client computes no rule (D-027). The
// field sites of a farm's planned fields are not part of the reason (a
// field whose site is invalid stays planned).
type PlanCostDisplay struct {
	Gold      Qty            `json:"gold"`
	Materials map[string]Qty `json:"materials"`
	Reason    string         `json:"reason,omitempty"`
}

// PlanReason is an error a plan build can fail with and its API error
// code (PlanCostDisplay.Reason).
type PlanReason struct {
	Err  error
	Code string
}

// PlanReasons lists the plan reasons in match order; any other error is
// reported as PlanReasonInvalid. The API tests that each code equals the
// code the API returns for the error.
func PlanReasons() []PlanReason {
	return []PlanReason{
		{ErrTierLocked, "tier_locked"},
		{ErrIslandNotSettled, "island_not_settled"},
		{ErrOutOfBounds, "out_of_bounds"},
		{ErrOccupied, "occupied"},
		{ErrTerrain, "terrain"},
		{ErrNotCoastal, "not_coastal"},
		{ErrNotOnWater, "not_on_water"},
		{ErrHarbourBlocked, "harbour_blocked"},
		{ErrNoFertility, "no_fertility"},
		{ErrNoDeposit, "no_deposit"},
		{ErrInsufficientGold, "insufficient_gold"},
		{ErrInsufficientMaterials, "insufficient_materials"},
	}
}

// PlanReasonInvalid is the reason of a plan build error outside
// PlanReasons.
const PlanReasonInvalid = "invalid_command"

func planReason(err error) string {
	if err == nil {
		return ""
	}
	for _, r := range PlanReasons() {
		if errors.Is(err, r.Err) {
			return r.Code
		}
	}
	return PlanReasonInvalid
}

// costDisplay converts a cost (times n) into its display.
func costDisplay(cost content.Cost, n int64, err error) PlanCostDisplay {
	d := PlanCostDisplay{Gold: cost.Gold * n, Materials: map[string]Qty{}, Reason: planReason(err)}
	for _, m := range cost.Materials {
		d.Materials[m.Good] += m.Amount * n
	}
	return d
}

// addCost returns a + b with the materials merged in good order.
func addCost(a, b content.Cost) content.Cost {
	m := map[string]Qty{}
	for _, g := range a.Materials {
		m[g.Good] += g.Amount
	}
	for _, g := range b.Materials {
		m[g.Good] += g.Amount
	}
	out := content.Cost{Gold: a.Gold + b.Gold}
	for _, g := range slices.Sorted(maps.Keys(m)) {
		out.Materials = append(out.Materials, content.GoodAmount{Good: g, Amount: m[g]})
	}
	return out
}

// fieldsCost is the cost of a farm's planned fields and the first error
// of their tier lock.
func fieldsCost(w *World, c *content.Catalogue, fields []*Building) (content.Cost, error) {
	var (
		cost  content.Cost
		first error
	)
	for _, f := range fields {
		def := c.BuildingByID[f.Type]
		if def == nil {
			continue
		}
		cost = addCost(cost, def.Cost)
		if first == nil && !TierUnlocked(w, c, def.Tier) {
			first = ErrTierLocked
		}
	}
	return cost, first
}

// checkBuildingPlan is what build_plan of the planned building p would
// cost now and the first reason it would fail (nil: it would succeed).
func checkBuildingPlan(w *World, c *content.Catalogue, is *Island, p *Building) (content.Cost, error) {
	def := c.BuildingByID[p.Type]
	if def == nil {
		return content.Cost{}, ErrUnknownBuilding
	}
	fcost, ferr := fieldsCost(w, c, plannedFieldsOf(is, p.ID))
	cost := addCost(def.Cost, fcost)
	switch {
	case !TierUnlocked(w, c, def.Tier):
		return cost, ErrTierLocked
	case ferr != nil:
		return cost, ferr
	case !settled(is, c):
		return cost, ErrIslandNotSettled
	}
	occ := is.occupancy(c)
	for i, id := range occ {
		if id == p.ID {
			occ[i] = 0
		}
	}
	if err := checkSite(is, c, occ, def, p.X, p.Y, p.Rotation); err != nil {
		return cost, err
	}
	if berths := def.InitialBerths(); berths > 0 {
		at := &Building{ID: -1, Type: def.ID, X: p.X, Y: p.Y, Rotation: p.Rotation, Berths: berths}
		if err := checkHarbourAfter(is, c, def, at, -1); err != nil {
			return cost, err
		}
	}
	return cost, checkCost(w, is, cost, 1)
}

// checkRoadPlan is what build_plan of a planned road segment would cost
// now and the first reason it would fail.
func checkRoadPlan(w *World, c *content.Catalogue, is *Island, typ string, tiles []Pos) (content.Cost, error) {
	def := c.BuildingByID[typ]
	if def == nil || def.Road == nil {
		return content.Cost{}, ErrUnknownBuilding
	}
	n := int64(len(tiles))
	if !TierUnlocked(w, c, def.Tier) {
		return def.Cost, ErrTierLocked
	}
	if !settled(is, c) {
		return def.Cost, ErrIslandNotSettled
	}
	planned := *is
	planned.PlannedRoads = nil
	if err := checkRoadSite(&planned, c, def, tiles); err != nil {
		return def.Cost, err
	}
	return def.Cost, checkCost(w, is, def.Cost, n)
}

// displayPlans adds the island's plans to its display (D-071): planned
// buildings and fields, planned road segments, and the planned fields of
// real farms on the farms' entries.
func displayPlans(w *World, c *content.Catalogue, is *Island, d *IslandDisplay) {
	for _, p := range is.Plans {
		pd := PlanDisplay{ID: p.ID, Type: p.Type, X: p.X, Y: p.Y, Rotation: p.Rotation, Planned: true}
		if p.FarmID != 0 {
			pd.FarmID = ptr(p.FarmID)
		} else {
			cost, err := checkBuildingPlan(w, c, is, p)
			pd.PlanCost = ptr(costDisplay(cost, 1, err))
		}
		d.Plans = append(d.Plans, pd)
	}
	for i := range d.Buildings {
		b := &d.Buildings[i]
		fields := plannedFieldsOf(is, b.ID)
		if len(fields) == 0 {
			continue
		}
		pf := &PlannedFieldsDisplay{IDs: []int64{}}
		for _, f := range fields {
			pf.IDs = append(pf.IDs, f.ID)
		}
		cost, err := fieldsCost(w, c, fields)
		if err == nil {
			err = checkCost(w, is, cost, 1)
		}
		pf.PlanCost = costDisplay(cost, 1, err)
		b.PlannedFields = pf
	}
	seen := map[int]bool{}
	for _, i := range slices.Sorted(maps.Keys(is.PlannedRoads)) {
		if seen[i] {
			continue
		}
		typ := is.PlannedRoads[i]
		tiles := PlannedRoadSegment(is, i%is.Width, i/is.Width)
		rd := PlannedRoadDisplay{Type: typ, Planned: true, Tiles: make([]PositionDisplay, 0, len(tiles))}
		for _, t := range tiles {
			seen[is.index(t.X, t.Y)] = true
			rd.Tiles = append(rd.Tiles, PositionDisplay(t))
		}
		cost, err := checkRoadPlan(w, c, is, typ, tiles)
		rd.PlanCost = costDisplay(cost, int64(len(tiles)), err)
		d.PlannedRoads = append(d.PlannedRoads, rd)
	}
}
