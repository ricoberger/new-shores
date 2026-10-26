package api

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"math"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"runtime"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/ricoberger/new-shores/server/internal/content"
	"github.com/ricoberger/new-shores/server/internal/sim"
	"github.com/ricoberger/new-shores/server/internal/store"
	"github.com/ricoberger/new-shores/server/internal/testworld"
)

func repoRoot(t testing.TB) string {
	t.Helper()
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller failed")
	}
	return filepath.Join(filepath.Dir(file), "..", "..", "..")
}

var (
	catOnce sync.Once
	cat     *content.Catalogue
	catErr  error

	shippedOnce sync.Once
	shipped     *content.Catalogue
	shippedErr  error
)

// shippedCatalogue is the shipped content (content/old_coast) of the
// reference games on the generated dev archipelago.
func shippedCatalogue(t testing.TB) *content.Catalogue {
	t.Helper()
	shippedOnce.Do(func() {
		shipped, shippedErr = content.LoadWithSchemas(filepath.Join(repoRoot(t), "content", "old_coast"), filepath.Join(repoRoot(t), "content", "schema"))
	})
	if shippedErr != nil {
		t.Fatal(shippedErr)
	}
	return shipped
}

func catalogue(t testing.TB) *content.Catalogue {
	t.Helper()
	// The pre-D-054 content: the test world's hand-made islands (testworld)
	// and the coordinates of these tests fit its footprints.
	catOnce.Do(func() {
		cat, catErr = content.LoadWithSchemas(filepath.Join(repoRoot(t), "server", "testdata", "content", "old_coast_pre_d054"), filepath.Join(repoRoot(t), "content", "schema"))
	})
	if catErr != nil {
		t.Fatal(catErr)
	}
	return cat
}

// fakeClock is a settable wall clock.
type fakeClock struct {
	mu  sync.Mutex
	now time.Time
}

func (c *fakeClock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.now
}

func (c *fakeClock) Add(d time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.now = c.now.Add(d)
}

var testStart = time.Date(2026, 10, 19, 12, 0, 0, 0, time.UTC)

const (
	testWorld          = store.WorldID("dev")
	testIsland         = "start"
	testOrigin         = "http://localhost:5173"
	testOriginLoopback = "http://127.0.0.1:5173"
)

type testServer struct {
	t     *testing.T
	srv   *Server
	mem   *store.Memory
	clock *fakeClock
	logs  *bytes.Buffer
	spec  *specValidator
}

func newTestServer(t *testing.T, scale float64) *testServer {
	t.Helper()
	return newTestServerFor(t, foundedWorld(t, testStart), testStart, scale)
}

// foundedWorld is the dev world at start with the start island founded
// from the start ship (the default dev fixture): the island most tests
// build on. A new player world starts at sea (TestGetWorldInitialState).
func foundedWorld(t *testing.T, start time.Time) *sim.World {
	t.Helper()
	w, err := testworld.Founded(catalogue(t), start)
	if err != nil {
		t.Fatal(err)
	}
	return w
}

// newTestServerFor serves world w from the in-memory store; the fake wall
// clock starts at start, which is world time start (scaled by scale).
func newTestServerFor(t *testing.T, w *sim.World, start time.Time, scale float64) *testServer {
	t.Helper()
	return newTestServerWith(t, w, start, scale, catalogue(t))
}

// newTestServerWith is newTestServerFor with catalogue c.
func newTestServerWith(t *testing.T, w *sim.World, start time.Time, scale float64, c *content.Catalogue) *testServer {
	t.Helper()
	clock := &fakeClock{now: start}
	logs := &bytes.Buffer{}
	mem := store.NewMemory(testWorld, w, func() time.Time { return TimeScale{Start: start, Scale: scale}.At(clock.Now()) })
	srv, err := New(Config{
		Store:        mem,
		Catalogue:    c,
		Clock:        clock,
		ResolveWorld: func(*http.Request) (store.WorldID, error) { return testWorld, nil },
		CORSOrigins:  []string{testOrigin, testOriginLoopback},
		Logger:       slog.New(slog.NewTextHandler(&syncWriter{w: logs}, nil)),
	})
	if err != nil {
		t.Fatal(err)
	}
	return &testServer{t: t, srv: srv, mem: mem, clock: clock, logs: logs, spec: loadSpec(t)}
}

// mutateWorld changes the stored world directly (test seeding outside the
// command API, like a scenario grant); it bumps the version.
func (ts *testServer) mutateWorld(fn func(*sim.World)) {
	ts.t.Helper()
	if _, err := ts.mem.Update(context.Background(), testWorld, func(w *sim.World, _ int64, _ time.Time) (bool, error) {
		fn(w)
		return true, nil
	}); err != nil {
		ts.t.Fatal(err)
	}
}

type syncWriter struct {
	mu sync.Mutex
	w  io.Writer
}

func (s *syncWriter) Write(p []byte) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.w.Write(p)
}

type response struct {
	status int
	header http.Header
	body   []byte
}

// do serves one request. With validate set, the request and the response
// are validated against openapi.yaml.
func (ts *testServer) do(method, path, body string, validate bool) response {
	ts.t.Helper()
	req := httptest.NewRequestWithContext(context.Background(), method, path, strings.NewReader(body))
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	req.Header.Set("Origin", testOrigin)
	rec := httptest.NewRecorder()
	ts.srv.ServeHTTP(rec, req)
	res := response{status: rec.Code, header: rec.Header(), body: rec.Body.Bytes()}
	if validate {
		ts.spec.validate(ts.t, method, path, body, res)
	}
	return res
}

type worldJSON struct {
	Version int64           `json:"version"`
	Display json.RawMessage `json:"display"`
}

func (ts *testServer) getWorld() worldJSON {
	ts.t.Helper()
	res := ts.do(http.MethodGet, "/api/v1/world", "", true)
	if res.status != http.StatusOK {
		ts.t.Fatalf("GET /world: %d %s", res.status, res.body)
	}
	var w worldJSON
	if err := json.Unmarshal(res.body, &w); err != nil {
		ts.t.Fatal(err)
	}
	return w
}

