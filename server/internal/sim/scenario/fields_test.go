package scenario

import (
	"strings"
	"testing"
)

// fieldsScenario is a small island with a sheep farm at (4,4) (footprint
// x 4..6, y 4..6), a forest tile at (2,5), the Trading Post at (1,0) and
// the given extra steps.
func fieldsScenario(t *testing.T, steps string) (*Report, error) {
	t.Helper()
	s, err := Parse([]byte(`{
		"name": "fields", "start": "2026-01-01T00:00:00Z",
		"island": {"rows": [
			"~~~~~~~~~~~~~~",
			"~~~~~cccccccc~",
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
		"seed": {"trading_post": {"x": 1, "y": 0}, "gold": 10000, "stock": {"planks": 100}},
		"steps": [{"place": {"type": "sheep_farm", "x": 4, "y": 4}}` + steps + `]
	}`))
	if err != nil {
		t.Fatal(err)
	}
	return Run(s, loadCatalogue(t))
}

func farmFields(t *testing.T, rep *Report) (int, int) {
	t.Helper()
	fields, active := 0, -1
	for _, b := range rep.Final.Islands[0].Buildings {
		if b.Type == "pasture" {
			fields++
		}
		if b.Type == "sheep_farm" {
			if b.Fields == nil {
				t.Fatal("farm without fields display")
			}
			active = b.Fields.Active
		}
	}
	if active < 0 {
		t.Fatal("no farm")
	}
	return active, fields
}

// TestFieldsStep: tiles are placed in order and verbatim (each one a
// place_field from the farm covering `farm`); rect places fields where the
// field rule holds, in passes so that a chain grows outwards, up to count
// or the farm's maximum; a failing tile fails the step; expect_error works;
// exactly one of rect and tiles; the farm tile must show a farm.
func TestFieldsStep(t *testing.T) {
	rep, err := fieldsScenario(t, `, {"fields": {"farm": [5, 5], "tiles": [[7, 4], [9, 4]]}}`)
	if err != nil {
		t.Fatal(err)
	}
	if active, n := farmFields(t, rep); active != 2 || n != 2 {
		t.Errorf("tiles: %d active of %d", active, n)
	}
	rep, err = fieldsScenario(t, `, {"fields": {"farm": [4, 4], "rect": [12, 9, 1, 2], "count": 3}}`)
	if err != nil {
		t.Fatal(err)
	}
	if active, n := farmFields(t, rep); active != 3 || n != 3 {
		t.Errorf("count: %d active of %d", active, n)
	}
	// Without a count the rectangle fills up to the maximum (8), growing
	// the chain over several passes.
	rep, err = fieldsScenario(t, `, {"fields": {"farm": [4, 4], "rect": [1, 2, 12, 9]}}`)
	if err != nil {
		t.Fatal(err)
	}
	if active, n := farmFields(t, rep); active != 8 || n != 8 {
		t.Errorf("max: %d active of %d", active, n)
	}
	// A tile that touches nothing fails the whole step and the world stays
	// byte-identical (checked by the runner).
	rep, err = fieldsScenario(t, `, {"fields": {"farm": [4, 4], "tiles": [[10, 8]]}, "expect_error": "field_not_adjacent"}`)
	if err != nil || len(rep.ExpectedErrors) != 1 {
		t.Fatalf("expect_error: %v %+v", err, rep)
	}
	if active, n := farmFields(t, rep); active != 0 || n != 0 {
		t.Errorf("failed command placed %d fields", n)
	}
	for _, tt := range []struct{ steps, want string }{
		{`, {"fields": {"farm": [4, 4], "rect": [11, 8, 12, 9]}}`, "no valid pasture anchor"},
		{`, {"fields": {"farm": [4, 4]}}`, "exactly one of rect and tiles"},
		{`, {"fields": {"farm": [4, 4], "rect": [1, 2, 3, 3], "tiles": [[7, 4]]}}`, "exactly one of rect and tiles"},
		{`, {"fields": {"farm": [4, 4], "tiles": [[7, 4]]}, "expect_error": "field_not_adjacent"}`, "expected field_not_adjacent, step succeeded"},
		{`, {"fields": {"farm": [12, 9], "tiles": [[7, 4]]}}`, "no building at"},
		{`, {"fields": {"farm": [1, 0], "tiles": [[7, 4]]}}`, "is not a farm"},
	} {
		if _, err := fieldsScenario(t, tt.steps); err == nil || !strings.Contains(err.Error(), tt.want) {
			t.Errorf("%s: err = %v, want %q", tt.steps, err, tt.want)
		}
	}
}
