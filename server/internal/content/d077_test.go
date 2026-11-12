package content

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

// d077Building reports whether a building is D-077 content: an ornament,
// a military building, the repair crane or the Kontor.
func d077Building(b *Building) bool {
	return b.Category != "" || b.Repairs || b.Unique == UniqueWorld
}

// TestD077Content checks the D-077 buildings and warships (CONTENT §7,
// §8): categories, dormant defence and attack values, paint families,
// shore placement, the Kontor's uniqueness, and that ornaments carry no
// maintenance.
func TestD077Content(t *testing.T) {
	c, err := Load(filepath.Join(repoRoot(t), "content", "old_coast"))
	if err != nil {
		t.Fatal(err)
	}
	type want struct {
		tier, category string
		w, h, defence  int
		paint, shore   bool
	}
	for id, w := range map[string]want{
		"hedge":          {"settlers", CategoryOrnaments, 1, 1, 0, true, false},
		"garden_wall":    {"settlers", CategoryOrnaments, 1, 1, 0, true, false},
		"tree_ornament":  {"settlers", CategoryOrnaments, 1, 1, 0, false, false},
		"flower_bed":     {"settlers", CategoryOrnaments, 1, 1, 0, false, false},
		"well":           {"settlers", CategoryOrnaments, 1, 1, 0, false, false},
		"maypole":        {"citizens", CategoryOrnaments, 2, 2, 0, false, false},
		"pillory":        {"citizens", CategoryOrnaments, 1, 1, 0, false, false},
		"pond":           {"citizens", CategoryOrnaments, 3, 3, 0, false, false},
		"fountain":       {"merchants", CategoryOrnaments, 2, 2, 0, false, false},
		"statue":         {"merchants", CategoryOrnaments, 2, 2, 0, false, false},
		"cemetery":       {"merchants", CategoryOrnaments, 4, 4, 0, false, false},
		"square":         {"merchants", CategoryOrnaments, 1, 1, 0, true, false},
		"harbour_statue": {"merchants", CategoryOrnaments, 2, 2, 0, false, true},
		"gold_statue":    {"patricians", CategoryOrnaments, 3, 3, 0, false, false},
		"city_wall":      {"citizens", CategoryMilitary, 1, 1, 1, true, false},
		"tower":          {"citizens", CategoryMilitary, 2, 2, 5, false, false},
		"gatehouse":      {"citizens", CategoryMilitary, 3, 3, 5, false, false},
		"harbour_tower":  {"merchants", CategoryMilitary, 2, 2, 8, false, true},
		"castle":         {"patricians", CategoryMilitary, 8, 8, 30, false, false},
		"repair_crane":   {"merchants", "", 3, 3, 0, false, true},
		"kontor":         {"patricians", "", 4, 11, 0, false, true},
	} {
		b := c.BuildingByID[id]
		if b == nil {
			t.Errorf("%s missing", id)
			continue
		}
		if b.Tier != w.tier || b.Category != w.category || b.Width != w.w || b.Height != w.h || b.Defence != w.defence ||
			(b.PaintFamily != nil) != w.paint || b.Shore() != w.shore || b.RequiresRoad {
			t.Errorf("%s = %+v, want %+v", id, b, w)
		}
		if b.Category == CategoryOrnaments && (b.UpkeepPerMin != 0 || b.Look != LookCivic) {
			t.Errorf("%s: ornament upkeep %d look %s", id, b.UpkeepPerMin, b.Look)
		}
		if b.Category == CategoryMilitary && (b.UpkeepPerMin == 0 || b.Look != LookCivic) {
			t.Errorf("%s: military upkeep %d look %s", id, b.UpkeepPerMin, b.Look)
		}
	}
	if wall := c.BuildingByID["city_wall"]; wall.UpkeepPerMin != 100 || !wall.PaintFamily.RoadCrossing {
		t.Errorf("city_wall = %+v", wall)
	}
	for _, b := range c.Buildings {
		if b.Gate != (b.ID == "gatehouse") {
			t.Errorf("%s gate %v", b.ID, b.Gate)
		}
	}
	if sq := c.BuildingByID["square"]; sq.PaintFamily.Ground != GroundCobblesFine {
		t.Errorf("square = %+v", sq.PaintFamily)
	}
	if k := c.BuildingByID["kontor"]; k.Unique != UniqueWorld || k.Look != LookHarbour {
		t.Errorf("kontor = %+v", k)
	}
	if rc := c.BuildingByID["repair_crane"]; !rc.Repairs || rc.Look != LookHarbour {
		t.Errorf("repair_crane = %+v", rc)
	}
	for id, w := range map[string]struct {
		attack               int
		speed, gold, length  int64
		planks, sails, tools int64
	}{
		"balinger":    {4, 1300, 800_000, 2_000, 40_000, 15_000, 10_000},
		"war_cog":     {10, 1000, 2_500_000, 2_600, 80_000, 30_000, 20_000},
		"war_carrack": {20, 800, 6_000_000, 3_200, 150_000, 50_000, 40_000},
	} {
		s := c.ShipByID[id]
		if s == nil || !s.Warship() || s.SlotSize != 0 || s.Tier != "patricians" || s.Attack != w.attack || s.SpeedPermille != w.speed ||
			s.Cost.Gold != w.gold || s.LengthMilliTiles != w.length || s.UpkeepPerMin == 0 {
			t.Errorf("%s = %+v, want %+v", id, s, w)
			continue
		}
		got := map[string]Qty{}
		for _, m := range s.Cost.Materials {
			got[m.Good] = m.Amount
		}
		if len(got) != 3 || got["planks"] != w.planks || got["sails"] != w.sails || got["tools"] != w.tools {
			t.Errorf("%s cost %v", id, got)
		}
	}
	for _, s := range c.Ships {
		if s.Warship() != (s.Attack > 0) {
			t.Errorf("%s: warship %v attack %d", s.ID, s.Warship(), s.Attack)
		}
	}
	yard := c.BuildingByID["shipyard"].Shipyard.Ships
	if len(yard) != 6 || yard[3] != "balinger" || yard[5] != "war_carrack" {
		t.Errorf("shipyard ships %v", yard)
	}
}

