package content

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// dairyContent is the test-only content with fields on every farm and a
// second animal farm (dairy_farm with its own 2x2 cattle_pasture).
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

// TestLoadFields: farms carry a fields block (type, required, max) and no
// work radius or terrain rule; field buildings are 1x1 crop tiles or 2x2
// animal fields, never pausable, each field type declared once and naming
// its one farm (D-051 part 4).
func TestLoadFields(t *testing.T) {
	c, err := LoadWithSchemas(dairyContent(t), filepath.Join(repoRoot(t), "content", "schema"))
	if err != nil {
		t.Fatal(err)
	}
	type want struct {
		field         string
		required, max int
		size          int
	}
	for farm, w := range map[string]want{
		"sheep_farm": {"pasture", 4, 8, 2}, "dairy_farm": {"cattle_pasture", 4, 8, 2}, "wheat_farm": {"wheat_field", 16, 20, 1},
		"orchard": {"orchard_plot", 16, 20, 1}, "hemp_farm": {"hemp_field", 16, 20, 1},
	} {
		b := c.BuildingByID[farm]
		if b.Fields == nil || b.Fields.Type != w.field || b.Fields.Required != w.required || b.Fields.Max != w.max {
			t.Errorf("%s fields %+v", farm, b.Fields)
		}
		if wa := b.WorkArea; wa != nil && (wa.Radius != 0 || len(wa.Terrain) != 0 || wa.RequiredTiles != 0) {
			t.Errorf("%s work area %+v", farm, wa)
		}
		fb := c.FieldByType[w.field]
		if fb == nil || fb.ID != w.field || fb.Field.Type != w.field || fb.Field.Farm != farm || !fb.Field.MatchesTerrain("grass") || fb.Field.MatchesTerrain("forest") ||
			fb.Width != w.size || fb.Height != w.size || fb.UpkeepPerMin != 0 || fb.PauseCategory != "never" || fb.RequiresRoad || fb.Recipe != nil {
			t.Errorf("field %s = %+v", w.field, fb)
		}
		fert := ""
		if b.WorkArea != nil {
			fert = b.WorkArea.Fertility
		}
		if fert != fb.Field.Fertility {
			t.Errorf("%s fertility %q, field %s %q", farm, fert, w.field, fb.Field.Fertility)
		}
	}
	if lj := c.BuildingByID["lumberjack"]; lj.Fields != nil || lj.WorkArea.Radius != 4 || lj.WorkArea.RequiredTiles != 24 || !lj.WorkArea.MatchesTerrain("forest") {
		t.Errorf("lumberjack %+v", lj.WorkArea)
	}
}

