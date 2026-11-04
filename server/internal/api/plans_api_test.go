package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"testing"

	"github.com/ricoberger/new-shores/server/internal/sim"
)

type plansView struct {
	Gold    int64 `json:"gold"`
	Islands []struct {
		Roads     []sim.RoadDisplay        `json:"roads"`
		Buildings []sim.BuildingDisplay    `json:"buildings"`
		Plans     []sim.PlanDisplay        `json:"plans"`
		Planned   []sim.PlannedRoadDisplay `json:"planned_roads"`
	} `json:"islands"`
}

func plansOf(t *testing.T, raw json.RawMessage) plansView {
	t.Helper()
	var v plansView
	if err := json.Unmarshal(raw, &v); err != nil {
		t.Fatal(err)
	}
	return v
}

// TestPlanReasonsAreAPICodes: the reasons of PlanCostDisplay are the
// codes the API returns for the same errors.
func TestPlanReasonsAreAPICodes(t *testing.T) {
	for _, r := range sim.PlanReasons() {
		if code, _ := classify(r.Err); code != r.Code {
			t.Errorf("%v: reason %q, API code %q", r.Err, r.Code, code)
		}
	}
	if code, _ := classify(sim.ErrInvalidCommand); code != sim.PlanReasonInvalid {
		t.Errorf("fallback reason %q, API code %q", sim.PlanReasonInvalid, code)
	}
}

// TestPlansAPI (D-071): the place commands with planned: true make free
// plans that the display lists apart from buildings and roads with
// planned: true and a plan_cost (the cost and the first failing reason);
// a plan reserves its tiles; build_plan builds a road segment by tile, a
// planned farm with its planned fields by ID, and fails with
// tier_locked, plan_not_found or invalid_command without changing the
// world.
func TestPlansAPI(t *testing.T) {
	ts := newTestServer(t, 1)
	before := plansOf(t, ts.getWorld().Display)
	plan := func(cmd string) plansView {
		t.Helper()
		res := ts.command(cmd, nil)
		if res.status != http.StatusOK {
			t.Fatalf("%s: %d %s", cmd, res.status, res.body)
		}
		var w worldJSON
		if err := json.Unmarshal(res.body, &w); err != nil {
			t.Fatal(err)
		}
		return plansOf(t, w.Display)
	}
	plan(`{"type":"place_road","island_id":"start","road_type":"road_dirt","planned":true,"tiles":[{"x":3,"y":4},{"x":4,"y":4},{"x":5,"y":4},{"x":6,"y":4}]}`)
	plan(`{"type":"place_building","island_id":"start","building_type":"sheep_farm","x":14,"y":5,"rotation":0,"planned":true}`)
	plan(`{"type":"place_building","island_id":"start","building_type":"bakery","x":10,"y":5,"rotation":0,"planned":true}`)
	v := plansOf(t, ts.getWorld().Display)
	is := v.Islands[0]
	if v.Gold != before.Gold {
		t.Fatalf("planning charged gold: %d -> %d", before.Gold, v.Gold)
	}
	if len(is.Buildings) != len(before.Islands[0].Buildings) || len(is.Roads) != len(before.Islands[0].Roads) {
		t.Fatal("plans appear as buildings or roads")
	}
	if len(is.Planned) != 1 || len(is.Planned[0].Tiles) != 4 || !is.Planned[0].Planned || is.Planned[0].PlanCost.Reason != "" {
		t.Fatalf("planned roads %+v", is.Planned)
	}
	var farm, bakery int64
	for _, p := range is.Plans {
		if !p.Planned {
			t.Fatalf("plan %+v without planned", p)
		}
		switch p.Type {
		case "sheep_farm":
			farm = p.ID
		case "bakery":
			bakery = p.ID
			if p.PlanCost == nil || p.PlanCost.Reason != "tier_locked" || p.PlanCost.Gold == 0 {
				t.Fatalf("bakery plan cost %+v", p.PlanCost)
			}
		}
	}
	if farm == 0 || bakery == 0 {
		t.Fatalf("plans %+v", is.Plans)
	}

	// Fields of the planned farm, by its plan ID.
	v = plan(fmt.Sprintf(`{"type":"place_fields","island_id":"start","farm_id":%d,"building_type":"pasture","planned":true,"tiles":[{"x":17,"y":5}]}`, farm))
	var farmCost *sim.PlanCostDisplay
	fields := 0
	for _, p := range v.Islands[0].Plans {
		if p.FarmID != nil && *p.FarmID == farm {
			fields++
		}
		if p.ID == farm {
			farmCost = p.PlanCost
		}
	}
	if fields != 1 || farmCost == nil || farmCost.Reason != "" {
		t.Fatalf("planned fields %d, farm cost %+v", fields, farmCost)
	}

	unchanged := ts.getWorld()
	for _, tt := range []struct {
		name, cmd string
		validate  bool
		status    int
		code      string
	}{
		{"reserved by the farm plan", `{"type":"place_building","island_id":"start","building_type":"sawmill","x":15,"y":6,"rotation":0}`, true, http.StatusConflict, "occupied"},
		{"reserved by the planned field", `{"type":"place_building","island_id":"start","building_type":"sawmill","x":18,"y":6,"rotation":0}`, true, http.StatusConflict, "occupied"},
		{"locked tier", fmt.Sprintf(`{"type":"build_plan","island_id":"start","building_id":%d}`, bakery), true, http.StatusConflict, "tier_locked"},
		{"no plan", `{"type":"build_plan","island_id":"start","building_id":999}`, true, http.StatusNotFound, "plan_not_found"},
		{"no planned road", `{"type":"build_plan","island_id":"start","x":3,"y":3}`, true, http.StatusNotFound, "plan_not_found"},
		{"id and tile", fmt.Sprintf(`{"type":"build_plan","island_id":"start","building_id":%d,"x":3,"y":4}`, farm), true, http.StatusBadRequest, "invalid_command"},
		{"missing y", `{"type":"build_plan","island_id":"start","x":3}`, true, http.StatusBadRequest, "invalid_command"},
		{"missing island", `{"type":"build_plan","building_id":1}`, false, http.StatusBadRequest, "invalid_command"},
	} {
		t.Run(tt.name, func(t *testing.T) {
			res := ts.do(http.MethodPost, "/api/v1/world/commands", `{"command":`+tt.cmd+`}`, tt.validate)
			if res.status != tt.status || errorCode(t, res) != tt.code {
				t.Fatalf("%d %s, want %d %s", res.status, res.body, tt.status, tt.code)
			}
			if after := ts.getWorld(); after.Version != unchanged.Version || !bytes.Equal(after.Display, unchanged.Display) {
				t.Fatal("rejected command changed the world")
			}
		})
	}

	// Build the road segment by one of its tiles, then the farm.
	v = plan(`{"type":"build_plan","island_id":"start","x":5,"y":4}`)
	if len(v.Islands[0].Planned) != 0 || len(v.Islands[0].Roads) != len(before.Islands[0].Roads)+4 {
		t.Fatalf("road segment not built: planned %+v", v.Islands[0].Planned)
	}
	v = plan(fmt.Sprintf(`{"type":"build_plan","island_id":"start","building_id":%d}`, farm))
	built := map[string]int{}
	for _, b := range v.Islands[0].Buildings {
		built[b.Type]++
	}
	if built["sheep_farm"] != 1 || built["pasture"] != 1 || len(v.Islands[0].Plans) != 1 || v.Gold >= before.Gold {
		t.Fatalf("farm build: buildings %v, plans %+v, gold %d", built, v.Islands[0].Plans, v.Gold)
	}
	// Demolishing the last plan is free and leaves no plans.
	gold := v.Gold
	v = plan(fmt.Sprintf(`{"type":"demolish","island_id":"start","building_id":%d}`, bakery))
	if len(v.Islands[0].Plans) != 0 || v.Gold != gold {
		t.Fatalf("demolish plan: plans %+v, gold %d -> %d", v.Islands[0].Plans, gold, v.Gold)
	}
}