func (ts *testServer) command(cmd string, version *int64) response {
	ts.t.Helper()
	body := `{"command":` + cmd + `}`
	if version != nil {
		body = fmt.Sprintf(`{"version":%d,"command":%s}`, *version, cmd)
	}
	return ts.do(http.MethodPost, "/api/v1/world/commands", body, true)
}

func errorCode(t *testing.T, res response) string {
	t.Helper()
	var e errorBody
	if err := json.Unmarshal(res.body, &e); err != nil {
		t.Fatalf("error body %s: %v", res.body, err)
	}
	return e.Error.Code
}

func decodeDisplay(t *testing.T, raw json.RawMessage) map[string]any {
	t.Helper()
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil {
		t.Fatal(err)
	}
	return m
}

// Commands on the dev island (see devworld tests for the coordinates).
const (
	cmdRoad       = `{"type":"place_road","island_id":"start","road_type":"road_dirt","tiles":[{"x":3,"y":4},{"x":4,"y":4},{"x":5,"y":4},{"x":6,"y":4},{"x":7,"y":4},{"x":8,"y":4},{"x":9,"y":4},{"x":10,"y":4},{"x":11,"y":4},{"x":12,"y":4}]}`
	cmdSawmill    = `{"type":"place_building","island_id":"start","building_type":"sawmill","x":10,"y":5,"rotation":180}`
	cmdOnWater    = `{"type":"place_building","island_id":"start","building_type":"sawmill","x":0,"y":0,"rotation":0}`
	cmdRoadRemove = `{"type":"demolish_road","island_id":"start","tiles":[{"x":12,"y":4}]}`
)

func buildingIDs(t *testing.T, display json.RawMessage, typ string) []int64 {
	t.Helper()
	var d struct {
		Islands []struct {
			Buildings []struct {
				ID   int64  `json:"id"`
				Type string `json:"type"`
			} `json:"buildings"`
		} `json:"islands"`
	}
	if err := json.Unmarshal(display, &d); err != nil {
		t.Fatal(err)
	}
	var ids []int64
	for _, b := range d.Islands[0].Buildings {
		if b.Type == typ {
			ids = append(ids, b.ID)
		}
	}
	return ids
}

// TestGetWorldInitialState: a new world starts at sea (D-051): no island
// settled, the start ship idle at its sea position with the starting stock
// aboard, the gold on the balance.
func TestGetWorldInitialState(t *testing.T) {
	sea, err := testworld.Sea(catalogue(t), testStart)
	if err != nil {
		t.Fatal(err)
	}
	ts := newTestServerFor(t, sea, testStart, 1)
	w := ts.getWorld()
	if w.Version != 0 {
		t.Fatalf("version = %d", w.Version)
	}
	var d struct {
		Gold    int64 `json:"gold"`
		Islands []struct {
			Settled   bool `json:"settled"`
			Buildings []struct {
				Type string `json:"type"`
			} `json:"buildings"`
		} `json:"islands"`
		Ships []struct {
			State    string `json:"state"`
			IslandID string `json:"island_id"`
			Position *struct {
				X, Y int
			} `json:"position"`
			Cargo []struct {
				Good   string `json:"good"`
				Amount int64  `json:"amount"`
			} `json:"cargo"`
		} `json:"ships"`
	}
	if err := json.Unmarshal(w.Display, &d); err != nil {
		t.Fatal(err)
	}
	if start := catalogue(t).Start; d.Gold != start.Gold {
		t.Fatalf("gold %d", d.Gold)
	}
	for _, is := range d.Islands {
		if is.Settled || len(is.Buildings) != 0 {
			t.Fatalf("island settled at the start: %+v", is)
		}
	}
	if len(d.Ships) != 1 || d.Ships[0].State != "idle" || d.Ships[0].IslandID != "" || d.Ships[0].Position == nil {
		t.Fatalf("ships = %+v", d.Ships)
	}
	aboard := map[string]int64{}
	for _, sl := range d.Ships[0].Cargo {
		aboard[sl.Good] += sl.Amount
	}
	if aboard["planks"] != 150_000 || aboard["sails"] != 10_000 {
		t.Fatalf("aboard %v", aboard)
	}
}

