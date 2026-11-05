package api

import (
	"net/http"
	"testing"

	"github.com/ricoberger/new-shores/server/internal/sim"
)

// Two GET /world requests build the sea grid once (item 8): the grid is
// cached per archipelago, not rebuilt per request.
func TestGetWorldBuildsSeaGridOnce(t *testing.T) {
	ts := newTestServer(t, 1)
	ts.mutateWorld(func(w *sim.World) { w.Seed = 7 }) // a seeded archipelago is cacheable
	for range 2 {
		if res := ts.do(http.MethodGet, "/api/v1/world", "", false); res.status != http.StatusOK {
			t.Fatalf("status %d: %s", res.status, res.body)
		}
	}
	if got := ts.srv.seaGrids.builds; got != 1 {
		t.Fatalf("sea grid built %d times for two requests, want 1", got)
	}
}

// A world without a seed (hand-made islands) is never cached.
func TestGetWorldSeaGridNotCachedWithoutSeed(t *testing.T) {
	ts := newTestServer(t, 1)
	for range 2 {
		ts.do(http.MethodGet, "/api/v1/world", "", false)
	}
	if got := ts.srv.seaGrids.builds; got != 0 {
		t.Fatalf("sea grid built %d times for an unseeded world, want 0", got)
	}
}