// TestDemolishRoadsAPI: demolish_roads (the Demolish tool's rectangle)
// removes the roads and planned roads under its tiles in one version and
// reports every tile in tile_results; over no road it answers 200 with the
// unchanged version; duplicates fail as a whole.
func TestDemolishRoadsAPI(t *testing.T) {
	ts := newTestServer(t, 1)
	if res := ts.command(`{"type":"place_road","island_id":"start","road_type":"road_dirt","tiles":[{"x":3,"y":4},{"x":4,"y":4},{"x":5,"y":4}]}`, nil); res.status != http.StatusOK {
		t.Fatalf("road: %d %s", res.status, res.body)
	}
	if res := ts.command(`{"type":"place_road","island_id":"start","road_type":"road_dirt","planned":true,"tiles":[{"x":6,"y":4},{"x":7,"y":4}]}`, nil); res.status != http.StatusOK {
		t.Fatalf("planned road: %d %s", res.status, res.body)
	}
	before := ts.getWorld()
	rect := func(tiles string) string {
		return `{"type":"demolish_roads","island_id":"start","tiles":` + tiles + `}`
	}

	res := ts.do(http.MethodPost, "/api/v1/world/commands", `{"command":`+rect(tileList([2]int{3, 6}, [2]int{4, 6}))+`}`, true)
	var none batchJSON
	if res.status != http.StatusOK || json.Unmarshal(res.body, &none) != nil {
		t.Fatalf("no road: %d %s", res.status, res.body)
	}
	if none.Version != before.Version || len(none.TileResults) != 2 || none.TileResults[0].OK || none.TileResults[0].Reason != "no_road" {
		t.Fatalf("no road: version %d (before %d), results %+v", none.Version, before.Version, none.TileResults)
	}
	res = ts.do(http.MethodPost, "/api/v1/world/commands", `{"command":`+rect(tileList([2]int{4, 4}, [2]int{4, 4}))+`}`, true)
	if res.status != http.StatusBadRequest || errorCode(t, res) != "invalid_command" {
		t.Fatalf("duplicates: %d %s", res.status, res.body)
	}

	tiles := [][2]int{{4, 4}, {5, 4}, {6, 4}, {4, 5}}
	res = ts.command(rect(tileList(tiles...)), nil)
	var b batchJSON
	if res.status != http.StatusOK || json.Unmarshal(res.body, &b) != nil {
		t.Fatalf("rect: %d %s", res.status, res.body)
	}
	if b.Version != before.Version+1 || len(b.TileResults) != 4 || !b.TileResults[0].OK || !b.TileResults[2].OK || b.TileResults[3].Reason != "no_road" {
		t.Fatalf("rect: version %d, results %+v", b.Version, b.TileResults)
	}
	is := plansOf(t, b.Display).Islands[0]
	if len(is.Planned) != 1 || len(is.Planned[0].Tiles) != 1 {
		t.Errorf("planned roads %+v", is.Planned)
	}
	for _, r := range is.Roads {
		if r.Y == 4 && (r.X == 4 || r.X == 5) {
			t.Errorf("road tile (%d,%d) left", r.X, r.Y)
		}
	}
}
