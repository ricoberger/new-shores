package content

import (
	"path/filepath"
	"strings"
	"testing"
)

// TestLoadIslands checks the shipped generator rules (islands.json,
// island_names.json; D-053, CONTENT §9).
func TestLoadIslands(t *testing.T) {
	c, err := Load(filepath.Join(repoRoot(t), "content", "old_coast"))
	if err != nil {
		t.Fatal(err)
	}
	r := c.Islands
	want := map[string]struct {
		size     int
		count    Range
		rock     bool
		deposits Range
	}{
		"large":  {192, Range{3, 3}, false, Range{0, 4}},
		"medium": {112, Range{5, 5}, false, Range{0, 4}},
		"small":  {64, Range{4, 4}, false, Range{0, 4}},
		"rock":   {16, Range{0, 2}, true, Range{2, 4}},
	}
	if len(r.SizeClasses) != len(want) {
		t.Fatalf("size classes = %d, want %d", len(r.SizeClasses), len(want))
	}
	for _, sc := range r.SizeClasses {
		w, ok := want[sc.ID]
		if !ok || sc.Size != w.size || sc.Count != w.count || sc.Rock != w.rock || sc.Deposits != w.deposits {
			t.Errorf("size class %+v, want %+v", sc, w)
		}
		if !sc.Rock && sc.Fertilities != (Range{2, 4}) {
			t.Errorf("%s fertilities = %+v, want 2-4", sc.ID, sc.Fertilities)
		}
	}
	for _, d := range r.Deposits {
		if (d.ID == "stone" && d.Count.Min < 3) || (d.ID == "iron" && d.Count.Min < 2) {
			t.Errorf("deposit %+v below the D-053 minimum", d)
		}
	}
	if r.SpacingMin != 100 || r.NearestMax != 300 || r.BuildableTarget != 91_000 || r.BuildableTolerance != 100 || r.Home.SizeClass != "large" {
		t.Errorf("rules = %+v", r)
	}
	if len(c.IslandNames) < 40 {
		t.Errorf("%d island names, want >= 40", len(c.IslandNames))
	}
	for _, n := range c.IslandNames {
		if len(strings.Fields(n)) != 2 {
			t.Errorf("island name %q is not two words", n)
		}
	}
}

func TestCheckIslandName(t *testing.T) {
	for _, ok := range []string{"A", "Gull Rest", "Cobbler's Reach", "Ærø Holm", strings.Repeat("x", 24)} {
		if err := CheckIslandName(ok); err != nil {
			t.Errorf("%q: %v", ok, err)
		}
	}
	for _, bad := range []string{"", " Gull", "Gull ", "a\tb", "a\x00b", "a\u200bb", strings.Repeat("x", 25), "\xff"} {
		if err := CheckIslandName(bad); err == nil {
			t.Errorf("%q accepted", bad)
		}
	}
}

// TestLoadRejectsUnsatisfiableIslands covers the satisfiability checks of
// the loader (CONTENT §9).
func TestLoadRejectsUnsatisfiableIslands(t *testing.T) {
	schemaDir := filepath.Join(repoRoot(t), "content", "schema")
	tests := []struct {
		name    string
		file    string
		replace []string
		want    []string
	}{
		{
			"fertility pool too small", FileIslands,
			[]string{`{ "id": "grapes", "count": { "min": 2, "max": 5 } }`, `{ "id": "grapes", "count": { "min": 2, "max": 2 } }`,
				`{ "id": "woad", "count": { "min": 2, "max": 5 } }`, `{ "id": "woad", "count": { "min": 2, "max": 2 } }`,
				`{ "id": "hops", "count": { "min": 2, "max": 5 } }`, `{ "id": "hops", "count": { "min": 2, "max": 2 } }`},
			[]string{FileIslands, "fertilities", "unsatisfiable"},
		},
		{
			"deposit pool too large", FileIslands,
			[]string{`{ "id": "stone", "count": { "min": 3, "max": 6 } }`, `{ "id": "stone", "count": { "min": 60, "max": 60 } }`},
			[]string{FileIslands, "deposits", "unsatisfiable"},
		},
		{
			"empty range", FileIslands,
			[]string{`"count": { "min": 5, "max": 5 }`, `"count": { "min": 5, "max": 4 }`},
			[]string{FileIslands, `size class "medium"`, "count", "empty"},
		},
		{
			"fertility on more islands than exist", FileIslands,
			[]string{`{ "id": "wheat", "count": { "min": 3, "max": 5 } }`, `{ "id": "wheat", "count": { "min": 13, "max": 13 } }`},
			[]string{FileIslands, "fertilities[0].count.min", "only 12 can carry"},
		},
		{
			"rock with fertility", FileIslands,
			[]string{`"rock": true, "count": { "min": 0, "max": 2 }, "fertilities": { "min": 0, "max": 0 }`, `"rock": true, "count": { "min": 0, "max": 2 }, "fertilities": { "min": 0, "max": 1 }`},
			[]string{FileIslands, `size class "rock"`, "no fertility"},
		},
		{
			"building deposit not in pool", FileIslands,
			[]string{`{ "id": "iron", "count": { "min": 2, "max": 4 } }`, `{ "id": "peat", "count": { "min": 2, "max": 4 } }`},
			[]string{FileBuildings, `building "iron_mine"`, `deposit "iron" is not in the deposit pool`},
		},
		{
			"building fertility not in pool", FileIslands,
			[]string{`{ "id": "hemp", "count": { "min": 3, "max": 5 } }`, `{ "id": "flax", "count": { "min": 3, "max": 5 } }`},
			[]string{FileBuildings, `building "hemp_farm"`, `fertility "hemp" is not in the fertility pool`},
		},
		{
			"home on a rock", FileIslands,
			[]string{`"size_class": "large"`, `"size_class": "rock"`},
			[]string{FileIslands, "home.size_class"},
		},
		{
			"home requires an excluded deposit", FileIslands,
			[]string{`"deposits_none": ["iron", "clay", "salt", "coal"]`, `"deposits_none": ["iron", "clay", "salt", "coal", "stone"]`},
			[]string{FileIslands, "home.deposits_none", "both required and excluded"},
		},
		{
			"home excludes all its fertilities", FileIslands,
			[]string{`"fertilities_none": ["hemp"]`, `"fertilities_none": ["hemp", "wheat", "apple"]`},
			[]string{FileIslands, "home.fertilities_none", "excludes every fertility"},
		},
		{
			"unknown home fertility", FileIslands,
			[]string{`"fertilities_any": ["wheat", "apple"]`, `"fertilities_any": ["wheat", "olive"]`},
			[]string{FileIslands, "home.fertilities_any", `"olive" is not in the pool`},
		},
		{
			"too few names", FileIslands,
			[]string{`"count": { "min": 0, "max": 2 }`, `"count": { "min": 0, "max": 40 }`},
			[]string{FileIslandNames, "names for up to 52 islands"},
		},
		{
			"name not trimmed", FileIslandNames,
			[]string{`"Gull Rest"`, `"Gull Rest "`},
			[]string{FileIslandNames, "schema violation"},
		},
		{
			"duplicate name", FileIslandNames,
			[]string{`"Tarred Keel"`, `"Gull Rest"`},
			[]string{FileIslandNames, "schema violation"},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			dir := copyContent(t, tt.file, tt.replace...)
			_, err := LoadWithSchemas(dir, schemaDir)
			if err == nil {
				t.Fatal("expected an error")
			}
			for _, w := range tt.want {
				if !strings.Contains(err.Error(), w) {
					t.Errorf("error %q does not contain %q", err, w)
				}
			}
		})
	}
}
