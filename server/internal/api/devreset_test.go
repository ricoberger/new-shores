package api

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"sync/atomic"
	"testing"
	"time"

	"github.com/ricoberger/new-shores/server/internal/devworld"
	"github.com/ricoberger/new-shores/server/internal/store"
)

type countingPublisher struct{ n atomic.Int64 }

func (p *countingPublisher) Publish(context.Context, store.WorldID) { p.n.Add(1) }

// newResetServer is a dev-mode test server with the reset endpoint wired
// like cmd/server: fixtures are built at the store's world time.
func newResetServer(t *testing.T) (*testServer, *countingPublisher) {
	t.Helper()
	ts := newTestServer(t, 1)
	c := catalogue(t)
	pub := &countingPublisher{}
	now := func() time.Time { return TimeScale{Start: testStart, Scale: 1}.At(ts.clock.Now()) }
	srv, err := New(Config{
		Store:        ts.mem,
		Catalogue:    c,
		Clock:        ts.clock,
		ResolveWorld: func(*http.Request) (store.WorldID, error) { return testWorld, nil },
		Publisher:    pub,
		CORSOrigins:  []string{testOrigin},
		Logger:       slog.New(slog.DiscardHandler),
		DevReset: func(ctx context.Context, fixture string) (int64, error) {
			w, err := devworld.NewFixture(c, fixture, now())
			if err != nil {
				return 0, err
			}
			return ts.mem.Reset(ctx, w)
		},
		DevFixtures: devworld.Fixtures(),
	})
	if err != nil {
		t.Fatal(err)
	}
	ts.srv = srv
	return ts, pub
}

func (ts *testServer) reset(body string) (int64, int) {
	ts.t.Helper()
	res := ts.do(http.MethodPost, "/api/v1/dev/reset", body, false)
	if res.status != http.StatusOK {
		return 0, res.status
	}
	var out devResetResponse
	if err := json.Unmarshal(res.body, &out); err != nil {
		ts.t.Fatal(err)
	}
	return out.Version, res.status
}

// TestDevReset: the dev reset replaces the world (buildings gone, pending
// events dropped, last seen now, no summary), increases the version and
// publishes world_changed; a fixture can be seeded by name.
func TestDevReset(t *testing.T) {
	ts, pub := newResetServer(t)
	// A world with buildings, a ship on a route and pending events.
	v, status := ts.reset(`{"fixture":"settled"}`)
	if status != http.StatusOK {
		t.Fatalf("reset to settled: %d", status)
	}
	w := ts.getWorld()
	if w.Version != v || len(buildingIDs(t, w.Display, "lumberjack")) != 1 {
		t.Fatalf("settled: version %d (reset %d), lumberjacks %v", w.Version, v, buildingIDs(t, w.Display, "lumberjack"))
	}
	ts.clock.Add(time.Minute)
	if len(ts.mem.Pending()) == 0 {
		t.Fatal("the settled fixture has no pending event (its sloop sails a route)")
	}
	before := ts.getWorld().Version

	v2, status := ts.reset("")
	if status != http.StatusOK {
		t.Fatalf("reset: %d", status)
	}
	if v2 <= before {
		t.Errorf("version after reset %d, before %d: must increase", v2, before)
	}
	w = ts.getWorld()
	if w.Version != v2 {
		t.Errorf("GET /world version %d, reset answered %d", w.Version, v2)
	}
	if ids := buildingIDs(t, w.Display, "lumberjack"); len(ids) != 0 {
		t.Errorf("lumberjacks after reset: %v", ids)
	}
	if ids := buildingIDs(t, w.Display, "trading_post"); len(ids) != 1 {
		t.Errorf("warehouses after reset: %v (want the seeded one)", ids)
	}
	if p := ts.mem.Pending(); len(p) != 0 {
		t.Errorf("pending events after reset: %+v", p)
	}
	d := decodeDisplay(t, w.Display)
	if d["away_summary"] != nil || len(d["ships"].([]any)) != 0 {
		t.Errorf("summary %v ships %v after reset", d["away_summary"], d["ships"])
	}
	if pub.n.Load() != 2 {
		t.Errorf("published %d times, want once per reset", pub.n.Load())
	}

	// Unknown fixtures and malformed bodies are 400; the world stays.
	for _, body := range []string{`{"fixture":"nope"}`, `{"fixture":1}`, `{"other":"x"}`} {
		if _, status := ts.reset(body); status != http.StatusBadRequest {
			t.Errorf("reset %s: %d, want 400", body, status)
		}
	}
	if got := ts.getWorld().Version; got != v2 {
		t.Errorf("version %d after rejected resets, want %d", got, v2)
	}
}

// TestDevResetAbsentByDefault: without DevReset, and always in default
// mode (accounts), the endpoint does not exist.
func TestDevResetAbsentByDefault(t *testing.T) {
	ts := newTestServer(t, 1)
	if res := ts.do(http.MethodPost, "/api/v1/dev/reset", "", false); res.status != http.StatusNotFound {
		t.Errorf("dev mode without DevReset: %d, want 404", res.status)
	}
	c := catalogue(t)
	w, err := devworld.New(c, testStart)
	if err != nil {
		t.Fatal(err)
	}
	srv, err := New(Config{
		Store: store.NewMemory(testWorld, w, func() time.Time { return testStart }), Catalogue: c, Clock: WallClock{},
		Accounts: &fakeAccounts{}, CORSOrigins: []string{testOrigin},
		DevReset:    func(context.Context, string) (int64, error) { t.Error("reset called in default mode"); return 0, nil },
		DevFixtures: devworld.Fixtures(),
	})
	if err != nil {
		t.Fatal(err)
	}
	if rec := serveReq(srv, http.MethodPost, "/api/v1/dev/reset", "", map[string]string{"Origin": testOrigin}); rec.Code != http.StatusNotFound {
		t.Errorf("default mode: %d, want 404", rec.Code)
	}
}
