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
// building on nothing; a road without replaces replaces nothing. The
// paved road replaces the dirt road in the shipped content.
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
			[]string{fisherRows, fisherRows + ` "stands_on": ["road_dirt"],`},
			[]string{`building "fisher"`, "stands_on[0]", `"road_dirt" is not a water road`},
		},
		{
			"stands_on an unknown building",
			[]string{fisherRows, fisherRows + ` "stands_on": ["pontoon"],`},
			[]string{`building "fisher"`, "stands_on[0]", `unknown building "pontoon"`},
		},
		{
			"empty stands_on",
			[]string{fisherRows, fisherRows + ` "stands_on": [],`},
			[]string{`building "fisher"`, "schema violation"},
		},
		{
			"replaces on a non-road",
			[]string{fisherRows, fisherRows + ` "replaces": ["road_dirt"],`},
			[]string{`building "fisher"`, "replaces", "only a road replaces roads"},
		},
		{
			"replaces across classes",
			[]string{`"road": { "seconds_per_tile": 0.6, "shallows": true }`, `"road": { "seconds_per_tile": 0.6, "shallows": true }, "replaces": ["road_dirt"]`},
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
