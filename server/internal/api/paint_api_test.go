package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"testing"

	"github.com/ricoberger/new-shores/server/internal/sim"
	"github.com/ricoberger/new-shores/server/internal/testworld"
)

// TestPaintCommands (D-077 §2–§3): place_paint and demolish_paint are
// batch commands with per-tile results; a body without the paint type is
// invalid.
func TestPaintCommands(t *testing.T) {
	c := shippedCatalogue(t)
	w, err := testworld.Founded(c, testStart)
	if err != nil {
		t.Fatal(err)
	}
	w.UnlockedTiers = append(w.UnlockedTiers, "citizens") // ornaments start with the Citizens (D-078 §2)
	// Two free tiles side by side and a free third one after them.
	is := w.Islands()[0]
	hedge := c.BuildingByID["hedge"]
	var x, y int
	for i := 0; i < is.Width*is.Height && x == 0; i++ {
		tx, ty := i%is.Width, i/is.Width
		if sim.CheckSite(is, c, hedge, tx, ty, 0) == nil && sim.CheckSite(is, c, hedge, tx+1, ty, 0) == nil && sim.CheckSite(is, c, hedge, tx+2, ty, 0) == nil {
			x, y = tx, ty
		}
	}
	island := is.ID
	ts := newTestServerWith(t, w, testStart, 1, c)
	before := ts.getWorld()
	res := ts.command(fmt.Sprintf(`{"type":"place_paint","island_id":%q,"building_type":"hedge","tiles":%s}`, island, tileList([2]int{x, y}, [2]int{x + 1, y})), nil)
	if res.status != http.StatusOK {
		t.Fatalf("place_paint: %d %s", res.status, res.body)
	}
	var b batchJSON
	if err := json.Unmarshal(res.body, &b); err != nil {
		t.Fatal(err)
	}
	if b.Version != before.Version+1 || len(b.TileResults) != 2 || !b.TileResults[0].OK || !b.TileResults[1].OK {
		t.Fatalf("version %d, results %+v", b.Version, b.TileResults)
	}
	if n := len(buildingIDs(t, b.Display, "hedge")); n != 2 {
		t.Fatalf("%d hedges", n)
	}
	res = ts.command(fmt.Sprintf(`{"type":"demolish_paint","island_id":%q,"tiles":%s}`, island, tileList([2]int{x, y}, [2]int{x + 2, y})), nil)
	b = batchJSON{}
	if err := json.Unmarshal(res.body, &b); err != nil {
		t.Fatal(err)
	}
	if res.status != http.StatusOK || len(b.TileResults) != 2 || !b.TileResults[0].OK || b.TileResults[1].Reason != "building_not_found" {
		t.Fatalf("demolish_paint: %d %s", res.status, res.body)
	}
	res = ts.do(http.MethodPost, "/api/v1/world/commands", `{"command":{"type":"place_paint","island_id":"start","tiles":[{"x":1,"y":1}]}}`, false)
	if res.status != http.StatusBadRequest || errorCode(t, res) != "invalid_command" {
		t.Fatalf("missing building_type: %d %s", res.status, res.body)
	}
}
