package api

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/ricoberger/new-shores/server/internal/devworld"
	"github.com/ricoberger/new-shores/server/internal/sim"
)

func archipelagoView(t *testing.T, w worldJSON) sim.DisplayState {
	t.Helper()
	var ds sim.DisplayState
	if err := json.Unmarshal(w.Display, &ds); err != nil {
		t.Fatal(err)
	}
	return ds
}

func islandRevisionOf(t *testing.T, ts *testServer, id string) string {
	t.Helper()
	res := ts.do(http.MethodGet, "/api/v1/world/islands/"+id+"/tiles", "", true)
	var is tilesResponse
	if err := json.Unmarshal(res.body, &is); err != nil || res.status != http.StatusOK {
		t.Fatalf("GET island %s: %d %s", id, res.status, res.body)
	}
	return is.Revision
}

// TestRerollArchipelagoOverHTTP (D-053): a new world shows its generated
// archipelago; reroll_archipelago replaces it (next roll, new island
// revision, the ship at the new spawn) until an island is settled.
func TestRerollArchipelagoOverHTTP(t *testing.T) {
	w, err := devworld.New(catalogue(t), devworld.DevSeed, testStart)
	if err != nil {
		t.Fatal(err)
	}
	ts := newTestServerFor(t, w, testStart, 1)
	before := archipelagoView(t, ts.getWorld())
	home := before.Islands[0]
	if a := before.Archipelago; a.Seed != devworld.DevSeed || a.Roll != 0 || !a.Rerollable || a.Bounds.Width <= 0 || a.Bounds.Height <= 0 {
		t.Fatalf("archipelago %+v", a)
	}
	if home.SizeClass == "" || home.Rock || home.Name == "" {
		t.Fatalf("home island %+v", home)
	}
	rev := islandRevisionOf(t, ts, home.ID)

	ts.expectUnvalidated(`{"type":"reroll_archipelago","seed":5}`, http.StatusBadRequest, CodeBadRequest)
	ts.expectCode(`{"type":"rename_island","island_id":"`+home.ID+`","name":"Haven"}`, http.StatusConflict, "island_not_settled")
	after := archipelagoView(t, ts.mustCommand(`{"type":"reroll_archipelago"}`))
	if a := after.Archipelago; a.Seed != devworld.DevSeed || a.Roll != 1 || !a.Rerollable {
		t.Fatalf("archipelago after the reroll %+v", a)
	}
	if after.Islands[0].ID != home.ID || after.Islands[0].Name == home.Name && after.Islands[0].Width == home.Width {
		t.Errorf("home after the reroll %+v, before %+v", after.Islands[0], home)
	}
	if r := islandRevisionOf(t, ts, home.ID); r == rev {
		t.Errorf("island revision %q unchanged by the reroll", r)
	}
	if s := after.Ships[0]; s.Position == nil || s.IslandID != "" {
		t.Errorf("ship after the reroll %+v", s)
	}

	// Under way: refused.
	ts.mustCommand(`{"type":"sail_ship","ship_id":1,"to_island_id":"` + home.ID + `"}`)
	if archipelagoView(t, ts.getWorld()).Archipelago.Rerollable {
		t.Error("rerollable while the ship sails")
	}
	ts.expectCode(`{"type":"reroll_archipelago"}`, http.StatusConflict, "reroll_not_allowed")
}

// TestRenameIslandOverHTTP: a settled island takes a trimmed name of 1-24
// printable characters; a hand-made archipelago cannot be rerolled.
func TestRenameIslandOverHTTP(t *testing.T) {
	ts := newTestServer(t, 1)
	ts.expectCode(`{"type":"reroll_archipelago"}`, http.StatusConflict, "reroll_not_allowed")
	v := archipelagoView(t, ts.mustCommand(`{"type":"rename_island","island_id":"start","name":"  Gull Haven "}`))
	if v.Islands[0].Name != "Gull Haven" || v.Archipelago.Rerollable || v.Archipelago.Seed != 0 {
		t.Fatalf("renamed island %q, archipelago %+v", v.Islands[0].Name, v.Archipelago)
	}
	ts.expectCode(`{"type":"rename_island","island_id":"start","name":"   "}`, http.StatusBadRequest, "invalid_name")
	ts.expectCode(`{"type":"rename_island","island_id":"start","name":"abcdefghijklmnopqrstuvwxy"}`, http.StatusBadRequest, "invalid_name")
	ts.expectCode(`{"type":"rename_island","island_id":"atlantis","name":"Haven"}`, http.StatusNotFound, "unknown_island")
	ts.expectUnvalidated(`{"type":"rename_island","island_id":"start"}`, http.StatusBadRequest, "invalid_command")
}

// TestRenameShipOverHTTP (D-055): a ship shows its default name
// ("<ship type name> <id>"); rename_ship takes a trimmed name of 1-24
// printable characters, an empty one restores the default.
func TestRenameShipOverHTTP(t *testing.T) {
	ts := newTestServer(t, 1)
	if v := archipelagoView(t, ts.getWorld()); len(v.Ships) != 1 || v.Ships[0].Name != "Sloop 1" {
		t.Fatalf("ships %+v", v.Ships)
	}
	v := archipelagoView(t, ts.mustCommand(`{"type":"rename_ship","ship_id":1,"name":"  Gull "}`))
	if v.Ships[0].Name != "Gull" {
		t.Fatalf("renamed ship %q", v.Ships[0].Name)
	}
	ts.expectCode(`{"type":"rename_ship","ship_id":1,"name":"abcdefghijklmnopqrstuvwxy"}`, http.StatusBadRequest, "invalid_name")
	ts.expectCode(`{"type":"rename_ship","ship_id":9,"name":"Gull"}`, http.StatusNotFound, "ship_not_found")
	ts.expectUnvalidated(`{"type":"rename_ship","ship_id":1}`, http.StatusBadRequest, "invalid_command")
	if v := archipelagoView(t, ts.mustCommand(`{"type":"rename_ship","ship_id":1,"name":" "}`)); v.Ships[0].Name != "Sloop 1" {
		t.Errorf("reset ship name %q", v.Ships[0].Name)
	}
}
