package scenario

import (
	"strings"
	"testing"
)

// fieldsScenario is a small island with a sheep farm at (4,4) (radius 4
// around the doubled centre (11,11)), a forest tile at (2,5) and the
// given extra steps.
func fieldsScenario(t *testing.T, steps string) (*Report, error) {
	t.Helper()
	s, err := Parse([]byte(`{
		"name": "fields", "start": "2026-01-01T00:00:00Z",
		"island": {"rows": [
			"~~~~~~~~~~~~~~",
			"~cccccccccccc~",
			"~............~",
			"~............~",
			"~............~",
			"~.f..........~",
			"~............~",
			"~............~",
			"~............~",
			"~............~",
			"~~~~~~~~~~~~~~"
		]},
		"seed": {"warehouse": {"x": 1, "y": 1}, "gold": 10000, "stock": {"planks": 100}},
		"steps": [{"place": {"type": "sheep_farm", "x": 4, "y": 4}}` + steps + `]
	}`))
	if err != nil {
		t.Fatal(err)
	}
	return Run(s, loadCatalogue(t))
}

func farmFields(t *testing.T, rep *Report) (int, int) {
	t.Helper()
	fields, assigned := 0, -1
	for _, b := range rep.Final.Islands[0].Buildings {
		if b.Type == "pasture" {
			fields++
		}
		if b.Type == "sheep_farm" {
			if b.Fields == nil {
				t.Fatal("farm without fields display")
			}
			assigned = b.Fields.Assigned
		}
	}
	if assigned < 0 {
		t.Fatal("no farm")
	}
	return assigned, fields
}

// TestFieldsStep (R-16): rect places a field on every valid tile of the
// inclusive rectangle (any corner order), skipping the farm, forest and
// tiles outside the radius; tiles are sent verbatim; a rect without a
// valid tile fails; expect_error works; exactly one of rect and tiles.
func TestFieldsStep(t *testing.T) {
	// Rows 2..3, columns 1..12, reversed corners: the radius covers x 3..7
	// in row 2 ((2x+1-11)^2 + 36 <= 64) and x 2..8 in row 3
	// ((2x+1-11)^2 + 16 <= 64); the warehouse covers x 1..4.
	rep, err := fieldsScenario(t, `, {"fields": {"type": "pasture", "rect": [12, 3, 1, 2]}}`)
	if err != nil {
		t.Fatal(err)
	}
	if assigned, n := farmFields(t, rep); assigned != 7 || n != 7 {
		t.Errorf("rect: %d assigned of %d", assigned, n)
	}
	rep, err = fieldsScenario(t, `, {"fields": {"type": "pasture", "tiles": [[3, 5], [3, 6]]}}`)
	if err != nil {
		t.Fatal(err)
	}
	if assigned, _ := farmFields(t, rep); assigned != 2 {
		t.Errorf("tiles: %d assigned", assigned)
	}
	// The forest tile in the tile list fails the whole command.
	rep, err = fieldsScenario(t, `, {"fields": {"type": "pasture", "tiles": [[3, 5], [2, 5]]}, "expect_error": "terrain"}`)
	if err != nil || len(rep.ExpectedErrors) != 1 {
		t.Fatalf("expect_error: %v %+v", err, rep)
	}
	if assigned, n := farmFields(t, rep); assigned != 0 || n != 0 {
		t.Errorf("failed command placed %d fields", n)
	}
	for _, tt := range []struct{ steps, want string }{
		{`, {"fields": {"type": "pasture", "rect": [11, 8, 12, 9]}}`, "no valid pasture tile"},
		{`, {"fields": {"type": "pasture"}}`, "exactly one of rect and tiles"},
		{`, {"fields": {"type": "pasture", "rect": [1, 2, 3, 3], "tiles": [[3, 5]]}}`, "exactly one of rect and tiles"},
		{`, {"fields": {"type": "pasture", "tiles": [[3, 5]]}, "expect_error": "no_farm_in_range"}`, "expected no_farm_in_range, step succeeded"},
		{`, {"demolish_fields": {"tiles": [[5, 5]]}}`, "not a field"},
	} {
		if _, err := fieldsScenario(t, tt.steps); err == nil || !strings.Contains(err.Error(), tt.want) {
			t.Errorf("%s: err = %v, want %q", tt.steps, err, tt.want)
		}
	}
	rep, err = fieldsScenario(t, `, {"fields": {"type": "pasture", "tiles": [[3, 5], [3, 6]]}}, {"demolish_fields": {"tiles": [[3, 6]]}}`)
	if err != nil {
		t.Fatal(err)
	}
	if assigned, n := farmFields(t, rep); assigned != 1 || n != 1 {
		t.Errorf("after demolish: %d of %d", assigned, n)
	}
}
