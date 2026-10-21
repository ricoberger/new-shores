package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"
)

// fieldTiles returns n tiles of the pasture disc around a sheep farm at
// (14,5) on the dev island (doubled centre (31,13), radius 4), outside its
// footprint, as a JSON tile list.
func fieldTiles(n int) string {
	var tiles []string
	for y := 5; y <= 9 && len(tiles) < n; y++ {
		for x := 10; x <= 20 && len(tiles) < n; x++ {
			if x >= 14 && x < 17 && y < 8 {
				continue
			}
			if dx, dy := 2*x+1-31, 2*y+1-13; dx*dx+dy*dy > 64 {
				continue
			}
			tiles = append(tiles, fmt.Sprintf(`{"x":%d,"y":%d}`, x, y))
		}
	}
	return "[" + strings.Join(tiles, ",") + "]"
}

type fieldsBuilding struct {
	ID         int64  `json:"id"`
	Type       string `json:"type"`
	Status     string `json:"status"`
	Efficiency int64  `json:"efficiency_permille"`
	Fields     *struct {
		Assigned int `json:"assigned"`
		Required int `json:"required"`
	} `json:"fields"`
	FarmID *int64 `json:"farm_id"`
}

func fieldsBuildings(t *testing.T, display json.RawMessage) []fieldsBuilding {
	t.Helper()
	var d struct {
		Islands []struct {
			Buildings []fieldsBuilding `json:"buildings"`
		} `json:"islands"`
	}
	if err := json.Unmarshal(display, &d); err != nil {
		t.Fatal(err)
	}
	return d.Islands[0].Buildings
}

