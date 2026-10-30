package content

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// waterRange reads the range for assertions against historical scalar model
// plans. Inland buildings have no water rows.
func waterRange(b *Building) WaterRows {
	if b.WaterRows == nil {
		return WaterRows{}
	}
	return *b.WaterRows
}

// The schema requires both bounds and rejects the retired scalar key;
// the loader validates relationships between the bounds and footprint depth.
func TestLoadWaterRows(t *testing.T) {
	root := repoRoot(t)
	data, err := os.ReadFile(filepath.Join(root, "content", "old_coast", FileBuildings))
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		name, id, rows string
		legacy         bool
		valid          bool
	}{
		{"range", "fisher", `{"min":2,"max":3}`, false, true},
		{"equal", "fisher", `{"min":2,"max":2}`, false, true},
		{"zero-min", "depot", `{"min":0,"max":1}`, false, true},
		{"zero-max", "depot", `{"min":0,"max":0}`, false, true},
		{"missing-min", "fisher", `{"max":3}`, false, false},
		{"missing-max", "fisher", `{"min":2}`, false, false},
		{"negative", "fisher", `{"min":-1,"max":3}`, false, false},
		{"reversed", "fisher", `{"min":3,"max":2}`, false, false},
		{"depth", "fisher", `{"min":2,"max":8}`, false, false},
		{"fraction", "fisher", `{"min":2.5,"max":3}`, false, false},
		{"unknown", "fisher", `{"min":2,"max":3,"extra":1}`, false, false},
		{"null", "fisher", `null`, false, false},
		{"legacy", "fisher", `3`, true, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var buildings []map[string]json.RawMessage
			if err := json.Unmarshal(data, &buildings); err != nil {
				t.Fatal(err)
			}
			for _, b := range buildings {
				if string(b["id"]) != `"`+tc.id+`"` {
					continue
				}
				delete(b, "water_rows")
				key := "water_rows"
				if tc.legacy {
					key = "water_tiles"
				}
				b[key] = json.RawMessage(tc.rows)
			}
			changed, err := json.Marshal(buildings)
			if err != nil {
				t.Fatal(err)
			}
			dir := copyContent(t, FileBuildings, string(changed))
			c, err := LoadWithSchemas(dir, filepath.Join(root, "content", "schema"))
			if tc.valid {
				if err != nil {
					t.Fatal(err)
				}
				var want WaterRows
				if err := json.Unmarshal([]byte(tc.rows), &want); err != nil {
					t.Fatal(err)
				}
				if got := c.BuildingByID[tc.id].WaterRows; got == nil || *got != want {
					t.Fatalf("got %+v, want %+v", got, want)
				}
			} else if err == nil || !strings.Contains(err.Error(), "water_") {
				t.Fatalf("expected water rows validation error, got %v", err)
			}
		})
	}
}

func TestWaterRowsBounds(t *testing.T) {
	c, err := Load(filepath.Join(repoRoot(t), "content", "old_coast"))
	if err != nil {
		t.Fatal(err)
	}
	for _, b := range c.Buildings {
		if r := b.WaterRows; r != nil && (r.Min < 0 || r.Max < r.Min || r.Max >= b.Height) {
			t.Errorf("%s: invalid water rows %+v for depth %d", b.ID, r, b.Height)
		}
	}
}