func TestCommandsOfEveryType(t *testing.T) {
	ts := newTestServer(t, 1)
	res := ts.command(cmdRoad, nil)
	if res.status != http.StatusOK {
		t.Fatalf("place_road: %d %s", res.status, res.body)
	}
	ts.clock.Add(time.Second)
	res = ts.command(cmdSawmill, nil)
	if res.status != http.StatusOK {
		t.Fatalf("place_building: %d %s", res.status, res.body)
	}
	var w worldJSON
	_ = json.Unmarshal(res.body, &w)
	if w.Version != 2 {
		t.Fatalf("version = %d, want 2", w.Version)
	}
	id := buildingIDs(t, w.Display, "sawmill")[0]

	steps := []struct {
		name, cmd string
	}{
		{"set_paused", fmt.Sprintf(`{"type":"set_paused","island_id":"start","building_id":%d,"paused":true}`, id)},
		{"set_paused resume", fmt.Sprintf(`{"type":"set_paused","island_id":"start","building_id":%d,"paused":false}`, id)},
		{"demolish_road", cmdRoadRemove},
		{"demolish", fmt.Sprintf(`{"type":"demolish","island_id":"start","building_id":%d}`, id)},
	}
	for i, st := range steps {
		v := int64(2 + i)
		res := ts.command(st.cmd, &v)
		if res.status != http.StatusOK {
			t.Fatalf("%s: %d %s", st.name, res.status, res.body)
		}
		_ = json.Unmarshal(res.body, &w)
		if w.Version != v+1 {
			t.Fatalf("%s: version %d, want %d", st.name, w.Version, v+1)
		}
	}
	// upgrade_house: the seeded island has no full house, so the server
	// answers with a 409 conflict and the world is unchanged.
	res = ts.command(`{"type":"place_building","island_id":"start","building_type":"house_settlers","x":8,"y":5,"rotation":180}`, nil)
	if res.status != http.StatusOK {
		t.Fatalf("place house: %d %s", res.status, res.body)
	}
	_ = json.Unmarshal(res.body, &w)
	house := buildingIDs(t, w.Display, "house_settlers")[0]
	res = ts.command(fmt.Sprintf(`{"type":"upgrade_house","island_id":"start","building_id":%d}`, house), nil)
	if res.status != http.StatusConflict {
		t.Fatalf("upgrade_house: %d %s", res.status, res.body)
	}
	if code := errorCode(t, res); code != "house_not_full" && code != "upgrade_unavailable" && code != "tier_locked" {
		t.Fatalf("upgrade_house code %q", code)
	}
	if got := ts.getWorld().Version; got != w.Version {
		t.Fatalf("version after failed upgrade = %d, want %d", got, w.Version)
	}

	// upgrade_warehouse: the seeded Trading Post needs stone (none on the
	// start island yet): 409 insufficient_*, world unchanged; a house is
	// not a warehouse: upgrade_unavailable.
	wh := buildingIDs(t, w.Display, "trading_post")[0]
	res = ts.command(fmt.Sprintf(`{"type":"upgrade_trading_post","island_id":"start","building_id":%d}`, wh), nil)
	if code := errorCode(t, res); res.status != http.StatusConflict || (code != "insufficient_materials" && code != "insufficient_gold") {
		t.Fatalf("upgrade_warehouse without stone: %d %s", res.status, res.body)
	}
	res = ts.command(fmt.Sprintf(`{"type":"upgrade_warehouse","island_id":"start","building_id":%d}`, house), nil)
	if code := errorCode(t, res); res.status != http.StatusConflict || code != "upgrade_unavailable" {
		t.Fatalf("upgrade_warehouse of a house: %d %s", res.status, res.body)
	}
	if res := ts.do(http.MethodPost, "/api/v1/world/commands", `{"command":{"type":"upgrade_warehouse","island_id":"start"}}`, false); res.status != http.StatusBadRequest || errorCode(t, res) != "invalid_command" {
		t.Fatalf("upgrade_warehouse without building_id: %d %s", res.status, res.body)
	}
	if got := ts.getWorld().Version; got != w.Version {
		t.Fatalf("version after failed warehouse upgrades = %d, want %d", got, w.Version)
	}
	// With the materials (granted directly into the stored world) the
	// upgrade succeeds and the warehouse is at level 2.
	ts.mutateWorld(func(world *sim.World) {
		world.Gold += 1_000_000
		if err := sim.AddStock(world, catalogue(t), "start", "stone", 20_000, nil); err != nil {
			t.Fatal(err)
		}
	})
	res = ts.command(fmt.Sprintf(`{"type":"upgrade_trading_post","island_id":"start","building_id":%d}`, wh), nil)
	if res.status != http.StatusOK {
		t.Fatalf("upgrade_warehouse: %d %s", res.status, res.body)
	}
	_ = json.Unmarshal(res.body, &w)
	var ds sim.DisplayState
	if err := json.Unmarshal(w.Display, &ds); err != nil {
		t.Fatal(err)
	}
	for _, b := range ds.Islands[0].Buildings {
		if b.ID == wh && (b.Level == nil || *b.Level != 2 || *b.Capacity != 500_000) {
			t.Errorf("warehouse after upgrade: level %v capacity %v", b.Level, b.Capacity)
		}
	}
}

// TestMoveBuilding: move_building keeps the building ID, changes its
// position, increments the version and answers with the documented error
// codes; every response validates against openapi.yaml.
func TestMoveBuilding(t *testing.T) {
	ts := newTestServer(t, 1)
	for _, cmd := range []string{cmdRoad, cmdSawmill} {
		if res := ts.command(cmd, nil); res.status != http.StatusOK {
			t.Fatalf("setup: %d %s", res.status, res.body)
		}
	}
	w := ts.getWorld()
	id := buildingIDs(t, w.Display, "sawmill")[0]
	move := func(x, y, rot int) string {
		return fmt.Sprintf(`{"type":"move_building","island_id":"start","building_id":%d,"x":%d,"y":%d,"rotation":%d}`, id, x, y, rot)
	}

	res := ts.command(move(12, 5, 0), &w.Version)
	if res.status != http.StatusOK {
		t.Fatalf("move_building: %d %s", res.status, res.body)
	}
	var moved worldJSON
	if err := json.Unmarshal(res.body, &moved); err != nil {
		t.Fatal(err)
	}
	if moved.Version != w.Version+1 {
		t.Errorf("version %d, want %d", moved.Version, w.Version+1)
	}
	var d struct {
		Islands []struct {
			Buildings []struct {
				ID       int64 `json:"id"`
				X        int   `json:"x"`
				Y        int   `json:"y"`
				Rotation int   `json:"rotation"`
			} `json:"buildings"`
		} `json:"islands"`
	}
	if err := json.Unmarshal(moved.Display, &d); err != nil {
		t.Fatal(err)
	}
	if ids := buildingIDs(t, moved.Display, "sawmill"); len(ids) != 1 || ids[0] != id || len(d.Islands[0].Buildings) != 2 {
		t.Fatalf("sawmills %v, buildings %d", ids, len(d.Islands[0].Buildings))
	}
	for _, b := range d.Islands[0].Buildings {
		if b.ID == id && (b.X != 12 || b.Y != 5 || b.Rotation != 0) {
			t.Errorf("sawmill at (%d,%d) rotation %d", b.X, b.Y, b.Rotation)
		}
	}

	errs := []struct {
		name, cmd string
		validate  bool // the request itself is valid per openapi.yaml
		status    int
		code      string
	}{
		{"missing rotation", fmt.Sprintf(`{"type":"move_building","island_id":"start","building_id":%d,"x":12,"y":5}`, id), false, 400, "invalid_command"},
		{"unknown field", fmt.Sprintf(`{"type":"move_building","island_id":"start","building_id":%d,"x":12,"y":5,"rotation":0,"cost":0}`, id), false, 400, CodeBadRequest},
		{"unknown building", `{"type":"move_building","island_id":"start","building_id":999,"x":12,"y":5,"rotation":0}`, true, 404, "building_not_found"},
		{"occupied by road", move(5, 3, 0), true, 409, "occupied"},
		{"max x", move(math.MaxInt64, 5, 0), true, 400, "out_of_bounds"},
		{"max y", move(12, math.MaxInt64, 0), true, 400, "out_of_bounds"},
		{"min x", move(math.MinInt64, 5, 90), true, 400, "out_of_bounds"},
		{"min y", move(12, math.MinInt64, 270), true, 400, "out_of_bounds"},
	}
	for _, e := range errs {
		t.Run(e.name, func(t *testing.T) {
			res := ts.do(http.MethodPost, "/api/v1/world/commands", `{"command":`+e.cmd+`}`, e.validate)
			if res.status != e.status || errorCode(t, res) != e.code {
				t.Fatalf("%d %s, want %d %s", res.status, res.body, e.status, e.code)
			}
			ts.spec.validateSchema(t, "ErrorResponse", res.body)
		})
	}
	if got := ts.getWorld().Version; got != moved.Version {
		t.Errorf("version after failed moves = %d, want %d", got, moved.Version)
	}
	if err := json.Unmarshal(ts.getWorld().Display, &d); err != nil {
		t.Fatal(err)
	}
	for _, b := range d.Islands[0].Buildings {
		if b.ID == id && (b.X != 12 || b.Y != 5 || b.Rotation != 0) {
			t.Errorf("sawmill moved by a failed command to (%d,%d) rotation %d", b.X, b.Y, b.Rotation)
		}
	}
	// Placement never requires a road (D-042): no road-at-placement code.
	for _, code := range ErrorCodes() {
		if strings.HasPrefix(code, "no_road_at") {
			t.Errorf("error code %s still exists", code)
		}
	}
}