// TestPlaceAndDemolishFields (R-20, R-21, R-24): place_fields gives the
// farm full efficiency and the display reports fields and farm_id;
// rejected commands (all or nothing, wrong type, not a field, tile bound,
// missing fields) leave the world and its version unchanged.
func TestPlaceAndDemolishFields(t *testing.T) {
	ts := newTestServer(t, 1)
	if res := ts.command(`{"type":"place_building","island_id":"start","building_type":"sheep_farm","x":14,"y":5,"rotation":0}`, nil); res.status != http.StatusOK {
		t.Fatalf("farm: %d %s", res.status, res.body)
	}
	before := ts.getWorld()
	farm := buildingIDs(t, before.Display, "sheep_farm")[0]

	// All or nothing: a valid tile and one outside the farm's radius.
	mixed := `{"type":"place_fields","island_id":"start","field_type":"pasture","tiles":[{"x":12,"y":6},{"x":40,"y":3}]}`
	for _, tt := range []struct {
		name, cmd string
		status    int
		code      string
	}{
		{"mixed tiles", mixed, http.StatusConflict, "no_farm_in_range"},
		{"farm type", `{"type":"place_fields","island_id":"start","field_type":"sheep_farm","tiles":[{"x":12,"y":6}]}`, http.StatusConflict, "field_type_mismatch"},
		{"forest", `{"type":"place_fields","island_id":"start","field_type":"pasture","tiles":[{"x":12,"y":6},{"x":3,"y":16}]}`, http.StatusConflict, "terrain"},
		{"locked tier", `{"type":"place_fields","island_id":"start","field_type":"wheat_field","tiles":[{"x":12,"y":6}]}`, http.StatusConflict, "tier_locked"},
		// Bodies outside the spec (missing required properties).
		{"missing field_type", `{"type":"place_fields","island_id":"start","tiles":[{"x":12,"y":6}]}`, http.StatusBadRequest, "invalid_command"},
		{"missing tiles", `{"type":"place_fields","island_id":"start","field_type":"pasture"}`, http.StatusBadRequest, "invalid_command"},
		{"no tiles", `{"type":"place_fields","island_id":"start","field_type":"pasture","tiles":[]}`, http.StatusBadRequest, "invalid_command"},
		{"duplicate tiles", `{"type":"place_fields","island_id":"start","field_type":"pasture","tiles":[{"x":12,"y":6},{"x":12,"y":6}]}`, http.StatusBadRequest, "invalid_command"},
		{"demolish empty tile", `{"type":"demolish_fields","island_id":"start","tiles":[{"x":12,"y":6}]}`, http.StatusNotFound, "building_not_found"},
		{"demolish the farm", `{"type":"demolish_fields","island_id":"start","tiles":[{"x":15,"y":6}]}`, http.StatusConflict, "not_a_field"},
		{"demolish missing island", `{"type":"demolish_fields","tiles":[{"x":15,"y":6}]}`, http.StatusBadRequest, "invalid_command"},
	} {
		t.Run(tt.name, func(t *testing.T) {
			validate := !strings.Contains(tt.name, "missing")
			res := ts.do(http.MethodPost, "/api/v1/world/commands", `{"command":`+tt.cmd+`}`, validate)
			if res.status != tt.status || errorCode(t, res) != tt.code {
				t.Fatalf("%d %s, want %d %s", res.status, res.body, tt.status, tt.code)
			}
			if after := ts.getWorld(); after.Version != before.Version || !bytes.Equal(after.Display, before.Display) {
				t.Fatal("rejected command changed the world")
			}
		})
	}
	// More than 256 tiles is rejected at the API level, unvalidated by the
	// spec (maxItems), with invalid_command.
	var many []string
	for i := range 257 {
		many = append(many, fmt.Sprintf(`{"x":%d,"y":%d}`, i%50, i/50))
	}
	for _, typ := range []string{`"place_fields","field_type":"pasture"`, `"demolish_fields"`} {
		body := `{"command":{"type":` + typ + `,"island_id":"start","tiles":[` + strings.Join(many, ",") + `]}}`
		res := ts.do(http.MethodPost, "/api/v1/world/commands", body, false)
		if res.status != http.StatusBadRequest || errorCode(t, res) != "invalid_command" || !strings.Contains(string(res.body), "at most 256") {
			t.Fatalf("257 tiles: %d %s", res.status, res.body)
		}
	}

	res := ts.command(`{"type":"place_fields","island_id":"start","field_type":"pasture","tiles":`+fieldTiles(16)+`}`, nil)
	if res.status != http.StatusOK {
		t.Fatalf("place_fields: %d %s", res.status, res.body)
	}
	var w worldJSON
	if err := json.Unmarshal(res.body, &w); err != nil {
		t.Fatal(err)
	}
	if w.Version != before.Version+1 {
		t.Errorf("version %d", w.Version)
	}
	fields := 0
	var field int64
	for _, b := range fieldsBuildings(t, w.Display) {
		switch b.Type {
		case "sheep_farm":
			if b.Efficiency != 1000 || b.Fields == nil || b.Fields.Assigned != 16 || b.Fields.Required != 16 || b.FarmID != nil {
				t.Errorf("farm %+v fields %+v", b, b.Fields)
			}
		case "pasture":
			fields++
			field = b.ID
			if b.FarmID == nil || *b.FarmID != farm || b.Status != "ok" || b.Fields != nil {
				t.Errorf("field %+v", b)
			}
		}
	}
	if fields != 16 {
		t.Fatalf("%d fields", fields)
	}

	// demolish_fields and demolish by building ID lower the efficiency.
	res = ts.command(`{"type":"demolish_fields","island_id":"start","tiles":[{"x":12,"y":5}]}`, nil)
	if res.status != http.StatusOK {
		t.Fatalf("demolish_fields: %d %s", res.status, res.body)
	}
	res = ts.command(fmt.Sprintf(`{"type":"demolish","island_id":"start","building_id":%d}`, field), nil)
	if res.status != http.StatusOK {
		t.Fatalf("demolish: %d %s", res.status, res.body)
	}
	_ = json.Unmarshal(res.body, &w)
	for _, b := range fieldsBuildings(t, w.Display) {
		if b.Type == "sheep_farm" && (b.Efficiency != 875 || b.Fields.Assigned != 14) {
			t.Errorf("after demolish: farm %+v fields %+v", b, b.Fields)
		}
	}
}
