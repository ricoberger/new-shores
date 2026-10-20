package api

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
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
	"github.com/ricoberger/new-shores/server/internal/devworld"
	"github.com/ricoberger/new-shores/server/internal/store"
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
)

func catalogue(t testing.TB) *content.Catalogue {
	t.Helper()
	catOnce.Do(func() { cat, catErr = content.Load(filepath.Join(repoRoot(t), "content", "old_coast")) })
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
	clock *fakeClock
	logs  *bytes.Buffer
	spec  *specValidator
}

func newTestServer(t *testing.T, scale float64) *testServer {
	t.Helper()
	c := catalogue(t)
	w, err := devworld.New(c, testStart)
	if err != nil {
		t.Fatal(err)
	}
	clock := &fakeClock{now: testStart}
	logs := &bytes.Buffer{}
	srv, err := New(Config{
		Store:        store.NewMemory(testWorld, w),
		Catalogue:    c,
		Clock:        clock,
		TimeScale:    TimeScale{Start: testStart, Scale: scale},
		ResolveWorld: func(*http.Request) (store.WorldID, error) { return testWorld, nil },
		CORSOrigins:  []string{testOrigin, testOriginLoopback},
		Logger:       slog.New(slog.NewTextHandler(&syncWriter{w: logs}, nil)),
	})
	if err != nil {
		t.Fatal(err)
	}
	return &testServer{t: t, srv: srv, clock: clock, logs: logs, spec: loadSpec(t)}
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

func TestGetWorldInitialState(t *testing.T) {
	ts := newTestServer(t, 1)
	w := ts.getWorld()
	if w.Version != 0 {
		t.Fatalf("version = %d", w.Version)
	}
	var d struct {
		Gold    int64 `json:"gold"`
		Islands []struct {
			Inventory map[string]struct {
				Stock int64 `json:"stock"`
			} `json:"inventory"`
			Buildings []struct {
				Type string `json:"type"`
			} `json:"buildings"`
		} `json:"islands"`
	}
	if err := json.Unmarshal(w.Display, &d); err != nil {
		t.Fatal(err)
	}
	inv := d.Islands[0].Inventory
	if d.Gold != 500_000 || inv["planks"].Stock != 130_000 || inv["sails"].Stock != 10_000 {
		t.Fatalf("gold %d planks %d sails %d", d.Gold, inv["planks"].Stock, inv["sails"].Stock)
	}
	if len(d.Islands[0].Buildings) != 1 || d.Islands[0].Buildings[0].Type != "warehouse" {
		t.Fatalf("buildings = %+v", d.Islands[0].Buildings)
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
	// Placement never requires a road (D-042): the entrance code is gone.
	if slices.Contains(ErrorCodes(), "no_road_at_entrance") {
		t.Error("no_road_at_entrance is still an error code")
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
		{"unknown island data", http.MethodGet, "/api/v1/world/islands/nope", "", true, 404, "unknown_island"},
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
		} `json:"region"`
		Tiers     []json.RawMessage `json:"tiers"`
		Goods     []json.RawMessage `json:"goods"`
		Needs     []json.RawMessage `json:"needs"`
		Buildings []struct {
			ID       string `json:"id"`
			Category string `json:"category"`
			Cost     struct {
				Gold int64 `json:"gold"`
			} `json:"cost"`
		} `json:"buildings"`
	}
	if err := json.Unmarshal(res.body, &c); err != nil {
		t.Fatal(err)
	}
	if c.Region.Version != "old_coast-0.2.0" || len(c.Buildings) != 10 || len(c.Goods) != 6 || len(c.Tiers) != 2 || len(c.Needs) != 3 {
		t.Fatalf("content: version %s buildings %d goods %d tiers %d needs %d", c.Region.Version, len(c.Buildings), len(c.Goods), len(c.Tiers), len(c.Needs))
	}
	want := map[string]string{
		"house_settlers": "houses", "road_dirt": "roads", "warehouse": "harbour", "market_small": "public",
		"chapel": "public", "lumberjack": "production", "sawmill": "production",
	}
	for _, b := range c.Buildings {
		if w, ok := want[b.ID]; ok && b.Category != w {
			t.Errorf("%s category %s, want %s", b.ID, b.Category, w)
		}
		if b.ID == "warehouse" && b.Cost.Gold != 200_000 {
			t.Errorf("warehouse gold cost %d milli-gold", b.Cost.Gold)
		}
	}
}

func TestIslandData(t *testing.T) {
	ts := newTestServer(t, 1)
	res := ts.do(http.MethodGet, "/api/v1/world/islands/start", "", true)
	if res.status != 200 {
		t.Fatalf("%d %s", res.status, res.body)
	}
	var is islandResponse
	if err := json.Unmarshal(res.body, &is); err != nil {
		t.Fatal(err)
	}
	if is.ID != testIsland || is.Width != 56 || is.Height != 40 || len(is.Terrain) != 56*40 || is.Revision != "old_coast-0.2.0" {
		t.Fatalf("island %s %dx%d terrain %d revision %s", is.ID, is.Width, is.Height, len(is.Terrain), is.Revision)
	}
	// Row 1 of the dev island starts with water then coast.
	if is.Terrain[1*is.Width+0] != "water" || is.Terrain[1*is.Width+1] != "coast" {
		t.Fatalf("terrain row 1: %v", is.Terrain[is.Width:is.Width+3])
	}
}

// TestIslandRequestAdvancesTheWorld: GET /world/islands/{id} advances the
// world like every /api/v1/world* request (A.6) without a new version.
func TestIslandRequestAdvancesTheWorld(t *testing.T) {
	ts := newTestServer(t, 1)
	ts.clock.Add(5 * time.Second)
	if res := ts.do(http.MethodGet, "/api/v1/world/islands/start", "", true); res.status != http.StatusOK {
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
