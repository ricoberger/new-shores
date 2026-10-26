package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"testing"
)

type fieldsBuilding struct {
	ID         int64  `json:"id"`
	Type       string `json:"type"`
	X          int    `json:"x"`
	Y          int    `json:"y"`
	Status     string `json:"status"`
	Efficiency int64  `json:"efficiency_permille"`
	Fields     *struct {
		Active   int     `json:"active"`
		Required int     `json:"required"`
		Max      int     `json:"max"`
		IDs      []int64 `json:"ids"`
	} `json:"fields"`
	FarmID *int64 `json:"farm_id"`
	Active *bool  `json:"active"`
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

func placeField(farm int64, x, y int) string {
	return fmt.Sprintf(`{"type":"place_field","island_id":"start","farm_id":%d,"building_type":"pasture","x":%d,"y":%d}`, farm, x, y)
}

// TestPlaceField (D-051 part 4): place_field chains 2x2 pastures from a
// sheep farm; the display reports the farm's fields {active, required, max,
// ids} and each field's farm_id and active flag; demolishing the
// intermediate field makes the next one inactive (status not_adjacent);
// rejected commands (not adjacent, wrong type, max reached, free-standing,
// bad shape) leave the world and its version unchanged.
func TestPlaceField(t *testing.T) {
	ts := newTestServer(t, 1)
	// Farm footprint x 14..16, y 5..7 on the dev island.
	if res := ts.command(`{"type":"place_building","island_id":"start","building_type":"sheep_farm","x":14,"y":5,"rotation":0}`, nil); res.status != http.StatusOK {
		t.Fatalf("farm: %d %s", res.status, res.body)
	}
	before := ts.getWorld()
	farm := buildingIDs(t, before.Display, "sheep_farm")[0]

	for _, tt := range []struct {
		name, cmd string
		validate  bool
		status    int
		code      string
	}{
		{"not adjacent", placeField(farm, 20, 9), true, http.StatusConflict, "field_not_adjacent"},
		{"gap of one tile", placeField(farm, 18, 5), true, http.StatusConflict, "field_not_adjacent"},
		{"farm type as field type", `{"type":"place_field","island_id":"start","farm_id":` + fmt.Sprint(farm) + `,"building_type":"sheep_farm","x":17,"y":5}`, true, http.StatusConflict, "field_type_mismatch"},
		{"wrong farm", `{"type":"place_field","island_id":"start","farm_id":` + fmt.Sprint(farm) + `,"building_type":"wheat_field","x":17,"y":5}`, true, http.StatusConflict, "tier_locked"},
		{"occupied by the farm", placeField(farm, 15, 6), true, http.StatusConflict, "occupied"},
		{"unknown farm", placeField(999, 17, 5), true, http.StatusNotFound, "building_not_found"},
		{"farm is no farm", placeField(1, 17, 5), true, http.StatusConflict, "field_wrong_farm"},
		{"unknown island", `{"type":"place_field","island_id":"nowhere","farm_id":1,"building_type":"pasture","x":17,"y":5}`, true, http.StatusNotFound, "unknown_island"},
		{"free-standing", `{"type":"place_building","island_id":"start","building_type":"pasture","x":17,"y":5,"rotation":0}`, true, http.StatusConflict, "field_needs_farm"},
		{"bad rotation", `{"type":"place_field","island_id":"start","farm_id":` + fmt.Sprint(farm) + `,"building_type":"pasture","x":17,"y":5,"rotation":45}`, false, http.StatusBadRequest, "invalid_command"},
		// Bodies outside the spec (missing required properties).
		{"missing farm_id", `{"type":"place_field","island_id":"start","building_type":"pasture","x":17,"y":5}`, false, http.StatusBadRequest, "invalid_command"},
		{"missing building_type", `{"type":"place_field","island_id":"start","farm_id":1,"x":17,"y":5}`, false, http.StatusBadRequest, "invalid_command"},
		{"missing x", `{"type":"place_field","island_id":"start","farm_id":1,"building_type":"pasture","y":5}`, false, http.StatusBadRequest, "invalid_command"},
		{"old place_fields shape", `{"type":"place_fields","island_id":"start","field_type":"pasture","tiles":[]}`, false, http.StatusBadRequest, "bad_request"},
	} {
		t.Run(tt.name, func(t *testing.T) {
			res := ts.do(http.MethodPost, "/api/v1/world/commands", `{"command":`+tt.cmd+`}`, tt.validate)
			if res.status != tt.status || errorCode(t, res) != tt.code {
				t.Fatalf("%d %s, want %d %s", res.status, res.body, tt.status, tt.code)
			}
			if after := ts.getWorld(); after.Version != before.Version || !bytes.Equal(after.Display, before.Display) {
				t.Fatal("rejected command changed the world")
			}
		})
	}

	// A chain: (17,5) touches the farm, (19,5) touches (17,5), (21,5) the second.
	var w worldJSON
	for _, x := range []int{17, 19, 21} {
		res := ts.command(placeField(farm, x, 5), nil)
		if res.status != http.StatusOK {
			t.Fatalf("place_field (%d,5): %d %s", x, res.status, res.body)
		}
		if err := json.Unmarshal(res.body, &w); err != nil {
			t.Fatal(err)
		}
	}
	if w.Version != before.Version+3 {
		t.Errorf("version %d", w.Version)
	}
	var ids []int64
	for _, b := range fieldsBuildings(t, w.Display) {
		switch b.Type {
		case "sheep_farm":
			if b.Efficiency != 750 || b.Fields == nil || b.Fields.Active != 3 || b.Fields.Required != 4 || b.Fields.Max != 4 || len(b.Fields.IDs) != 3 ||
				b.FarmID != nil || b.Active != nil {
				t.Errorf("farm %+v fields %+v", b, b.Fields)
			}
			ids = b.Fields.IDs
		case "pasture":
			if b.FarmID == nil || *b.FarmID != farm || b.Active == nil || !*b.Active || b.Status != "ok" || b.Fields != nil {
				t.Errorf("field %+v", b)
			}
		}
	}
	if len(ids) != 3 {
		t.Fatalf("ids %v", ids)
	}

	// Demolishing the intermediate field makes the last one inactive.
	res := ts.command(fmt.Sprintf(`{"type":"demolish","island_id":"start","building_id":%d}`, ids[1]), nil)
	if res.status != http.StatusOK {
		t.Fatalf("demolish: %d %s", res.status, res.body)
	}
	if err := json.Unmarshal(res.body, &w); err != nil {
		t.Fatal(err)
	}
	for _, b := range fieldsBuildings(t, w.Display) {
		switch {
		case b.Type == "sheep_farm" && (b.Efficiency != 250 || b.Fields.Active != 1 || len(b.Fields.IDs) != 2):
			t.Errorf("after breaking the chain: farm %+v fields %+v", b, b.Fields)
		case b.ID == ids[2] && (b.Active == nil || *b.Active || b.Status != "not_adjacent" || b.FarmID == nil || *b.FarmID != farm):
			t.Errorf("inactive field %+v", b)
		}
	}
	// A field cannot be moved; the farm can (its fields stay).
	res = ts.command(fmt.Sprintf(`{"type":"move_building","island_id":"start","building_id":%d,"x":17,"y":8,"rotation":0}`, ids[0]), nil)
	if res.status != http.StatusBadRequest || errorCode(t, res) != "invalid_command" {
		t.Errorf("move field: %d %s", res.status, res.body)
	}
	// Up to the maximum of 4 fields (it equals the requirement), then field_max_reached.
	for _, p := range [][2]int{{17, 7}, {19, 7}} {
		res = ts.command(placeField(farm, p[0], p[1]), nil)
		if res.status != http.StatusOK {
			t.Fatalf("place_field %v: %d %s", p, res.status, res.body)
		}
	}
	res = ts.do(http.MethodPost, "/api/v1/world/commands", `{"command":`+placeField(farm, 23, 5)+`}`, true)
	if res.status != http.StatusConflict || errorCode(t, res) != "field_max_reached" {
		t.Errorf("max: %d %s", res.status, res.body)
	}
	// Demolishing the farm demolishes its fields.
	res = ts.command(fmt.Sprintf(`{"type":"demolish","island_id":"start","building_id":%d}`, farm), nil)
	if res.status != http.StatusOK {
		t.Fatalf("demolish farm: %d %s", res.status, res.body)
	}
	if err := json.Unmarshal(res.body, &w); err != nil {
		t.Fatal(err)
	}
	for _, b := range fieldsBuildings(t, w.Display) {
		if b.Type == "pasture" || b.Type == "sheep_farm" {
			t.Errorf("%s %d survived the farm", b.Type, b.ID)
		}
	}
}

type batchJSON struct {
	Version     int64           `json:"version"`
	Display     json.RawMessage `json:"display"`
	TileResults []struct {
		X      int    `json:"x"`
		Y      int    `json:"y"`
		OK     bool   `json:"ok"`
		Reason string `json:"reason"`
	} `json:"tile_results"`
}

func tileList(tiles ...[2]int) string {
	var b bytes.Buffer
	b.WriteByte('[')
	for i, p := range tiles {
		if i > 0 {
			b.WriteByte(',')
		}
		fmt.Fprintf(&b, `{"x":%d,"y":%d}`, p[0], p[1])
	}
	b.WriteByte(']')
	return b.String()
}

// TestPlaceFieldsAPI (D-054): place_fields applies the valid anchors of a
// painted list in one version and reports every tile in tile_results
// (validated against the spec); a list without a valid tile answers 200
// with every tile rejected, the unchanged version and no event; a list
// with duplicates or above 512 tiles fails as a whole; demolish_fields
// removes the fields under its tiles.
func TestPlaceFieldsAPI(t *testing.T) {
	ts := newTestServer(t, 1)
	pub := &countingPublisher{}
	ts.srv.cfg.Publisher = pub
	if res := ts.command(`{"type":"place_building","island_id":"start","building_type":"sheep_farm","x":14,"y":5,"rotation":0}`, nil); res.status != http.StatusOK {
		t.Fatalf("farm: %d %s", res.status, res.body)
	}
	before := ts.getWorld()
	farm := buildingIDs(t, before.Display, "sheep_farm")[0]
	batch := func(typ string, tiles string) string {
		if typ == "demolish_fields" {
			return fmt.Sprintf(`{"type":"demolish_fields","island_id":"start","farm_id":%d,"tiles":%s}`, farm, tiles)
		}
		return fmt.Sprintf(`{"type":"place_fields","island_id":"start","farm_id":%d,"building_type":"pasture","tiles":%s}`, farm, tiles)
	}
	// No valid tile: not an error, nothing committed or published.
	pub.n.Store(0)
	res := ts.do(http.MethodPost, "/api/v1/world/commands", `{"command":`+batch("place_fields", tileList([2]int{20, 9}, [2]int{15, 6}))+`}`, true)
	var none batchJSON
	if res.status != http.StatusOK || json.Unmarshal(res.body, &none) != nil {
		t.Fatalf("none valid: %d %s", res.status, res.body)
	}
	if none.Version != before.Version || len(none.TileResults) != 2 ||
		none.TileResults[0].OK || none.TileResults[0].Reason != "field_not_adjacent" ||
		none.TileResults[1].OK || none.TileResults[1].Reason != "occupied" {
		t.Fatalf("none valid: version %d (before %d), results %+v", none.Version, before.Version, none.TileResults)
	}
	if after := ts.getWorld(); after.Version != before.Version || !bytes.Equal(after.Display, before.Display) {
		t.Fatal("place_fields without a valid tile changed the world")
	}
	if n := pub.n.Load(); n != 0 {
		t.Fatalf("place_fields without a valid tile published %d events", n)
	}

	var many [][2]int
	for i := range 513 {
		many = append(many, [2]int{i % 40, i / 40})
	}
	for _, tt := range []struct {
		name, cmd string
		validate  bool
		status    int
		code      string
	}{
		{"duplicates", batch("place_fields", tileList([2]int{17, 5}, [2]int{17, 5})), false, http.StatusBadRequest, "invalid_command"},
		{"too many", batch("place_fields", tileList(many...)), false, http.StatusBadRequest, "invalid_command"},
		{"empty", batch("place_fields", `[]`), false, http.StatusBadRequest, "invalid_command"},
		{"missing tiles", fmt.Sprintf(`{"type":"place_fields","island_id":"start","farm_id":%d,"building_type":"pasture"}`, farm), false, http.StatusBadRequest, "invalid_command"},
		{"missing farm", `{"type":"demolish_fields","island_id":"start","tiles":[{"x":1,"y":1}]}`, false, http.StatusBadRequest, "invalid_command"},
		{"demolish nothing", batch("demolish_fields", tileList([2]int{17, 5})), true, http.StatusNotFound, "building_not_found"},
	} {
		t.Run(tt.name, func(t *testing.T) {
			res := ts.do(http.MethodPost, "/api/v1/world/commands", `{"command":`+tt.cmd+`}`, tt.validate)
			if res.status != tt.status || errorCode(t, res) != tt.code {
				t.Fatalf("%d %s, want %d %s", res.status, res.body, tt.status, tt.code)
			}
			if after := ts.getWorld(); after.Version != before.Version || !bytes.Equal(after.Display, before.Display) {
				t.Fatal("rejected command changed the world")
			}
		})
	}

	// Far side first: (21,5) only touches (19,5), which touches (17,5) at
	// the farm; (15,6) is the farm itself, (23,5) is beyond the maximum.
	// A rejected tile reports its error of the last pass, after the
	// accepted fields: the maximum is checked first, as by place_field.
	tiles := [][2]int{{21, 5}, {19, 5}, {15, 6}, {17, 5}, {17, 7}, {23, 5}}
	res = ts.command(batch("place_fields", tileList(tiles...)), nil)
	if res.status != http.StatusOK {
		t.Fatalf("place_fields: %d %s", res.status, res.body)
	}
	var b batchJSON
	if err := json.Unmarshal(res.body, &b); err != nil {
		t.Fatal(err)
	}
	if b.Version != before.Version+1 || len(b.TileResults) != len(tiles) {
		t.Fatalf("version %d, %d results", b.Version, len(b.TileResults))
	}
	want := []string{"", "", "field_max_reached", "", "", "field_max_reached"}
	for i, r := range b.TileResults {
		if r.X != tiles[i][0] || r.Y != tiles[i][1] || r.OK != (want[i] == "") || r.Reason != want[i] {
			t.Errorf("result %d: %+v, want reason %q", i, r, want[i])
		}
	}
	for _, f := range fieldsBuildings(t, b.Display) {
		if f.Type == "sheep_farm" && (f.Fields.Active != 4 || f.Efficiency != 1000) {
			t.Errorf("farm %+v fields %+v", f, f.Fields)
		}
	}

	// demolish_fields: two tiles of one pasture and an empty tile.
	res = ts.command(batch("demolish_fields", tileList([2]int{17, 5}, [2]int{18, 6}, [2]int{30, 12})), nil)
	if res.status != http.StatusOK {
		t.Fatalf("demolish_fields: %d %s", res.status, res.body)
	}
	b = batchJSON{}
	if err := json.Unmarshal(res.body, &b); err != nil {
		t.Fatal(err)
	}
	if len(b.TileResults) != 3 || !b.TileResults[0].OK || !b.TileResults[1].OK || b.TileResults[2].Reason != "building_not_found" {
		t.Errorf("results %+v", b.TileResults)
	}
	// A single command has no tile_results.
	res = ts.command(`{"type":"set_paused","island_id":"start","building_id":`+fmt.Sprint(farm)+`,"paused":true}`, nil)
	if bytes.Contains(res.body, []byte("tile_results")) {
		t.Errorf("set_paused: %s", res.body)
	}
}
