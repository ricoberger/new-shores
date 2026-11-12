package sim

import (
	"bytes"
	"errors"
	"testing"
	"time"
)

// planWorld is the test world with a house, a sawmill and a lumberjack
// with one tree plot (pre-D-054 test content).
func planWorld(t *testing.T) *World {
	t.Helper()
	c := catalogue(t)
	w := testWorld(t, c)
	mustApply(t, w, c, PlaceBuilding{IslandID: "main", Type: "house_settlers", X: 3, Y: 5, Rotation: 180})
	mustApply(t, w, c, PlaceBuilding{IslandID: "main", Type: "sawmill", X: 6, Y: 5})
	mustApply(t, w, c, PlaceBuilding{IslandID: "main", Type: "lumberjack", X: 10, Y: 2})
	mustApply(t, w, c, PlaceField{IslandID: "main", FarmID: w.NextBuildingID - 1, Type: "tree_plot", X: 12, Y: 2})
	return w
}

// stripPlans removes every plan of the world and returns the number
// removed.
func stripPlans(w *World) int {
	n := 0
	for _, is := range w.Islands() {
		n += len(is.Plans) + len(is.PlannedRoads)
		is.Plans, is.PlannedRoads = nil, nil
	}
	return n
}

// TestPlansInvisibleToAdvance: plans are invisible to the sim (D-071 §2).
// A world with planned buildings (one of a locked tier), a planned field
// of a real farm and a planned road advances for 12 hours exactly like
// the same world without them: once the plans are stripped (and the
// building ID counter they used is reset) the two encode byte for byte,
// and their displays agree.
func TestPlansInvisibleToAdvance(t *testing.T) {
	c := catalogue(t)
	w := planWorld(t)
	wp := w.Clone()
	lumberjack := wp.Islands()[0].BuildingAt(c, 10, 2).ID
	var road []Pos
	for x := 8; x <= 15; x++ {
		road = append(road, Pos{x, 7})
	}
	for _, cmd := range []Command{
		PlaceBuilding{IslandID: "main", Type: "sawmill", X: 14, Y: 5, Planned: true},
		PlaceBuilding{IslandID: "main", Type: "bakery", X: 2, Y: 7, Planned: true},
		PlaceBuilding{IslandID: "main", Type: "sheep_farm", X: 16, Y: 5, Planned: true},
		PlaceFields{IslandID: "main", FarmID: lumberjack, Type: "tree_plot", Tiles: []Pos{{12, 3}}, Planned: true},
		PlaceRoad{IslandID: "main", Type: "road_dirt", Tiles: road, Planned: true},
		PlaceRoad{IslandID: "main", Type: "road_paved", Tiles: []Pos{{5, 7}, {5, 8}}, Planned: true},
	} {
		mustApply(t, wp, c, cmd)
	}
	if got := len(wp.Islands()[0].Plans) + len(wp.Islands()[0].PlannedRoads); got != 14 {
		t.Fatalf("%d plans, want 14", got)
	}
	if wp.Gold != w.Gold {
		t.Fatalf("planning charged gold: %d != %d", wp.Gold, w.Gold)
	}
	for _, d := range []time.Duration{time.Minute, 12 * time.Hour} {
		mustAdvance(t, w, c, d)
		mustAdvance(t, wp, c, d)
	}
	dw, dp := display(t, w, c), display(t, wp, c)
	stripPlans(wp)
	wp.NextBuildingID = w.NextBuildingID
	if a, b := encode(t, w), encode(t, wp); !bytes.Equal(a, b) {
		t.Fatalf("the world with plans advanced differently:\n%s\n%s", a, b)
	}
	if dw.Gold != dp.Gold || dw.BalanceRatePerMin != dp.BalanceRatePerMin || dw.NextChangeAt == nil || dp.NextChangeAt == nil || *dw.NextChangeAt != *dp.NextChangeAt {
		t.Fatalf("displays differ: gold %d/%d balance %d/%d", dw.Gold, dp.Gold, dw.BalanceRatePerMin, dp.BalanceRatePerMin)
	}
}