func TestStaleVersionIsLoggedNotRejected(t *testing.T) {
	ts := newTestServer(t, 1)
	v := int64(41)
	if res := ts.command(cmdRoad, &v); res.status != http.StatusOK {
		t.Fatalf("%d %s", res.status, res.body)
	}
	if !strings.Contains(ts.logs.String(), "stale client version") {
		t.Fatalf("no stale-version log line in %q", ts.logs.String())
	}
}

func TestErrorResponses(t *testing.T) {
	ts := newTestServer(t, 1)
	cases := []struct {
		name, method, path, body string
		validate                 bool
		status                   int
		code                     string
	}{
		{"malformed JSON", http.MethodPost, "/api/v1/world/commands", `{"command":`, false, 400, CodeBadRequest},
		{"unknown field", http.MethodPost, "/api/v1/world/commands", `{"command":` + cmdSawmill + `,"extra":1}`, false, 400, CodeBadRequest},
		{"unknown command field", http.MethodPost, "/api/v1/world/commands", `{"command":{"type":"set_paused","island_id":"start","building_id":1,"paused":true,"x":1}}`, false, 400, CodeBadRequest},
		{"trailing data", http.MethodPost, "/api/v1/world/commands", `{"command":` + cmdSawmill + `} {}`, false, 400, CodeBadRequest},
		{"unknown type", http.MethodPost, "/api/v1/world/commands", `{"command":{"type":"teleport"}}`, false, 400, "invalid_command"},
		{"missing field", http.MethodPost, "/api/v1/world/commands", `{"command":{"type":"place_building","island_id":"start","building_type":"sawmill","x":1,"y":1}}`, false, 400, "invalid_command"},
		{"unknown building", http.MethodPost, "/api/v1/world/commands", `{"command":{"type":"place_building","island_id":"start","building_type":"castle","x":10,"y":10,"rotation":0}}`, true, 400, "unknown_building"},
		{"unknown island", http.MethodPost, "/api/v1/world/commands", `{"command":{"type":"place_building","island_id":"nope","building_type":"sawmill","x":10,"y":10,"rotation":0}}`, true, 404, "unknown_island"},
		{"building not found", http.MethodPost, "/api/v1/world/commands", `{"command":{"type":"demolish","island_id":"start","building_id":999}}`, true, 404, "building_not_found"},
		{"terrain", http.MethodPost, "/api/v1/world/commands", `{"command":` + cmdOnWater + `}`, true, 409, "terrain"},
		{"max x", http.MethodPost, "/api/v1/world/commands", `{"command":{"type":"place_building","island_id":"start","building_type":"sawmill","x":9223372036854775807,"y":5,"rotation":0}}`, true, 400, "out_of_bounds"},
		{"max y", http.MethodPost, "/api/v1/world/commands", `{"command":{"type":"place_building","island_id":"start","building_type":"sawmill","x":10,"y":9223372036854775807,"rotation":0}}`, true, 400, "out_of_bounds"},
		{"min x", http.MethodPost, "/api/v1/world/commands", `{"command":{"type":"place_building","island_id":"start","building_type":"sawmill","x":-9223372036854775808,"y":5,"rotation":0}}`, true, 400, "out_of_bounds"},
		{"min y", http.MethodPost, "/api/v1/world/commands", `{"command":{"type":"place_building","island_id":"start","building_type":"sawmill","x":10,"y":-9223372036854775808,"rotation":0}}`, true, 400, "out_of_bounds"},
		{"unknown island data", http.MethodGet, "/api/v1/world/islands/nope/tiles", "", true, 404, "unknown_island"},
		{"method", http.MethodDelete, "/api/v1/world", "", false, 405, CodeMethodNotAllowed},
		{"unknown endpoint", http.MethodGet, "/api/v1/nope", "", false, 404, CodeNotFound},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			res := ts.do(c.method, c.path, c.body, c.validate)
			if res.status != c.status {
				t.Fatalf("status %d, want %d (%s)", res.status, c.status, res.body)
			}
			if got := errorCode(t, res); got != c.code {
				t.Fatalf("code %q, want %q", got, c.code)
			}
			ts.spec.validateSchema(t, "ErrorResponse", res.body)
			if res.header.Get("Access-Control-Allow-Origin") != testOrigin && strings.HasPrefix(c.path, "/api/") {
				t.Fatal("missing CORS header")
			}
		})
	}
	if v := ts.getWorld().Version; v != 0 {
		t.Fatalf("version after errors = %d", v)
	}
}

