package api

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/ricoberger/new-shores/server/internal/devworld"
	"github.com/ricoberger/new-shores/server/internal/events"
	"github.com/ricoberger/new-shores/server/internal/sim"
	"github.com/ricoberger/new-shores/server/internal/store"
)

// shipServer is a test server on the --dev world (no bonus) and
// a dev scheduler that the test drives explicitly.
type shipServer struct {
	*testServer
	sched *events.DevScheduler
}

func newShipServer(t *testing.T) *shipServer {
	t.Helper()
	ts := newTestServer(t, 1)
	c := catalogue(t)
	w, err := devworld.NewDev(c, testStart)
	if err != nil {
		t.Fatal(err)
	}
	// Extra planks (formerly the dev bonus) so that a cargo larger than the
	// sloop's slots is in stock and fails for the slots, not the stock.
	if err := sim.AddStock(w, c, "start", "planks", 100_000, nil); err != nil {
		t.Fatal(err)
	}
	now := func() time.Time { return TimeScale{Start: testStart, Scale: 1}.At(ts.clock.Now()) }
	mem := store.NewMemory(testWorld, w, now)
	ts.srv.cfg.Store = mem
	return &shipServer{testServer: ts, sched: &events.DevScheduler{
		Store: mem, Registry: events.DefaultRegistry(time.Hour), Catalogue: c,
		Logger: slog.New(slog.NewTextHandler(io.Discard, nil)), WorldNow: now,
		WallUntil: func(time.Time) time.Duration { return 0 },
	}}
}

// advance moves the clock and processes the due events.
func (ss *shipServer) advance(d time.Duration) {
	ss.clock.Add(d)
	ss.sched.ProcessDue(context.Background())
}

type shipView struct {
	ID       int64  `json:"id"`
	State    string `json:"state"`
	IslandID string `json:"island_id"`
	RouteID  int64  `json:"route_id"`
	Leg      *struct {
		ArriveAt string `json:"arrive_at"`
	} `json:"leg"`
	Cargo []struct {
		Good   string `json:"good"`
		Amount int64  `json:"amount"`
	} `json:"cargo"`
}

type displayView struct {
	NextChangeAt *string    `json:"next_change_at"`
	Ships        []shipView `json:"ships"`
	Routes       []struct {
		ID      int64   `json:"id"`
		Name    string  `json:"name"`
		ShipIDs []int64 `json:"ship_ids"`
		LoopMs  int64   `json:"loop_ms"`
	} `json:"routes"`
	Islands []struct {
		ID        string `json:"id"`
		Settled   bool   `json:"settled"`
		Buildings []struct {
			ID        int64           `json:"id"`
			Type      string          `json:"type"`
			ShipOrder json.RawMessage `json:"ship_order"`
		} `json:"buildings"`
	} `json:"islands"`
}

func (ss *shipServer) view(t *testing.T) displayView {
	t.Helper()
	var v displayView
	if err := json.Unmarshal(ss.getWorld().Display, &v); err != nil {
		t.Fatal(err)
	}
	return v
}

func (ss *shipServer) ok(t *testing.T, cmd string) {
	t.Helper()
	if res := ss.command(cmd, nil); res.status != http.StatusOK {
		t.Fatalf("%s: %d %s", cmd, res.status, res.body)
	}
}

func (ss *shipServer) fails(t *testing.T, cmd string, status int, code string) {
	t.Helper()
	ss.failsSpec(t, cmd, status, code, true)
}

// failsSpec is fails; with validate unset the request itself violates
// openapi.yaml (limits, missing or unknown fields) and only the error
// response is validated.
func (ss *shipServer) failsSpec(t *testing.T, cmd string, status int, code string, validate bool) {
	t.Helper()
	before := ss.getWorld()
	res := ss.do(http.MethodPost, "/api/v1/world/commands", `{"command":`+cmd+`}`, validate)
	if !validate {
		ss.spec.validateSchema(t, "ErrorResponse", res.body)
	}
	if res.status != status || errorCode(t, res) != code {
		t.Fatalf("%s: %d %s, want %d %s", cmd, res.status, res.body, status, code)
	}
	if after := ss.getWorld(); after.Version != before.Version {
		t.Fatalf("%s: version changed on error", cmd)
	}
}

