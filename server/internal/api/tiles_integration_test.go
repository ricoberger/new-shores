//go:build integration

package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/ricoberger/new-shores/server/internal/devworld"
	"github.com/ricoberger/new-shores/server/internal/sim"
	"github.com/ricoberger/new-shores/server/internal/sim/archipelago"
)

// get serves a GET with extra headers (validated against openapi.yaml).
func (c *client) get(path string, headers map[string]string) *httptest.ResponseRecorder {
	c.env.t.Helper()
	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, path, nil)
	req.Header.Set("Origin", testOrigin)
	if c.cookie != "" {
		req.Header.Set("Cookie", SessionCookie+"="+c.cookie)
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	rec := httptest.NewRecorder()
	c.env.srv.ServeHTTP(rec, req)
	c.env.spec.validate(c.env.t, http.MethodGet, path, "", response{status: rec.Code, header: rec.Header(), body: rec.Body.Bytes()})
	return rec
}

// TestIslandTilesOverPostgres: the rows of an island are served from the
// session's own world (generated, D-053) with an immutable ETag; a
// matching If-None-Match answers 304; a reroll changes the ETag and the
// rows; another player's session gets its own world's rows; no session
// is a 401.
func TestIslandTilesOverPostgres(t *testing.T) {
	c := catalogue(t)
	var seed atomic.Uint64
	seed.Store(9000)
	env := newPGEnvWith(t, nil, func(now time.Time) (*sim.World, error) { return devworld.New(c, seed.Add(1), now) })
	view := func(cl *client) sim.DisplayState {
		t.Helper()
		_, _, raw := cl.world()
		var ds sim.DisplayState
		if err := json.Unmarshal(raw, &ds); err != nil {
			t.Fatal(err)
		}
		return ds
	}
	tilesOf := func(cl *client, ds sim.DisplayState, island string, inm string) *httptest.ResponseRecorder {
		t.Helper()
		h := map[string]string{}
		if inm != "" {
			h["If-None-Match"] = inm
		}
		return cl.get(fmt.Sprintf("/api/v1/world/islands/%s/tiles?v=%d-%d", island, ds.Archipelago.Seed, ds.Archipelago.Roll), h)
	}

	a := &client{env: env}
	a.must(http.MethodPost, "/api/v1/auth/guest", `{}`, 200)
	dsA := view(a)
	home := dsA.Islands[0]
	rec := tilesOf(a, dsA, home.ID, "")
	var rows tilesResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &rows); err != nil || rec.Code != 200 {
		t.Fatalf("tiles: %d %s", rec.Code, rec.Body)
	}
	etag := rec.Header().Get("ETag")
	if etag != tilesETag(dsA.Archipelago.Seed, 0, archipelago.GeneratorVersion, home.ID) || rec.Header().Get("Cache-Control") != tilesCacheControl {
		t.Fatalf("headers %v", rec.Header())
	}
	if rows.ID != home.ID || rows.Width != home.Width || rows.Height != home.Height || len(rows.Terrain) != home.Width*home.Height {
		t.Fatalf("rows %s %dx%d (%d), island %+v", rows.ID, rows.Width, rows.Height, len(rows.Terrain), home)
	}
	tiles := make([]sim.Tile, len(rows.Terrain))
	for i, r := range rows.Terrain {
		tiles[i] = sim.Tile{Terrain: r}
	}
	if m := sim.TerrainMask(&sim.Island{Width: rows.Width, Height: rows.Height, Tiles: tiles}); m != home.TerrainMask {
		t.Fatal("the payload's mask does not match the rows")
	}

	// Revalidation: 304 without a body.
	if rec := tilesOf(a, dsA, home.ID, etag); rec.Code != http.StatusNotModified || rec.Body.Len() != 0 || rec.Header().Get("ETag") != etag {
		t.Fatalf("304: %d %v %q", rec.Code, rec.Header(), rec.Body)
	}

	// Another player: the same island ID resolves in their own world.
	b := &client{env: env}
	b.must(http.MethodPost, "/api/v1/auth/guest", `{}`, 200)
	dsB := view(b)
	if dsB.Archipelago.Seed == dsA.Archipelago.Seed {
		t.Fatal("both players got the same seed")
	}
	recB := tilesOf(b, dsB, home.ID, etag)
	if recB.Code != http.StatusOK || recB.Header().Get("ETag") == etag || recB.Header().Get("ETag") != tilesETag(dsB.Archipelago.Seed, 0, archipelago.GeneratorVersion, home.ID) {
		t.Fatalf("player B: %d %v", recB.Code, recB.Header())
	}
	// No session: 401.
	anon := &client{env: env}
	if rec := anon.get("/api/v1/world/islands/"+home.ID+"/tiles", nil); rec.Code != http.StatusUnauthorized || code(t, rec) != CodeUnauthorized {
		t.Fatalf("anonymous: %d %s", rec.Code, rec.Body)
	}

	// A reroll: new ETag, the old one no longer matches, the old cache key is no-store.
	a.must(http.MethodPost, "/api/v1/world/commands", `{"command":{"type":"reroll_archipelago"}}`, 200)
	rerolled := view(a)
	rec = tilesOf(a, rerolled, home.ID, etag)
	if rec.Code != http.StatusOK || rec.Header().Get("ETag") != tilesETag(rerolled.Archipelago.Seed, 1, archipelago.GeneratorVersion, home.ID) {
		t.Fatalf("after the reroll: %d %v", rec.Code, rec.Header())
	}
	if rec := tilesOf(a, dsA, home.ID, ""); rec.Code != http.StatusOK || rec.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("stale cache key: %d %v", rec.Code, rec.Header())
	}
}