// TestD077MatchesPlannedModels: every planned D-077 model
// (assets/voxel/planned/d077.json) is content with the planned footprint,
// tier and placement, published (no hold) and in the model manifest.
func TestD077MatchesPlannedModels(t *testing.T) {
	c, err := Load(filepath.Join(repoRoot(t), "content", "old_coast"))
	if err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(filepath.Join(repoRoot(t), "assets", "voxel", "planned", "d077.json"))
	if err != nil {
		t.Fatal(err)
	}
	var planned []struct {
		plannedEntry
		Placement string `json:"placement"`
		Hold      bool   `json:"hold"`
	}
	if err := json.Unmarshal(data, &planned); err != nil {
		t.Fatal(err)
	}
	data, err = os.ReadFile(filepath.Join(repoRoot(t), "client", "public", "models", "manifest.json"))
	if err != nil {
		t.Fatal(err)
	}
	var manifest modelManifest
	if err := json.Unmarshal(data, &manifest); err != nil {
		t.Fatal(err)
	}
	tiers := []string{"", "settlers", "citizens", "merchants", "patricians"}
	for _, p := range planned {
		if p.Hold {
			t.Errorf("%s: still held", p.ID)
		}
		if _, ok := manifest.Models[p.ID]; !ok {
			t.Errorf("%s: not in the model manifest", p.ID)
		}
		if p.Kind == "ship" {
			if s := c.ShipByID[p.ID]; s == nil || s.Tier != tiers[p.Tier] {
				t.Errorf("%s: ship %+v, planned tier %d", p.ID, s, p.Tier)
			}
			continue
		}
		b := c.BuildingByID[p.ID]
		if b == nil || b.Tier != tiers[p.Tier] || b.Width != p.Footprint[0] || b.Height != p.Footprint[1] || b.Placement != p.Placement {
			t.Errorf("%s: content %+v, planned %+v", p.ID, b, p)
		}
	}
}
