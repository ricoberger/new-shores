package content

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// dairyContent is the test-only content with explicit fields on every farm
// and a second farm (dairy_farm) that shares the pasture field type.
func dairyContent(t *testing.T) string {
	t.Helper()
	return filepath.Join(repoRoot(t), "server", "testdata", "content", "old_coast_dairy")
}

// copyDir copies the content directory src into a temporary directory and
// applies replace (old -> new pairs, each must match once) to file.
func copyDir(t *testing.T, src, file string, replace ...string) string {
	t.Helper()
	dst := t.TempDir()
	entries, err := os.ReadDir(src)
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range entries {
		data, err := os.ReadFile(filepath.Join(src, e.Name())) // #nosec G304 -- test fixture path.
		if err != nil {
			t.Fatal(err)
		}
		if e.Name() == file {
			s := string(data)
			for i := 0; i+1 < len(replace); i += 2 {
				if strings.Count(s, replace[i]) != 1 {
					t.Fatalf("%s does not contain %q exactly once", file, replace[i])
				}
				s = strings.Replace(s, replace[i], replace[i+1], 1)
			}
			data = []byte(s)
		}
		if err := os.WriteFile(filepath.Join(dst, e.Name()), data, 0o600); err != nil { // #nosec G703 -- test temp dir and fixture names.
			t.Fatal(err)
		}
	}
	return dst
}

// TestLoadFields: farms carry a fields block and a work radius without
// terrain rule; field buildings are 1x1 never-pausable placeables, each
// field type declared once and accepted by a farm (D-049).
func TestLoadFields(t *testing.T) {
	c, err := LoadWithSchemas(dairyContent(t), filepath.Join(repoRoot(t), "content", "schema"))
	if err != nil {
		t.Fatal(err)
	}
	for farm, field := range map[string]string{"sheep_farm": "pasture", "dairy_farm": "pasture", "wheat_farm": "wheat_field", "orchard": "orchard_plot", "hemp_farm": "hemp_field"} {
		b := c.BuildingByID[farm]
		if b.Fields == nil || b.Fields.Type != field || b.Fields.Required != 16 || b.WorkArea == nil || b.WorkArea.Radius != 4 ||
			len(b.WorkArea.Terrain) != 0 || b.WorkArea.RequiredTiles != 0 {
			t.Errorf("%s fields %+v work area %+v", farm, b.Fields, b.WorkArea)
		}
		fb := c.FieldByType[field]
		if fb == nil || fb.ID != field || fb.Field.Type != field || !fb.Field.MatchesTerrain("grass") || fb.Field.MatchesTerrain("forest") ||
			fb.Width != 1 || fb.Height != 1 || fb.UpkeepPerMin != 0 || fb.PauseCategory != "never" || fb.RequiresRoad || fb.Recipe != nil {
			t.Errorf("field %s = %+v", field, fb)
		}
		if b.WorkArea.Fertility != fb.Field.Fertility {
			t.Errorf("%s fertility %q, field %s %q", farm, b.WorkArea.Fertility, field, fb.Field.Fertility)
		}
	}
	if lj := c.BuildingByID["lumberjack"]; lj.Fields != nil || lj.WorkArea.RequiredTiles != 24 || !lj.WorkArea.MatchesTerrain("forest") {
		t.Errorf("lumberjack %+v", lj.WorkArea)
	}
}

// TestLoadRejectsInvalidFields covers the schema and loader rules of the
// fields and field blocks.
func TestLoadRejectsInvalidFields(t *testing.T) {
	schemaDir := filepath.Join(repoRoot(t), "content", "schema")
	const pasture = `"field": { "type": "pasture", "terrain": ["grass"] }`
	tests := []struct {
		name    string
		replace []string
		want    []string
	}{
		{
			"farm with fields and terrain",
			[]string{`"work_area": { "radius": 4, "fertility": "wheat" }`, `"work_area": { "radius": 4, "fertility": "wheat", "terrain": ["grass"] }`},
			[]string{FileBuildings, `building "wheat_farm"`, "schema violation"},
		},
		{
			"farm with fields and required tiles",
			[]string{`"work_area": { "radius": 4, "fertility": "hemp" }`, `"work_area": { "radius": 4, "fertility": "hemp", "required_tiles": 24 }`},
			[]string{FileBuildings, `building "hemp_farm"`, "schema violation"},
		},
		{
			"farm with fields without work radius",
			[]string{`"work_area": { "radius": 4, "fertility": "apple" },`, ``},
			[]string{FileBuildings, `building "orchard"`, "schema violation"},
		},
		{
			"work area without fields needs terrain",
			[]string{`"work_area": { "radius": 4, "terrain": ["forest"], "required_tiles": 24 }`, `"work_area": { "radius": 4 }`},
			[]string{FileBuildings, `building "lumberjack"`, "schema violation"},
		},
		{
			"field 2x2",
			[]string{`"id": "orchard_plot",
    "name": "Orchard plot",
    "region": "old_coast",
    "tier": "citizens",
    "footprint": [1, 1],`, `"id": "orchard_plot",
    "name": "Orchard plot",
    "region": "old_coast",
    "tier": "citizens",
    "footprint": [2, 2],`},
			[]string{FileBuildings, `building "orchard_plot"`, "schema violation"},
		},
		{
			"field with upkeep",
			[]string{`"upkeep_per_min": 0,
    "pause_category": "never",
    ` + pasture, `"upkeep_per_min": 1,
    "pause_category": "intermediate",
    ` + pasture},
			[]string{FileBuildings, `building "pasture"`, "schema violation"},
		},
		{
			"pausable field",
			[]string{`"pause_category": "never",
    ` + pasture, `"pause_category": "intermediate",
    ` + pasture},
			[]string{FileBuildings, `building "pasture"`, "schema violation"},
		},
		{
			"field requires a road",
			[]string{`"requires_road": false,
    "cost": { "gold": 0 },
    "upkeep_per_min": 0,
    "pause_category": "never",
    ` + pasture, `"requires_road": true,
    "cost": { "gold": 0 },
    "upkeep_per_min": 0,
    "pause_category": "never",
    ` + pasture},
			[]string{FileBuildings, `building "pasture"`, "schema violation"},
		},
		{
			"field with a recipe",
			[]string{pasture, pasture + `,
    "recipe": { "inputs": [], "outputs": [{ "good": "wool", "amount": 1 }], "cycle_seconds": 60 }`},
			[]string{FileBuildings, `building "pasture"`, "schema violation"},
		},
		{
			"dangling fields type",
			[]string{`"fields": { "type": "hemp_field", "required": 16 }`, `"fields": { "type": "hop_field", "required": 16 }`},
			[]string{FileBuildings, `building "hemp_farm"`, "fields.type", `no building with a field block of type "hop_field"`},
		},
		{
			"field type accepted by no farm",
			[]string{`"field": { "type": "hemp_field", "terrain": ["grass"], "fertility": "hemp" }`, `"field": { "type": "meadow", "terrain": ["grass"], "fertility": "hemp" }`},
			[]string{FileBuildings, `building "hemp_field"`, "field.type", `field type "meadow" is accepted by no farm`},
		},
		{
			"duplicate field type",
			[]string{`"field": { "type": "orchard_plot", "terrain": ["grass"], "fertility": "apple" }`, `"field": { "type": "wheat_field", "terrain": ["grass"], "fertility": "apple" }`},
			[]string{FileBuildings, `building "orchard_plot"`, "field.type", `field type "wheat_field" already declared by building "wheat_field"`},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			dir := copyDir(t, dairyContent(t), FileBuildings, tt.replace...)
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
