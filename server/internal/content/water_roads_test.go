package content

import (
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

// TestWaterRoadDefaults (D-085 §5): stands_on and replaces are optional.
// A water-edge, shore or coastal building without stands_on stands on the
// quay (DefaultStandsOn, only IDs the catalogue defines), every other
// building on nothing; a road without replaces replaces nothing. In the
// shipped content the rural water-edge buildings stand on the jetty and
// the quay, every other water building on the quay only; the paved road
// replaces the dirt road, the quay the jetty.
func TestWaterRoadDefaults(t *testing.T) {
	c, err := Load(filepath.Join(repoRoot(t), "content", "old_coast"))
	if err != nil {
		t.Fatal(err)
	}
	for _, b := range c.Buildings {
		water := b.WaterRows != nil || b.Shore() || b.Coastal
		if !water && b.StandsOn != nil {
			t.Errorf("%s: land building stands on %v", b.ID, b.StandsOn)
		}
		if water && !slices.Contains(b.StandsOn, "quay") {
			t.Errorf("%s: stands on %v, want the quay among them", b.ID, b.StandsOn)
		}
		if b.Road == nil && b.Replaces != nil {
			t.Errorf("%s: replaces %v without being a road", b.ID, b.Replaces)
		}
	}
	for _, b := range c.Buildings {
		want := []string{"quay"}
		switch b.ID {
		case "fisher", "salt_pans", "oyster_beds":
			want = []string{"jetty", "quay"}
		}
		if (b.WaterRows != nil || b.Shore() || b.Coastal) && !slices.Equal(b.StandsOn, want) {
			t.Errorf("%s stands on %v, want %v", b.ID, b.StandsOn, want)
		}
	}
	if r := c.BuildingByID["quay"].Replaces; !slices.Equal(r, []string{"jetty"}) {
		t.Errorf("quay replaces %v", r)
	}
	if r := c.BuildingByID["jetty"].Replaces; r != nil {
		t.Errorf("jetty replaces %v", r)
	}
	if r := c.BuildingByID["road_paved"].Replaces; !slices.Equal(r, []string{"road_dirt"}) {
		t.Errorf("road_paved replaces %v", r)
	}
	if r := c.BuildingByID["road_dirt"].Replaces; r != nil {
		t.Errorf("road_dirt replaces %v", r)
	}

	// Content without a quay: the default keeps only defined IDs.
	old, err := LoadWithSchemas(filepath.Join(repoRoot(t), "server", "testdata", "content", "old_coast_pre_d054"), filepath.Join(repoRoot(t), "content", "schema"))
	if err != nil {
		t.Fatal(err)
	}
	if f := old.BuildingByID["fisher"]; f.StandsOn == nil || len(f.StandsOn) != 0 || f.StandsOnRoad("quay") {
		t.Errorf("pre-D-054 fisher stands on %#v", f.StandsOn)
	}
}

// TestLoadRejectsInvalidWaterRoads covers the schema and loader rules of
// stands_on and replaces (D-085).
func TestLoadRejectsInvalidWaterRoads(t *testing.T) {
	schemaDir := filepath.Join(repoRoot(t), "content", "schema")
	const fisherRows = `"water_rows": { "min": 2, "max": 6 },`
	const fisherOn = `"stands_on": ["jetty", "quay"],` // the fisher is the first
	const dirt = `"road": { "seconds_per_tile": 1.0 }`
	tests := []struct {
		name    string
		replace []string
		want    []string
	}{
		{
			"stands_on on a land building",
			[]string{`"name": "Lumberjack",`, `"name": "Lumberjack", "stands_on": ["quay"],`},
			[]string{`building "lumberjack"`, "stands_on", "water_rows or shore placement"},
		},
		{
			"stands_on a land road",
			[]string{fisherOn, `"stands_on": ["road_dirt"],`},
			[]string{`building "fisher"`, "stands_on[0]", `"road_dirt" is not a water road`},
		},
		{
			"stands_on an unknown building",
			[]string{fisherOn, `"stands_on": ["pontoon"],`},
			[]string{`building "fisher"`, "stands_on[0]", `unknown building "pontoon"`},
		},
		{
			"empty stands_on",
			[]string{fisherOn, `"stands_on": [],`},
			[]string{`building "fisher"`, "schema violation"},
		},
		{
			"replaces on a non-road",
			[]string{fisherRows, fisherRows + ` "replaces": ["road_dirt"],`},
			[]string{`building "fisher"`, "replaces", "only a road replaces roads"},
		},
		{
			"replaces across classes",
			[]string{`"replaces": ["jetty"]`, `"replaces": ["road_dirt"]`},
			[]string{`building "quay"`, "replaces[0]", "same class"},
		},
		{
			"replaces itself",
			[]string{`"replaces": ["road_dirt"]`, `"replaces": ["road_paved"]`},
			[]string{`building "road_paved"`, "replaces[0]", "cannot replace itself"},
		},
		{
			"replaces cycle",
			[]string{dirt, dirt + `, "replaces": ["road_paved"]`},
			[]string{"replaces", "cycle"},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			dir := copyContent(t, FileBuildings, tt.replace...)
			_, err := LoadWithSchemas(dir, schemaDir)
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

// TestJettyContent pins D-085 §1: the jetty is a Settlers 1x1 water road
// (road.shallows like the quay) for 3 gold and 1 plank, no upkeep, never
// paused, with the rural look; English "Jetty", German "Steg".
func TestJettyContent(t *testing.T) {
	c, err := Load(filepath.Join(repoRoot(t), "content", "old_coast"))
	if err != nil {
		t.Fatal(err)
	}
	j := c.BuildingByID["jetty"]
	if j == nil || j.Tier != "settlers" || j.Width != 1 || j.Height != 1 || j.Road == nil || !j.Road.Shallows ||
		j.Cost.Gold != 3_000 || len(j.Cost.Materials) != 1 || j.Cost.Materials[0] != (GoodAmount{Good: "planks", Amount: 1_000}) ||
		j.UpkeepPerMin != 0 || j.PauseCategory != "never" || j.Look != LookRural || j.Coastal || j.RequiresRoad || j.Name != "Jetty" {
		t.Fatalf("jetty = %+v", j)
	}
	if got := c.Translate("de", TextKey("buildings", "jetty", "name"), j.Name); got != "Steg" {
		t.Errorf("jetty de = %q", got)
	}
	// The jetty is the only Settlers water road; the quay stays Citizens.
	if q := c.BuildingByID["quay"]; q.Tier != "citizens" {
		t.Errorf("quay tier %s", q.Tier)
	}
}