// TestShipCommandsOverHTTP (R-54 – R-57): every ship and route command and
// their errors over HTTP, validated against openapi.yaml, with the dev
// scheduler applying ship_built and ship_arrived.
func TestShipCommandsOverHTTP(t *testing.T) {
	ss := newShipServer(t)
	var tiles []string
	for y := 4; y <= 34; y++ {
		tiles = append(tiles, fmt.Sprintf(`{"x":2,"y":%d}`, y))
	}
	tiles = append(tiles, `{"x":3,"y":34}`, `{"x":4,"y":34}`)
	ss.ok(t, `{"type":"place_road","island_id":"start","road_type":"road_dirt","tiles":[`+strings.Join(tiles, ",")+`]}`)
	ss.ok(t, `{"type":"place_building","island_id":"start","building_type":"shipyard","x":5,"y":34,"rotation":180}`)
	v := ss.view(t)
	yard := v.Islands[0].Buildings[1]
	if yard.Type != "shipyard" || string(yard.ShipOrder) != "null" {
		t.Fatalf("shipyard %+v", yard)
	}
	if string(v.Islands[0].Buildings[0].ShipOrder) != "" || v.Islands[1].Settled {
		t.Fatalf("warehouse has ship_order or island 2 settled: %+v", v.Islands)
	}

	ss.fails(t, `{"type":"cancel_ship_order","island_id":"start","building_id":1}`, http.StatusConflict, "not_a_shipyard")
	ss.fails(t, `{"type":"cancel_ship_order","island_id":"start","building_id":2}`, http.StatusConflict, "no_ship_order")
	ss.fails(t, `{"type":"order_ship","island_id":"start","building_id":2,"ship_type":"galleon"}`, http.StatusConflict, "unknown_ship_type")
	ss.ok(t, `{"type":"order_ship","island_id":"start","building_id":2,"ship_type":"sloop"}`)
	ss.fails(t, `{"type":"order_ship","island_id":"start","building_id":2,"ship_type":"sloop"}`, http.StatusConflict, "shipyard_busy")
	if v := ss.view(t); *v.NextChangeAt != "2026-10-19T12:02:00.000Z" || !strings.Contains(string(v.Islands[0].Buildings[1].ShipOrder), `"due_at":"2026-10-19T12:02:00.000Z"`) {
		t.Fatalf("order display: %v %s", *v.NextChangeAt, v.Islands[0].Buildings[1].ShipOrder)
	}
	ss.fails(t, `{"type":"scrap_ship","ship_id":1}`, http.StatusNotFound, "ship_not_found")
	ss.fails(t, `{"type":"place_building","island_id":"island2","building_type":"house_settlers","x":8,"y":5,"rotation":0}`, http.StatusConflict, "island_not_settled")
	ss.fails(t, `{"type":"create_route","stops":[{"island_id":"start","load":[],"unload":[]},{"island_id":"island2","load":[],"unload":[]}]}`, http.StatusBadRequest, "route_invalid")
	ss.fails(t, `{"type":"delete_route","route_id":7}`, http.StatusNotFound, "route_not_found")

	// The world stops at the due time until the scheduler applies it.
	ss.clock.Add(3 * time.Minute)
	if got := evaluatedAt(t, ss.getWorld()); !got.Equal(testStart.Add(2 * time.Minute)) {
		t.Fatalf("evaluated at %s, want the pending ship_built", got)
	}
	ss.advance(0)
	v = ss.view(t)
	if len(v.Ships) != 1 || v.Ships[0].State != "idle" || v.Ships[0].IslandID != "start" {
		t.Fatalf("ships %+v", v.Ships)
	}

	// Body limits are API-level invalid_command.
	var many []string
	for i := range 17 {
		many = append(many, fmt.Sprintf(`{"good":"g%d","amount":1000}`, i))
	}
	ss.failsSpec(t, `{"type":"manual_shipment","ship_id":1,"to_island_id":"island2","cargo":[`+strings.Join(many, ",")+`]}`, http.StatusBadRequest, "invalid_command", false)
	var stops []string
	for range 9 {
		stops = append(stops, `{"island_id":"start","load":[],"unload":[]}`)
	}
	ss.failsSpec(t, `{"type":"create_route","stops":[`+strings.Join(stops, ",")+`]}`, http.StatusBadRequest, "invalid_command", false)
	ss.fails(t, `{"type":"manual_shipment","ship_id":1,"to_island_id":"island2","cargo":[{"good":"planks","amount":120000}]}`, http.StatusConflict, "cargo_exceeds_slots")

	ss.ok(t, `{"type":"manual_shipment","ship_id":1,"to_island_id":"island2","cargo":[{"good":"planks","amount":70000}]}`)
	if s := ss.view(t).Ships[0]; s.State != "manual_leg" || s.Leg == nil || s.Leg.ArriveAt != "2026-10-19T12:05:24.000Z" {
		t.Fatalf("ship on leg %+v", s)
	}
	ss.fails(t, `{"type":"scrap_ship","ship_id":1}`, http.StatusConflict, "ship_not_idle")
	ss.advance(2*time.Minute + 30*time.Second)
	ss.fails(t, `{"type":"found_island","ship_id":1,"island_id":"island2","building_type":"trading_post","x":2,"y":4,"rotation":0}`, http.StatusConflict, "not_on_water")
	ss.ok(t, `{"type":"found_island","ship_id":1,"island_id":"island2","building_type":"trading_post","x":2,"y":0,"rotation":0}`)
	ss.fails(t, `{"type":"found_island","ship_id":1,"island_id":"island2","building_type":"trading_post","x":8,"y":0,"rotation":0}`, http.StatusConflict, "island_already_settled")
	ss.fails(t, `{"type":"demolish","island_id":"start","building_id":1}`, http.StatusConflict, "last_trading_post")

	route := `"stops":[{"island_id":"island2","load":[{"good":"planks","max_amount":10000}],"unload":[]},{"island_id":"start","load":[],"unload":["planks"]}]`
	ss.ok(t, `{"type":"create_route","name":"Planks home",`+route+`}`)
	ss.ok(t, `{"type":"update_route","route_id":1,"name":"",`+route+`}`)
	ss.fails(t, `{"type":"unassign_ship","ship_id":1}`, http.StatusConflict, "ship_not_on_route")
	ss.ok(t, `{"type":"assign_ship","ship_id":1,"route_id":1}`)
	ss.fails(t, `{"type":"assign_ship","ship_id":1,"route_id":1}`, http.StatusConflict, "ship_not_idle")
	ss.fails(t, `{"type":"delete_route","route_id":1}`, http.StatusConflict, "route_in_use")
	v = ss.view(t)
	if len(v.Routes) != 1 || v.Routes[0].Name != "Route 1" || len(v.Routes[0].ShipIDs) != 1 || v.Routes[0].LoopMs != 2*10_000+2*120_000 {
		t.Fatalf("routes %+v", v.Routes)
	}
	if s := v.Ships[0]; s.State != "on_route" || s.RouteID != 1 || len(s.Cargo) != 1 || s.Cargo[0].Amount != 10_000 {
		t.Fatalf("assigned ship %+v", s)
	}
	ss.advance(2*time.Minute + 20*time.Second) // arrives at start, unloads, sails back
	if s := ss.view(t).Ships[0]; s.State != "on_route" || len(s.Cargo) != 0 || s.Leg == nil {
		t.Fatalf("after arrival %+v", s)
	}
	ss.ok(t, `{"type":"unassign_ship","ship_id":1}`)
	ss.ok(t, `{"type":"delete_route","route_id":1}`)
	ss.advance(3 * time.Minute)
	if s := ss.view(t).Ships[0]; s.State != "idle" || s.IslandID != "island2" {
		t.Fatalf("after the manual leg %+v", s)
	}
	ss.ok(t, `{"type":"scrap_ship","ship_id":1}`)
	if v := ss.view(t); len(v.Ships) != 0 {
		t.Fatalf("ships after scrapping %+v", v.Ships)
	}
	// Missing fields are invalid commands, unknown fields bad requests.
	ss.failsSpec(t, `{"type":"assign_ship","ship_id":1}`, http.StatusBadRequest, "invalid_command", false)
	ss.failsSpec(t, `{"type":"scrap_ship","ship_id":1,"x":1}`, http.StatusBadRequest, "bad_request", false)
}