func TestMethodNotAllowedValidatesAgainstSpec(t *testing.T) {
	ts := newTestServer(t, 1)
	res := ts.do(http.MethodPost, "/api/v1/world", "", false)
	if res.status != http.StatusMethodNotAllowed || res.header.Get("Allow") != http.MethodGet {
		t.Fatalf("%d allow=%q", res.status, res.header.Get("Allow"))
	}
	ts.spec.validateSchema(t, "ErrorResponse", res.body)
}

func TestBodyLimit(t *testing.T) {
	ts := newTestServer(t, 1)
	body := `{"command":{"type":"place_road","island_id":"start","road_type":"road_dirt","tiles":[` + strings.Repeat(`{"x":1,"y":1},`, 6000) + `{"x":1,"y":1}]}}`
	res := ts.do(http.MethodPost, "/api/v1/world/commands", body, false)
	if res.status != http.StatusBadRequest || errorCode(t, res) != CodeBadRequest {
		t.Fatalf("%d %s", res.status, res.body)
	}
}

func TestTileCountLimitedToIslandArea(t *testing.T) {
	ts := newTestServer(t, 1)
	// 56x40 = 2240 tiles on the dev island; 2241 short tiles fit in 64 KiB.
	var b strings.Builder
	for i := range 2241 {
		if i > 0 {
			b.WriteByte(',')
		}
		fmt.Fprintf(&b, `{"x":%d,"y":%d}`, i%10, i/1000)
	}
	body := `{"command":{"type":"demolish_road","island_id":"start","tiles":[` + b.String() + `]}}`
	res := ts.do(http.MethodPost, "/api/v1/world/commands", body, false)
	if res.status != http.StatusBadRequest || errorCode(t, res) != "invalid_command" {
		t.Fatalf("%d %s", res.status, res.body)
	}
}

func TestPreflight(t *testing.T) {
	ts := newTestServer(t, 1)
	for _, path := range []string{"/api/v1/world", "/api/v1/world/commands", "/api/v1/content"} {
		res := ts.do(http.MethodOptions, path, "", true)
		if res.status != http.StatusNoContent {
			t.Fatalf("%s: %d", path, res.status)
		}
		h := res.header
		if h.Get("Access-Control-Allow-Origin") != testOrigin || h.Get("Access-Control-Allow-Methods") != "GET, POST, OPTIONS" || h.Get("Access-Control-Allow-Headers") != "Content-Type" {
			t.Fatalf("%s: headers %v", path, h)
		}
	}
}

// TestCORSOrigins: every configured origin is echoed (the Vite dev server is
// reached as localhost or 127.0.0.1, which browsers treat as different
// origins); other origins get no Access-Control-Allow-Origin.
func TestCORSOrigins(t *testing.T) {
	ts := newTestServer(t, 1)
	for _, c := range []struct{ origin, want string }{
		{testOrigin, testOrigin},
		{testOriginLoopback, testOriginLoopback},
		{"http://127.0.0.1:5137", ""},
		{"http://evil.example", ""},
		{"", ""},
	} {
		for _, method := range []string{http.MethodGet, http.MethodOptions} {
			req := httptest.NewRequestWithContext(context.Background(), method, "/api/v1/world", nil)
			if c.origin != "" {
				req.Header.Set("Origin", c.origin)
			}
			rec := httptest.NewRecorder()
			ts.srv.ServeHTTP(rec, req)
			if got := rec.Header().Get("Access-Control-Allow-Origin"); got != c.want {
				t.Errorf("%s Origin %q: Access-Control-Allow-Origin %q, want %q", method, c.origin, got, c.want)
			}
			if !slices.Contains(rec.Header().Values("Vary"), "Origin") {
				t.Errorf("%s Origin %q: missing Vary: Origin", method, c.origin)
			}
		}
	}
}