// TestPlanRules covers the plan rules the golden scenarios plans_build
// and plans_roads do not: what cannot be planned, reservations against
// roads and quays of plans, free removal, and build errors.
func TestPlanRules(t *testing.T) {
	c := catalogue(t)
	w := planWorld(t)
	is := w.Islands()[0]
	try := func(cmd Command, want error) {
		t.Helper()
		before := encode(t, w)
		err := Apply(w, c, cmd)
		if !errors.Is(err, want) {
			t.Fatalf("Apply(%#v) = %v, want %v", cmd, err, want)
		}
		if !bytes.Equal(before, encode(t, w)) {
			t.Fatalf("failed %#v changed the world", cmd)
		}
	}
	// What cannot be planned.
	try(PlaceBuilding{IslandID: "main", Type: "trading_post", X: 14, Y: 5, Planned: true}, ErrIslandAlreadySettled)
	try(PlaceBuilding{IslandID: "main", Type: "house_citizens", X: 14, Y: 5, Planned: true}, ErrUpgradeOnly)
	try(PlaceBuilding{IslandID: "main", Type: "tree_plot", X: 14, Y: 5, Planned: true}, ErrFieldNeedsFarm)
	// A planned road never replaces a road and keeps off plans.
	try(PlaceRoad{IslandID: "main", Type: "road_paved", Tiles: []Pos{{8, 4}}, Planned: true}, ErrOccupied)
	mustApply(t, w, c, PlaceBuilding{IslandID: "main", Type: "sawmill", X: 14, Y: 5, Planned: true})
	plan := w.NextBuildingID - 1
	try(PlaceRoad{IslandID: "main", Type: "road_dirt", Tiles: []Pos{{14, 6}}, Planned: true}, ErrOccupied)
	try(PlaceRoad{IslandID: "main", Type: "road_dirt", Tiles: []Pos{{14, 6}}}, ErrOccupied)
	mustApply(t, w, c, PlaceRoad{IslandID: "main", Type: "road_dirt", Tiles: []Pos{{16, 5}, {16, 6}}, Planned: true})
	try(PlaceBuilding{IslandID: "main", Type: "sawmill", X: 16, Y: 6, Planned: true}, ErrOccupied)
	try(MoveBuilding{IslandID: "main", BuildingID: plan, X: 15, Y: 5}, ErrOccupied)
	// A plan has no state the sim could use: no upgrade, no pause.
	try(SetPaused{IslandID: "main", BuildingID: plan, Paused: true}, ErrBuildingNotFound)
	try(UpgradeBuilding{IslandID: "main", BuildingID: plan}, ErrBuildingNotFound)
	// Build errors.
	try(BuildPlan{IslandID: "main", PlanID: 999}, ErrPlanNotFound)
	try(BuildPlan{IslandID: "main", Tile: &Pos{0, 0}}, ErrPlanNotFound)
	gold := w.Gold
	w.Gold = 0
	try(BuildPlan{IslandID: "main", PlanID: plan}, ErrInsufficientGold)
	w.Gold = gold
	// Removal is free: the demolish commands take plans.
	mustApply(t, w, c, Demolish{IslandID: "main", BuildingID: plan})
	mustApply(t, w, c, DemolishRoad{IslandID: "main", Tiles: []Pos{{16, 5}, {16, 6}}})
	if w.Gold != gold || len(is.Plans) != 0 || len(is.PlannedRoads) != 0 {
		t.Fatalf("removal: gold %d (want %d), plans %v, planned roads %v", w.Gold, gold, is.Plans, is.PlannedRoads)
	}
	// Fields of a planned farm are planned; demolish_fields removes them.
	mustApply(t, w, c, PlaceBuilding{IslandID: "main", Type: "sheep_farm", X: 15, Y: 5, Planned: true})
	farm := w.NextBuildingID - 1
	res, err := ApplyWithResult(w, c, PlaceFields{IslandID: "main", FarmID: farm, Type: "pasture", Tiles: []Pos{{13, 5}, {18, 8}}}, nil)
	if err != nil || res.Tiles[0].Err != nil || res.Tiles[1].Err == nil {
		t.Fatalf("fields of a planned farm: %v %+v", err, res.Tiles)
	}
	if len(is.Plans) != 2 || w.Gold != gold {
		t.Fatalf("plans %d gold %d", len(is.Plans), w.Gold)
	}
	mustApply(t, w, c, DemolishFields{IslandID: "main", FarmID: farm, Tiles: []Pos{{14, 6}}})
	if len(is.Plans) != 1 || is.Plans[0].ID != farm {
		t.Fatalf("plans after demolish_fields: %+v", is.Plans)
	}
	// Building a planned farm whose fields cannot be afforded fails as a
	// whole.
	mustApply(t, w, c, PlaceFields{IslandID: "main", FarmID: farm, Type: "pasture", Tiles: []Pos{{13, 5}}})
	def, field := c.BuildingByID["sheep_farm"], c.BuildingByID["pasture"]
	w.Gold = def.Cost.Gold + field.Cost.Gold - 1
	try(BuildPlan{IslandID: "main", PlanID: farm}, ErrInsufficientGold)
	w.Gold = def.Cost.Gold + field.Cost.Gold
	mustApply(t, w, c, BuildPlan{IslandID: "main", PlanID: farm})
	if w.Gold != 0 || len(is.Plans) != 0 || is.BuildingAt(c, 13, 5) == nil || is.BuildingAt(c, 13, 5).Inactive {
		t.Fatalf("built farm: gold %d plans %+v", w.Gold, is.Plans)
	}
}
