package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"testing"
	"time"

	"github.com/ricoberger/new-shores/server/internal/sim"
	"github.com/ricoberger/new-shores/server/internal/testworld"
)

// TestStartAtSeaOverHTTP (D-051): a new world starts at sea; sail_ship and
// found_island settle the start island over HTTP, validated against
// openapi.yaml, with their errors; then the Trading Post's upgrade, the
// founding-only rule and last_trading_post.
func TestStartAtSeaOverHTTP(t *testing.T) {
	sea, err := testworld.Sea(catalogue(t), testStart)
	if err != nil {
		t.Fatal(err)
	}
	ss := newShipServerFor(t, sea)
	ss.fails(t, `{"type":"place_road","island_id":"start","road_type":"road_dirt","tiles":[{"x":3,"y":4}]}`, http.StatusConflict, "island_not_settled")
	ss.fails(t, `{"type":"found_island","ship_id":1,"island_id":"start","building_type":"trading_post","x":2,"y":0,"rotation":0}`, http.StatusConflict, "ship_not_idle")
	ss.fails(t, `{"type":"sail_ship","ship_id":9,"to_island_id":"start"}`, http.StatusNotFound, "ship_not_found")
	ss.fails(t, `{"type":"sail_ship","ship_id":1,"to_island_id":"atlantis"}`, http.StatusBadRequest, "route_invalid")
	ss.failsSpec(t, `{"type":"sail_ship","ship_id":1}`, http.StatusBadRequest, "invalid_command", false)

	ss.ok(t, `{"type":"sail_ship","ship_id":1,"to_island_id":"start"}`)
	v := ss.view(t)
	if s := v.Ships[0]; s.State != "manual_leg" || s.Leg == nil {
		t.Fatalf("sailing ship %+v", s)
	}
	ss.fails(t, `{"type":"sail_ship","ship_id":1,"to_island_id":"island2"}`, http.StatusConflict, "ship_not_idle")
	// The voyage from (30, 48) to the start island takes 57 s.
	ss.advance(time.Minute)
	if s := ss.view(t).Ships[0]; s.State != "idle" || s.IslandID != "start" || len(s.Cargo) == 0 {
		t.Fatalf("arrived ship %+v", s)
	}
	ss.fails(t, `{"type":"found_island","ship_id":1,"island_id":"start","building_type":"trading_post","x":2,"y":4,"rotation":0}`, http.StatusConflict, "not_on_water")
	ss.fails(t, `{"type":"found_island","ship_id":1,"island_id":"start","building_type":"warehouse","x":2,"y":0,"rotation":0}`, http.StatusBadRequest, "invalid_command")
	ss.ok(t, `{"type":"found_island","ship_id":1,"island_id":"start","building_type":"trading_post","x":2,"y":0,"rotation":0}`)
	v = ss.view(t)
	if !v.Islands[0].Settled || len(v.Ships[0].Cargo) != 0 {
		t.Fatalf("after founding: %+v %+v", v.Islands[0], v.Ships[0])
	}

	// The Trading Post is never placed by place_building.
	ss.fails(t, `{"type":"place_building","island_id":"start","building_type":"trading_post","x":20,"y":0,"rotation":0}`, http.StatusConflict, "island_already_settled")
	// Its upgrade needs stone; upgrade_warehouse does not apply to it.
	ss.fails(t, `{"type":"upgrade_trading_post","island_id":"start","building_id":1}`, http.StatusConflict, "insufficient_materials")
	ss.fails(t, `{"type":"upgrade_warehouse","island_id":"start","building_id":1}`, http.StatusConflict, "upgrade_unavailable")
	ss.mutateWorld(func(w *sim.World) {
		if err := sim.AddStock(w, catalogue(t), "start", "stone", 10_000, nil); err != nil {
			t.Fatal(err)
		}
	})
	ss.ok(t, `{"type":"upgrade_trading_post","island_id":"start","building_id":1}`)
	var berths struct {
		Islands []struct {
			Buildings []struct {
				Level  int `json:"level"`
				Berths *struct {
					Total int `json:"total"`
				} `json:"berths"`
			} `json:"buildings"`
		} `json:"islands"`
	}
	if err := json.Unmarshal(ss.getWorld().Display, &berths); err != nil {
		t.Fatal(err)
	}
	if b := berths.Islands[0].Buildings[0]; b.Level != 2 || b.Berths == nil || b.Berths.Total != 2 {
		t.Fatalf("trading post after the upgrade %+v", b)
	}
	// With another building on the island the Trading Post cannot go.
	ss.ok(t, `{"type":"place_building","island_id":"start","building_type":"warehouse","x":20,"y":5,"rotation":0}`)
	ss.fails(t, fmt.Sprintf(`{"type":"demolish","island_id":"start","building_id":%d,"accept_surplus_loss":true}`, 1), http.StatusConflict, "last_trading_post")
	// A water-edge fisher with its land row on water fails with terrain.
	ss.fails(t, `{"type":"place_building","island_id":"start","building_type":"fisher","x":7,"y":0,"rotation":180}`, http.StatusConflict, "terrain")
}