func TestHealthAndContent(t *testing.T) {
	ts := newTestServer(t, 1)
	if res := ts.do(http.MethodGet, "/healthz", "", true); res.status != 200 || strings.TrimSpace(string(res.body)) != `{"status":"ok"}` {
		t.Fatalf("healthz: %d %s", res.status, res.body)
	}
	res := ts.do(http.MethodGet, "/api/v1/content", "", true)
	if res.status != 200 {
		t.Fatalf("content: %d", res.status)
	}
	var c struct {
		Region struct {
			Version string `json:"version"`
			Rules   struct {
				ShipHandlingBaseMs    int64 `json:"ship_handling_base_ms"`
				ShipHandlingMsPerUnit int64 `json:"ship_handling_ms_per_unit"`
				ShipSpeed             int64 `json:"ship_speed_milli_tiles_per_min"`
			} `json:"rules"`
			Camera struct {
				MaxHalfExtent int `json:"max_half_extent"`
			} `json:"camera"`
		} `json:"region"`
		Tiers []json.RawMessage `json:"tiers"`
		Goods []json.RawMessage `json:"goods"`
		Needs []struct {
			ID       string `json:"id"`
			Name     string `json:"name"`
			Category string `json:"category"`
		} `json:"needs"`
		NeedCategories []struct {
			ID   string `json:"id"`
			Name string `json:"name"`
			Icon string `json:"icon"`
		} `json:"need_categories"`
		Buildings []struct {
			ID       string `json:"id"`
			Category string `json:"category"`
			Cost     struct {
				Gold int64 `json:"gold"`
			} `json:"cost"`
			Shipyard *struct {
				Ships []string `json:"ships"`
			} `json:"shipyard"`
			RequiresDeposit string `json:"requires_deposit"`
			WorkArea        *struct {
				Radius        int      `json:"radius"`
				Fertility     string   `json:"fertility"`
				Terrain       []string `json:"terrain"`
				RequiredTiles int      `json:"required_tiles"`
			} `json:"work_area"`
			Fields *struct {
				Type     string `json:"type"`
				Required int    `json:"required"`
				Max      int    `json:"max"`
			} `json:"fields"`
			Field *struct {
				Type      string   `json:"type"`
				Farm      string   `json:"farm"`
				Terrain   []string `json:"terrain"`
				Fertility string   `json:"fertility"`
			} `json:"field"`
			WaterTiles  int `json:"water_tiles"`
			TradingPost *struct {
				Levels []struct {
					Capacity int64 `json:"capacity"`
					Berths   int   `json:"berths"`
					Cost     *struct {
						Gold      int64            `json:"gold"`
						Materials map[string]int64 `json:"materials"`
					} `json:"cost"`
				} `json:"levels"`
			} `json:"trading_post"`
			Warehouse *struct {
				Levels []struct {
					ThroughputPerMin int64 `json:"throughput_per_min"`
					Cost             *struct {
						Gold      int64            `json:"gold"`
						Materials map[string]int64 `json:"materials"`
					} `json:"cost"`
				} `json:"levels"`
			} `json:"warehouse"`
		} `json:"buildings"`
		Ships []struct {
			ID       string `json:"id"`
			Slots    int    `json:"slots"`
			SlotSize int64  `json:"slot_size"`
			BuildMs  int64  `json:"build_ms"`
			Cost     struct {
				Gold      int64            `json:"gold"`
				Materials map[string]int64 `json:"materials"`
			} `json:"cost"`
		} `json:"ships"`
	}
	if err := json.Unmarshal(res.body, &c); err != nil {
		t.Fatal(err)
	}
	if c.Region.Camera.MaxHalfExtent != 120 {
		t.Errorf("camera %+v", c.Region.Camera)
	}
	if c.Region.Version != "old_coast-0.9.0" || len(c.Buildings) != 32 || len(c.Goods) != 18 || len(c.Tiers) != 2 || len(c.Needs) != 9 || len(c.Ships) != 1 {
		t.Fatalf("content: version %s buildings %d goods %d tiers %d needs %d ships %d", c.Region.Version, len(c.Buildings), len(c.Goods), len(c.Tiers), len(c.Needs), len(c.Ships))
	}
	if sh := c.Ships[0]; sh.ID != "sloop" || sh.Slots != 4 || sh.SlotSize != 50_000 || sh.BuildMs != 120_000 || sh.Cost.Gold != catalogue(t).ShipByID["sloop"].Cost.Gold || sh.Cost.Materials["sails"] != 10_000 {
		t.Errorf("sloop = %+v", sh)
	}
	if r := c.Region.Rules; r.ShipHandlingBaseMs != 10_000 || r.ShipHandlingMsPerUnit != 200 || r.ShipSpeed != 60_000 {
		t.Errorf("rules = %+v", c.Region.Rules)
	}
	// Display names: every need has one; categories carry name and icon.
	var cats []string
	for _, nc := range c.NeedCategories {
		cats = append(cats, nc.ID+"="+nc.Name+"/"+nc.Icon)
	}
	if got := strings.Join(cats, ","); got != "food=Food/need:food,drink=Drink/need:drink,clothing=Clothing/need:clothing,comfort=Comfort/need:_fallback,luxury=Luxury/need:_fallback" {
		t.Errorf("need categories = %s", got)
	}
	for _, n := range c.Needs {
		want := map[string]string{"food": "Food", "drink": "Drink", "clothing": "Clothing"}[n.Category]
		if n.Category == "" {
			want = map[string]string{"settlers_market_small": "Market", "citizens_market_small": "Market", "citizens_chapel": "Chapel", "citizens_tavern": "Tavern"}[n.ID]
		}
		if n.Name == "" || n.Name != want {
			t.Errorf("need %s name %q, want %q", n.ID, n.Name, want)
		}
	}
	want := map[string]string{
		"house_settlers": "houses", "road_dirt": "roads", "trading_post": "harbour", "warehouse": "production", "market_small": "public",
		"chapel": "public", "lumberjack": "production", "sawmill": "production", "shipyard": "harbour",
		"house_citizens": "houses", "road_paved": "roads", "tavern": "public", "quarry": "production", "wheat_farm": "production",
		"pasture": "production", "wheat_field": "production", "orchard_plot": "production", "hemp_field": "production",
	}
	for _, b := range c.Buildings {
		if w, ok := want[b.ID]; ok && b.Category != w {
			t.Errorf("%s category %s, want %s", b.ID, b.Category, w)
		}
		if b.ID == "warehouse" && b.Cost.Gold != catalogue(t).BuildingByID["warehouse"].Cost.Gold {
			t.Errorf("warehouse gold cost %d milli-gold", b.Cost.Gold)
		}
		if (b.ID == "shipyard") != (b.Shipyard != nil) || (b.Shipyard != nil && strings.Join(b.Shipyard.Ships, ",") != "sloop") {
			t.Errorf("%s shipyard block %+v", b.ID, b.Shipyard)
		}
		// Format additions of R-5: deposit, fertility and level costs.
		switch b.ID {
		case "quarry", "iron_mine":
			if b.RequiresDeposit != map[string]string{"quarry": "stone", "iron_mine": "iron"}[b.ID] {
				t.Errorf("%s requires_deposit %q", b.ID, b.RequiresDeposit)
			}
		case "wheat_farm", "orchard", "hemp_farm", "sheep_farm":
			// Farms with fields (D-051 part 4): no radius, at most a fertility.
			field := map[string]string{"wheat_farm": "wheat_field", "orchard": "orchard_plot", "hemp_farm": "hemp_field", "sheep_farm": "pasture"}[b.ID]
			required := map[string]int{"wheat_farm": 16, "orchard": 16, "hemp_farm": 16, "sheep_farm": 4}[b.ID]
			fert := map[string]string{"wheat_farm": "wheat", "orchard": "apple", "hemp_farm": "hemp"}[b.ID]
			if (fert == "") != (b.WorkArea == nil) || (b.WorkArea != nil && (b.WorkArea.Fertility != fert || b.WorkArea.Radius != 0 ||
				b.WorkArea.Terrain != nil || b.WorkArea.RequiredTiles != 0)) ||
				b.Fields == nil || b.Fields.Type != field || b.Fields.Required != required || b.Fields.Max != required {
				t.Errorf("%s work area %+v fields %+v", b.ID, b.WorkArea, b.Fields)
			}
		case "wheat_field", "orchard_plot", "hemp_field", "pasture":
			if b.Field == nil || b.Field.Type != b.ID || strings.Join(b.Field.Terrain, ",") != "grass" ||
				b.Field.Fertility != map[string]string{"wheat_field": "wheat", "orchard_plot": "apple", "hemp_field": "hemp"}[b.ID] || b.WorkArea != nil ||
				b.Field.Farm != map[string]string{"wheat_field": "wheat_farm", "orchard_plot": "orchard", "hemp_field": "hemp_farm", "pasture": "sheep_farm"}[b.ID] {
				t.Errorf("%s field %+v", b.ID, b.Field)
			}
		case "lumberjack":
			if b.WorkArea == nil || strings.Join(b.WorkArea.Terrain, ",") != "forest" || b.WorkArea.RequiredTiles != 24 || b.Fields != nil {
				t.Errorf("lumberjack work area %+v", b.WorkArea)
			}
		case "trading_post":
			if l := b.TradingPost.Levels; b.WaterTiles != 2 || len(l) != 4 || l[0].Cost != nil || l[0].Capacity != 300_000 || l[0].Berths != 1 ||
				l[1].Cost == nil || l[1].Cost.Gold <= 0 || l[1].Cost.Materials["stone"] <= 0 || l[3].Berths != 4 {
				t.Errorf("trading post levels %+v", l)
			}
		case "warehouse":
			if l := b.Warehouse.Levels; b.WaterTiles != 0 || len(l) != 3 || l[0].Cost != nil || l[0].ThroughputPerMin != 30_000 || l[1].Cost == nil {
				t.Errorf("warehouse levels %+v", l)
			}
		case "fisher", "shipyard":
			if b.WaterTiles != map[string]int{"fisher": 1, "shipyard": 2}[b.ID] {
				t.Errorf("%s water tiles %d", b.ID, b.WaterTiles)
			}
		default:
			if b.RequiresDeposit != "" || (b.WorkArea != nil && b.WorkArea.Fertility != "") {
				t.Errorf("%s: deposit %q work area %+v", b.ID, b.RequiresDeposit, b.WorkArea)
			}
		}
	}
}

