package sim

import (
	"bytes"
	"errors"
	"testing"

	"github.com/ricoberger/new-shores/server/internal/content"
)

// TestDemolishRoads: the Demolish tool's rectangle removes the roads and
// planned roads under it in one state change, skips the other tiles with
// their reason, and refunds 50 % of each real tile's materials, rounded
// down per tile; without a road under it, nothing changes.
func TestDemolishRoads(t *testing.T) {
	c := catalogue(t)
	w := testWorld(t, c)
	// The dirt road of testWorld refunds as if it had cost 3 stone
	// (pre-D-054 dirt roads are free): 1 stone back per tile (1.5 rounded
	// down).
	c.BuildingByID["road_dirt"].Cost = content.Cost{Materials: []content.GoodAmount{{Good: "stone", Amount: 3 * content.MilliPerUnit}}}
	mustApply(t, w, c, PlaceRoad{IslandID: "main", Type: "road_dirt", Tiles: []Pos{{6, 7}, {7, 7}, {8, 7}}, Planned: true})
	is := w.Islands()[0]

	before := encodeWorld(t, w)
	empty := []Pos{{6, 8}, {7, 8}, {-1, 0}}
	res, err := ApplyWithResult(w, c, DemolishRoads{IslandID: "main", Tiles: empty}, nil)
	if err != nil || !res.Unchanged || len(res.Tiles) != len(empty) {
		t.Fatalf("no road: %+v, %v", res, err)
	}
	expectApplyErr(t, w, c, DemolishRoads{IslandID: "main", Tiles: []Pos{{6, 4}, {6, 4}}}, ErrInvalidCommand)
	expectApplyErr(t, w, c, DemolishRoads{IslandID: "main"}, ErrInvalidCommand)
	expectApplyErr(t, w, c, DemolishRoads{IslandID: "x", Tiles: []Pos{{6, 4}}}, ErrUnknownIsland)
	if !bytes.Equal(before, encodeWorld(t, w)) {
		t.Fatal("a demolish_roads without a change changed the world")
	}

	// The rectangle x 6..8, y 4..7: three road tiles (y 4), three planned
	// (y 7), the rest grass or forest.
	var rect []Pos
	for y := 4; y <= 7; y++ {
		for x := 6; x <= 8; x++ {
			rect = append(rect, Pos{x, y})
		}
	}
	stone := is.Inventory.fine("stone")
	res, err = ApplyWithResult(w, c, DemolishRoads{IslandID: "main", Tiles: rect}, nil)
	if err != nil || res.Unchanged {
		t.Fatalf("%+v, %v", res, err)
	}
	for i, r := range res.Tiles {
		want := r.Y == 4 || r.Y == 7
		if (r.Err == nil) != want || (!want && !errors.Is(r.Err, ErrNoRoad)) {
			t.Errorf("tile %d (%d,%d): %v", i, r.X, r.Y, r.Err)
		}
	}
	for _, p := range rect {
		if is.RoadAt(p.X, p.Y) != "" || is.PlannedRoadAt(p.X, p.Y) != "" {
			t.Errorf("(%d,%d) still has a road", p.X, p.Y)
		}
	}
	if is.RoadAt(5, 4) == "" || is.RoadAt(9, 4) == "" {
		t.Error("a road outside the rectangle went")
	}
	if got, want := is.Inventory.fine("stone")-stone, 3*content.MilliPerUnit*SubPerMilli; got != want {
		t.Errorf("refund = %d, want %d (1 stone per real tile)", got, want)
	}
}

// TestDemolishRoadsMatchesDemolishRoad: the batch over road tiles only is
// the single demolish_road of the same tiles.
func TestDemolishRoadsMatchesDemolishRoad(t *testing.T) {
	c := catalogue(t)
	a := testWorld(t, c)
	b := a.Clone()
	tiles := []Pos{{10, 4}, {11, 4}, {12, 4}}
	mustApply(t, a, c, DemolishRoad{IslandID: "main", Tiles: tiles})
	mustApply(t, b, c, DemolishRoads{IslandID: "main", Tiles: tiles})
	if !bytes.Equal(encodeWorld(t, a), encodeWorld(t, b)) {
		t.Error("demolish_roads and demolish_road differ")
	}
}