// TestLoadRejectsInvalidFields covers the schema and loader rules of the
// fields and field blocks.
func TestLoadRejectsInvalidFields(t *testing.T) {
	schemaDir := filepath.Join(repoRoot(t), "content", "schema")
	const pasture = `"field": { "type": "pasture", "farm": "sheep_farm", "terrain": ["grass"] }`
	tests := []struct {
		name    string
		replace []string
		want    []string
	}{
		{
			"farm with fields and terrain",
			[]string{`"work_area": { "fertility": "wheat" }`, `"work_area": { "fertility": "wheat", "terrain": ["grass"] }`},
			[]string{FileBuildings, `building "wheat_farm"`, "schema violation"},
		},
		{
			"farm with fields and required tiles",
			[]string{`"work_area": { "fertility": "hemp" }`, `"work_area": { "fertility": "hemp", "required_tiles": 24 }`},
			[]string{FileBuildings, `building "hemp_farm"`, "schema violation"},
		},
		{
			"farm with fields and a work radius",
			[]string{`"work_area": { "fertility": "apple" }`, `"work_area": { "radius": 4, "fertility": "apple" }`},
			[]string{FileBuildings, `building "orchard"`, "schema violation"},
		},
		{
			"fields without max",
			[]string{`"fields": { "type": "hemp_field", "required": 16, "max": 20 }`, `"fields": { "type": "hemp_field", "required": 16 }`},
			[]string{FileBuildings, `building "hemp_farm"`, "schema violation"},
		},
		{
			"fields max below required",
			[]string{`"fields": { "type": "hemp_field", "required": 16, "max": 20 }`, `"fields": { "type": "hemp_field", "required": 16, "max": 15 }`},
			[]string{FileBuildings, `building "hemp_farm"`, "fields.max", "must be >= fields.required"},
		},
		{
			"work area without fields needs terrain",
			[]string{`"work_area": { "radius": 4, "terrain": ["forest"], "required_tiles": 24 }`, `"work_area": { "radius": 4 }`},
			[]string{FileBuildings, `building "lumberjack"`, "schema violation"},
		},
		{
			"work area without fields needs a radius",
			[]string{`"work_area": { "radius": 4, "terrain": ["forest"], "required_tiles": 24 }`, `"work_area": { "terrain": ["forest"], "required_tiles": 24 }`},
			[]string{FileBuildings, `building "lumberjack"`, "schema violation"},
		},
		{
			"field 3x3",
			[]string{`"id": "orchard_plot",
    "name": "Orchard plot",
    "region": "old_coast",
    "tier": "citizens",
    "footprint": [1, 1],`, `"id": "orchard_plot",
    "name": "Orchard plot",
    "region": "old_coast",
    "tier": "citizens",
    "footprint": [3, 3],`},
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
    "cost": { "gold": 15, "planks": 2 },
    "upkeep_per_min": 0,
    "pause_category": "never",
    ` + pasture, `"requires_road": true,
    "cost": { "gold": 15, "planks": 2 },
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
			"field without a farm",
			[]string{`"field": { "type": "pasture", "farm": "sheep_farm", "terrain": ["grass"] }`, `"field": { "type": "pasture", "terrain": ["grass"] }`},
			[]string{FileBuildings, `building "pasture"`, "schema violation"},
		},
		{
			"dangling fields type",
			[]string{`"fields": { "type": "hemp_field", "required": 16, "max": 20 }`, `"fields": { "type": "hop_field", "required": 16, "max": 20 }`},
			[]string{FileBuildings, `building "hemp_farm"`, "fields.type", `no building with a field block of type "hop_field"`},
		},
		{
			"field names an unknown farm",
			[]string{`"field": { "type": "hemp_field", "farm": "hemp_farm",`, `"field": { "type": "hemp_field", "farm": "hop_farm",`},
			[]string{FileBuildings, `building "hemp_field"`, "field.farm", `"hop_farm" is not a farm with a fields block`},
		},
		{
			"field names a building that is no farm",
			[]string{`"field": { "type": "hemp_field", "farm": "hemp_farm",`, `"field": { "type": "hemp_field", "farm": "lumberjack",`},
			[]string{FileBuildings, `building "hemp_field"`, "field.farm", `"lumberjack" is not a farm with a fields block`},
		},
		{
			"field shared by two farms: the second farm's field type",
			[]string{`"fields": { "type": "cattle_pasture", "required": 4, "max": 8 }`, `"fields": { "type": "pasture", "required": 4, "max": 8 }`},
			[]string{FileBuildings, `building "dairy_farm"`, "fields.type", `field type "pasture" belongs to farm "sheep_farm"`},
		},
		{
			"field of another farm type",
			[]string{`"field": { "type": "cattle_pasture", "farm": "dairy_farm",`, `"field": { "type": "cattle_pasture", "farm": "sheep_farm",`},
			[]string{FileBuildings, `building "cattle_pasture"`, "field.farm"},
		},
		{
			"duplicate field type",
			[]string{`"field": { "type": "orchard_plot", "farm": "orchard", "terrain": ["grass"], "fertility": "apple" }`, `"field": { "type": "wheat_field", "farm": "orchard", "terrain": ["grass"], "fertility": "apple" }`},
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

// TestShippedFields: the shipped farms need their own fields (CONTENT §7):
// 4 pastures (2x2, 15 gold, no planks: the reference games' plank budget,
// CONTENT §12) for the sheep farm, 16 crop tiles
// (1x1, 5 gold) for the wheat, orchard and hemp farms, at most required + 4;
// each field type belongs to exactly one farm; pig_pen, cattle_pasture and
// meadow are reserved (their farms are not shipped).
func TestShippedFields(t *testing.T) {
	c, err := Load(filepath.Join(repoRoot(t), "content", "old_coast"))
	if err != nil {
		t.Fatal(err)
	}
	type want struct {
		field, tier, fertility string
		required, size         int
	}
	wants := map[string]want{
		"sheep_farm": {"pasture", "settlers", "", 4, 2}, "wheat_farm": {"wheat_field", "citizens", "wheat", 16, 1},
		"orchard": {"orchard_plot", "citizens", "apple", 16, 1}, "hemp_farm": {"hemp_field", "citizens", "hemp", 16, 1},
	}
	farms := 0
	for _, b := range c.Buildings {
		if b.Fields == nil {
			continue
		}
		farms++
		w, ok := wants[b.ID]
		fert := ""
		if b.WorkArea != nil {
			fert = b.WorkArea.Fertility
			if b.WorkArea.Radius != 0 {
				t.Errorf("%s has a work radius", b.ID)
			}
		}
		if !ok || b.Fields.Type != w.field || b.Fields.Required != w.required || b.Fields.Max != w.required+4 || fert != w.fertility {
			t.Errorf("%s fields %+v work area %+v", b.ID, b.Fields, b.WorkArea)
			continue
		}
		f := c.FieldByType[b.Fields.Type]
		wantGold, wantPlanks := int64(5_000), 0
		if w.size == 2 {
			wantGold = 15_000
		}
		if f == nil || f.ID != w.field || f.Tier != w.tier || f.Field.Farm != b.ID || f.Field.Fertility != w.fertility || strings.Join(f.Field.Terrain, ",") != "grass" ||
			f.Width != w.size || f.Height != w.size || f.Cost.Gold != wantGold || len(f.Cost.Materials) != min(wantPlanks, 1) ||
			(wantPlanks > 0 && f.Cost.Materials[0].Amount != int64(wantPlanks)*1000) {
			t.Errorf("%s field %+v", b.ID, f)
		}
	}
	if farms != len(wants) || len(c.FieldByType) != len(wants) {
		t.Errorf("%d farms with fields, %d field types", farms, len(c.FieldByType))
	}
	for _, id := range []string{"pig_pen", "cattle_pasture", "meadow", "dairy_farm", "pig_farm", "apiary"} {
		if c.BuildingByID[id] != nil {
			t.Errorf("%s is shipped", id)
		}
	}
	if lj := c.BuildingByID["lumberjack"]; lj.Fields != nil || lj.WorkArea.Radius != 4 || lj.WorkArea.RequiredTiles != 24 {
		t.Errorf("lumberjack %+v", lj.WorkArea)
	}
}
