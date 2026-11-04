//go:build integration

package api

import (
	"fmt"
	"net/http"
	"testing"
)

// TestPlansOverPostgres (D-071): plans are stored with the world (schema
// 15): a planned farm with a planned field and a planned road survive the
// round trip through Postgres, and build_plan builds them from the
// stored world.
func TestPlansOverPostgres(t *testing.T) {
	env := newPGEnv(t, nil)
	cl := &client{env: env}
	cl.must(http.MethodPost, "/api/v1/auth/guest", `{}`, 200)
	cmd := func(body string, status int) {
		t.Helper()
		cl.must(http.MethodPost, "/api/v1/world/commands", `{"command":`+body+`}`, status)
	}
	cmd(`{"type":"place_road","island_id":"start","road_type":"road_dirt","planned":true,"tiles":[{"x":3,"y":4},{"x":4,"y":4}]}`, 200)
	cmd(`{"type":"place_building","island_id":"start","building_type":"sheep_farm","x":14,"y":5,"rotation":0,"planned":true}`, 200)
	_, _, raw := cl.world()
	v := plansOf(t, raw)
	if len(v.Islands[0].Plans) != 1 || len(v.Islands[0].Planned) != 1 {
		t.Fatalf("stored plans %+v, planned roads %+v", v.Islands[0].Plans, v.Islands[0].Planned)
	}
	farm := v.Islands[0].Plans[0].ID
	cmd(fmt.Sprintf(`{"type":"place_fields","island_id":"start","farm_id":%d,"building_type":"pasture","planned":true,"tiles":[{"x":17,"y":5}]}`, farm), 200)
	cmd(`{"type":"build_plan","island_id":"start","x":3,"y":4}`, 200)
	cmd(fmt.Sprintf(`{"type":"build_plan","island_id":"start","building_id":%d}`, farm), 200)
	_, _, raw = cl.world()
	v = plansOf(t, raw)
	built := map[string]int{}
	for _, b := range v.Islands[0].Buildings {
		built[b.Type]++
	}
	if len(v.Islands[0].Plans) != 0 || len(v.Islands[0].Planned) != 0 || built["sheep_farm"] != 1 || built["pasture"] != 1 {
		t.Fatalf("after build: plans %+v, planned roads %+v, buildings %v", v.Islands[0].Plans, v.Islands[0].Planned, built)
	}
	cmd(`{"type":"build_plan","island_id":"start","building_id":999}`, 404)
}