// TestIslandTiles: GET /world/islands/{id}/tiles serves the full rows of
// any island of the session's world (unsettled ones too, R-57); the world
// payload carries the fertilities, the deposits and the 1:4 mask.
func TestIslandTiles(t *testing.T) {
	ts := newTestServer(t, 1)
	res := ts.do(http.MethodGet, "/api/v1/world/islands/start/tiles", "", true)
	if res.status != 200 {
		t.Fatalf("%d %s", res.status, res.body)
	}
	var is tilesResponse
	if err := json.Unmarshal(res.body, &is); err != nil {
		t.Fatal(err)
	}
	if is.ID != testIsland || is.Width != 56 || is.Height != 40 || len(is.Terrain) != 56*40 || is.Revision != "old_coast-0.9.0" {
		t.Fatalf("island %s %dx%d terrain %d revision %s", is.ID, is.Width, is.Height, len(is.Terrain), is.Revision)
	}
	// Row 1 of the dev island starts with water then coast.
	if is.Terrain[1*is.Width+0] != "water" || is.Terrain[1*is.Width+1] != "coast" {
		t.Fatalf("terrain row 1: %v", is.Terrain[is.Width:is.Width+3])
	}
	if res.header.Get("ETag") != tilesETag(0, 0, testIsland) || res.header.Get("Cache-Control") != tilesCacheControl {
		t.Errorf("headers %v", res.header)
	}
	terrain := map[string][]string{testIsland: is.Terrain}
	res = ts.do(http.MethodGet, "/api/v1/world/islands/island2/tiles?v=0-0", "", true)
	var is2 tilesResponse
	if err := json.Unmarshal(res.body, &is2); err != nil || res.status != 200 || is2.ID != "island2" || !slices.Contains(is2.Terrain, "mountain") {
		t.Fatalf("island2: %d %s", res.status, res.body)
	}
	terrain["island2"] = is2.Terrain

	// The payload: fertilities, deposits sorted by tile index (R-15) on
	// mountain tiles, and the mask of the rows.
	ds := archipelagoView(t, ts.getWorld())
	want := map[string]struct{ fertilities, deposit string }{testIsland: {"wheat,apple", "stone"}, "island2": {"hemp", "iron"}}
	for _, d := range ds.Islands {
		w, ok := want[d.ID]
		if !ok {
			continue
		}
		if strings.Join(d.Fertilities, ",") != w.fertilities {
			t.Errorf("%s fertilities = %v", d.ID, d.Fertilities)
		}
		rows := terrain[d.ID]
		if len(d.Deposits) < 4 {
			t.Errorf("%s deposits = %+v", d.ID, d.Deposits)
		}
		for i, dep := range d.Deposits {
			if dep.Kind != w.deposit || rows[dep.Y*d.Width+dep.X] != "mountain" {
				t.Errorf("%s deposit %+v on %s", d.ID, dep, rows[dep.Y*d.Width+dep.X])
			}
			if i > 0 && dep.Y*d.Width+dep.X <= d.Deposits[i-1].Y*d.Width+d.Deposits[i-1].X {
				t.Errorf("%s deposits not sorted: %+v", d.ID, d.Deposits)
			}
		}
		tiles := make([]sim.Tile, len(rows))
		for i, r := range rows {
			tiles[i] = sim.Tile{Terrain: r}
		}
		if m := sim.TerrainMask(&sim.Island{Width: d.Width, Height: d.Height, Tiles: tiles}); d.TerrainMask != m || len(m) != ((d.Width+3)/4)*((d.Height+3)/4) {
			t.Errorf("%s mask %q, want %q", d.ID, d.TerrainMask, m)
		}
	}
}

