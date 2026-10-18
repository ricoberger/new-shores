package content

import (
	"encoding/json"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

// repoRoot returns the repository root independent of the working directory.
func repoRoot(t *testing.T) string {
	t.Helper()
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller failed")
	}
	// file = <root>/server/internal/content/content_test.go
	return filepath.Join(filepath.Dir(file), "..", "..", "..")
}

func TestLoadOldCoast(t *testing.T) {
	c, err := Load(filepath.Join(repoRoot(t), "content", "old_coast"))
	if err != nil {
		t.Fatalf("Load: %v", err)
	}

	if c.Region.ID != "old_coast" || c.Region.Version == "" {
		t.Errorf("region = %+v", c.Region)
	}
	rules := c.Region.Rules
	if rules.TransferBaseMs != 10_000 || rules.UnconnectedBuffer != 5_000 || rules.IterationCap != 10_000 || rules.CoarseStepMs != 60_000 {
		t.Errorf("rules = %+v", rules)
	}

	wantIDs := func(kind string, got []string, want ...string) {
		t.Helper()
		if strings.Join(got, ",") != strings.Join(want, ",") {
			t.Errorf("%s IDs = %v, want %v", kind, got, want)
		}
	}
	var ids []string
	for _, g := range c.Goods {
		ids = append(ids, g.ID)
	}
	wantIDs("goods", ids, "wood", "planks", "fish", "wool", "wool_garments")
	ids = nil
	for _, b := range c.Buildings {
		ids = append(ids, b.ID)
	}
	wantIDs("buildings", ids, "house_settlers", "road_dirt", "warehouse", "market_small", "chapel",
		"lumberjack", "sawmill", "fisher", "sheep_farm", "weaver_wool")
	ids = nil
	for _, tr := range c.Tiers {
		ids = append(ids, tr.ID)
	}
	wantIDs("tiers", ids, "settlers")
	if _, ok := c.GoodByID["stone"]; ok {
		t.Error("stone must not exist in tier-1 content")
	}

	settlers := c.TierByID["settlers"]
	if settlers.ResidentsFloor != 2000 || settlers.ResidentsMax != 8000 || settlers.TaxPerResidentPerMin != 50 || settlers.House != "house_settlers" {
		t.Errorf("settlers = %+v", settlers)
	}

	// Spot-check numbers copied from CONTENT.md (converted to fixed point).
	type costs struct {
		gold, planks, upkeep int64
		w, h                 int
		pause                string
	}
	want := map[string]costs{
		"house_settlers": {0, 10_000, 0, 2, 2, "never"},
		"road_dirt":      {0, 0, 0, 1, 1, "never"},
		"warehouse":      {200_000, 30_000, 4_000, 4, 3, "never"},
		"market_small":   {150_000, 15_000, 3_000, 3, 3, "never"},
		"chapel":         {300_000, 15_000, 3_000, 2, 2, "never"},
		"lumberjack":     {50_000, 5_000, 1_000, 2, 2, "intermediate"},
		"sawmill":        {80_000, 8_000, 2_000, 2, 2, "intermediate"},
		"fisher":         {60_000, 6_000, 1_000, 2, 2, "food_basic"},
		"sheep_farm":     {100_000, 10_000, 2_000, 3, 3, "intermediate"},
		"weaver_wool":    {120_000, 10_000, 2_000, 2, 2, "need_goods"},
	}
	for id, w := range want {
		b := c.BuildingByID[id]
		var planks int64
		for _, m := range b.Cost.Materials {
			if m.Good != "planks" {
				t.Errorf("%s: unexpected material %s", id, m.Good)
			}
			planks = m.Amount
		}
		if b.Cost.Gold != w.gold || planks != w.planks || b.UpkeepPerMin != w.upkeep || b.Width != w.w || b.Height != w.h || b.PauseCategory != w.pause {
			t.Errorf("%s = gold %d planks %d upkeep %d %dx%d %s, want %+v", id, b.Cost.Gold, planks, b.UpkeepPerMin, b.Width, b.Height, b.PauseCategory, w)
		}
	}

	lj := c.BuildingByID["lumberjack"]
	if lj.Recipe.CycleMs != 30_000 || lj.Recipe.Outputs[0] != (GoodAmount{"wood", 1000}) || len(lj.Recipe.Inputs) != 0 {
		t.Errorf("lumberjack recipe = %+v", lj.Recipe)
	}
	if lj.WorkArea == nil || lj.WorkArea.Radius != 4 || lj.WorkArea.RequiredTiles != 24 || !lj.WorkArea.MatchesTerrain("forest") {
		t.Errorf("lumberjack work area = %+v", lj.WorkArea)
	}
	if c.BuildingByID["fisher"].Recipe.CycleMs != 40_000 || !c.BuildingByID["fisher"].Coastal {
		t.Error("fisher recipe/coastal mismatch")
	}
	wh := c.BuildingByID["warehouse"].Warehouse
	if wh == nil || wh.Levels[0] != (WarehouseLevel{Capacity: 300_000, ThroughputPerMin: 60_000}) {
		t.Errorf("warehouse = %+v", wh)
	}
	if c.BuildingByID["road_dirt"].Road.MsPerTile != 1000 {
		t.Error("road_dirt seconds_per_tile")
	}
	if c.BuildingByID["market_small"].Service.Radius != 12 || c.BuildingByID["chapel"].Service.Radius != 16 {
		t.Error("service radii")
	}

	needs := c.NeedsByTier["settlers"]
	if len(needs) != 3 || needs[0].Good != "fish" || needs[0].PerResidentPerMin != 10 || needs[0].Weight != 500_000 ||
		needs[1].Good != "wool_garments" || needs[1].PerResidentPerMin != 5 ||
		needs[2].Building != "market_small" || needs[2].Radius != 12 || needs[2].Weight != 300_000 {
		t.Errorf("needs = %+v %+v %+v", needs[0], needs[1], needs[2])
	}
}