// TestIslandTilesCaching: the rows carry an ETag from seed, roll and
// island ID and are immutable; a matching If-None-Match answers 304 (also
// in a list or weak), another one the rows; a cache key of another roll
// is answered no-store.
func TestIslandTilesCaching(t *testing.T) {
	ts := newTestServer(t, 1)
	path := "/api/v1/world/islands/start/tiles"
	etag := tilesETag(0, 0, testIsland)
	get := func(path, inm string) response {
		t.Helper()
		req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, path, nil)
		req.Header.Set("Origin", testOrigin)
		if inm != "" {
			req.Header.Set("If-None-Match", inm)
		}
		rec := httptest.NewRecorder()
		ts.srv.ServeHTTP(rec, req)
		res := response{status: rec.Code, header: rec.Header(), body: rec.Body.Bytes()}
		ts.spec.validate(t, http.MethodGet, path, "", res)
		return res
	}
	for _, inm := range []string{etag, `"x", ` + etag, "W/" + etag, "*"} {
		res := get(path, inm)
		if res.status != http.StatusNotModified || len(res.body) != 0 || res.header.Get("ETag") != etag || res.header.Get("Cache-Control") != tilesCacheControl {
			t.Errorf("If-None-Match %s: %d %v %q", inm, res.status, res.header, res.body)
		}
	}
	if res := get(path, `"other"`); res.status != http.StatusOK || res.header.Get("ETag") != etag || len(res.body) == 0 {
		t.Errorf("other ETag: %d %v", res.status, res.header)
	}
	if res := get(path+"?v=0-0", ""); res.header.Get("Cache-Control") != tilesCacheControl {
		t.Errorf("current cache key: %v", res.header)
	}
	if res := get(path+"?v=0-1", ""); res.status != http.StatusOK || res.header.Get("Cache-Control") != "no-store" {
		t.Errorf("stale cache key: %d %v", res.status, res.header)
	}
	// The route is exactly /world/islands/{id}/tiles; the former static
	// endpoint is gone.
	for _, p := range []string{"/api/v1/world/islands/start", "/api/v1/world/islands//tiles", "/api/v1/world/islands/a/b/tiles"} {
		if res := ts.do(http.MethodGet, p, "", false); res.status != http.StatusNotFound || errorCode(t, res) != CodeNotFound {
			t.Errorf("%s: %d %s", p, res.status, res.body)
		}
	}
	if a, b := tilesETag(1, 0, "a"), tilesETag(1, 1, "a"); a == b || a == tilesETag(1, 0, "b") || a == tilesETag(2, 0, "a") {
		t.Error("ETag does not follow seed, roll and island")
	}
}

// TestIslandRequestAdvancesTheWorld: GET /world/islands/{id}/tiles advances the
// world like every /api/v1/world* request (A.6) without a new version.
func TestIslandRequestAdvancesTheWorld(t *testing.T) {
	ts := newTestServer(t, 1)
	ts.clock.Add(5 * time.Second)
	if res := ts.do(http.MethodGet, "/api/v1/world/islands/start/tiles", "", true); res.status != http.StatusOK {
		t.Fatalf("%d %s", res.status, res.body)
	}
	// Step the wall clock back: the next GET is clamped to the last
	// evaluation, which the island request must have moved to start+5s.
	ts.clock.Add(-5 * time.Second)
	w := ts.getWorld()
	if got := evaluatedAt(t, w); !got.Equal(testStart.Add(5 * time.Second)) {
		t.Fatalf("evaluated_at = %s, want %s", got, testStart.Add(5*time.Second))
	}
	if w.Version != 0 {
		t.Fatalf("version = %d after an island request", w.Version)
	}
}

func TestFailedCommandLeavesDisplayIdentical(t *testing.T) {
	ts := newTestServer(t, 1)
	ts.clock.Add(1500 * time.Millisecond)
	before := ts.getWorld()
	res := ts.command(cmdOnWater, nil)
	if res.status != http.StatusConflict {
		t.Fatalf("%d", res.status)
	}
	after := ts.getWorld()
	if after.Version != before.Version || !bytes.Equal(after.Display, before.Display) {
		t.Fatal("failed command changed the world")
	}
}

func evaluatedAt(t *testing.T, w worldJSON) time.Time {
	t.Helper()
	at, err := time.Parse(time.RFC3339, decodeDisplay(t, w.Display)["evaluated_at"].(string))
	if err != nil {
		t.Fatal(err)
	}
	return at
}

func TestTimeAdvancesAndClamps(t *testing.T) {
	ts := newTestServer(t, 1)
	t0 := evaluatedAt(t, ts.getWorld())
	ts.clock.Add(2500 * time.Millisecond)
	t1 := evaluatedAt(t, ts.getWorld())
	if d := t1.Sub(t0); d != 2500*time.Millisecond {
		t.Fatalf("advanced %s, want 2.5s", d)
	}
	ts.clock.Add(-10 * time.Second) // wall clock steps backwards
	t2 := evaluatedAt(t, ts.getWorld())
	if !t2.Equal(t1) {
		t.Fatalf("backwards clock: evaluated_at %s, want clamp to %s", t2, t1)
	}
	if res := ts.command(cmdRoad, nil); res.status != http.StatusOK {
		t.Fatalf("command after clock step: %d %s", res.status, res.body)
	}
}

func TestTimeScale(t *testing.T) {
	ts := newTestServer(t, 10)
	t0 := evaluatedAt(t, ts.getWorld())
	ts.clock.Add(time.Second)
	t1 := evaluatedAt(t, ts.getWorld())
	if d := t1.Sub(t0); d != 10*time.Second {
		t.Fatalf("1 s wall advanced the world by %s, want 10s", d)
	}
}

func TestConcurrentCommandsSerialise(t *testing.T) {
	ts := newTestServer(t, 1)
	const n = 20
	var wg sync.WaitGroup
	statuses := make([]int, n)
	for i := range n {
		wg.Add(1)
		go func() {
			defer wg.Done()
			cmd := fmt.Sprintf(`{"type":"place_road","island_id":"start","road_type":"road_dirt","tiles":[{"x":%d,"y":4}]}`, 3+i)
			req := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/api/v1/world/commands", strings.NewReader(`{"command":`+cmd+`}`))
			rec := httptest.NewRecorder()
			ts.srv.ServeHTTP(rec, req)
			statuses[i] = rec.Code
		}()
	}
	wg.Wait()
	for i, s := range statuses {
		if s != http.StatusOK {
			t.Fatalf("command %d: status %d", i, s)
		}
	}
	if v := ts.getWorld().Version; v != n {
		t.Fatalf("version = %d, want %d", v, n)
	}
}