func TestLoadBrokenFixtures(t *testing.T) {
	schemaDir := filepath.Join(repoRoot(t), "content", "schema")
	tests := []struct {
		dir  string
		want []string
	}{
		{"broken_dangling_good", []string{"buildings.json", `building "sawmill"`, "recipe.inputs[0].good", `unknown good "woood"`}},
		{"broken_dangling_building_need", []string{"needs.json", `need "settlers_market_small"`, "building", `unknown building "market_grand"`}},
		{"broken_negative_cycle", []string{"buildings.json", `building "lumberjack"`, "recipe.cycle_seconds", "schema violation"}},
		{"broken_duplicate_id", []string{"goods.json", `good "wood"`, "duplicate ID"}},
		{"broken_weights_sum", []string{"needs.json", `tier "settlers"`, "weight"}},
	}
	for _, tt := range tests {
		t.Run(tt.dir, func(t *testing.T) {
			_, err := LoadWithSchemas(filepath.Join(repoRoot(t), "server", "internal", "content", "testdata", tt.dir), schemaDir)
			if err == nil {
				t.Fatal("Load succeeded, want error")
			}
			for _, w := range tt.want {
				if !strings.Contains(err.Error(), w) {
					t.Errorf("error %q does not contain %q", err, w)
				}
			}
		})
	}
}

func TestParseFixed(t *testing.T) {
	tests := []struct {
		in      string
		places  int
		want    int64
		wantErr bool
	}{
		{"0.05", 3, 50, false},
		{"0.010", 3, 10, false},
		{"1.0", 3, 1000, false},
		{"300", 3, 300_000, false},
		{"-30", 3, -30_000, false},
		{"0.3", 6, 300_000, false},
		{"0.0001", 3, 0, true},
		{"1e3", 3, 0, true},
	}
	for _, tt := range tests {
		got, err := ParseFixed(json.Number(tt.in), tt.places)
		if (err != nil) != tt.wantErr || got != tt.want {
			t.Errorf("ParseFixed(%q, %d) = %d, %v; want %d, err %v", tt.in, tt.places, got, err, tt.want, tt.wantErr)
		}
	}
}
