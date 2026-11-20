package sim

import (
	"testing"
)

// D-081: the Trading Post is the single root of the road network. A
// warehouse on a road that does not reach the Trading Post is inactive: it
// shows not_connected and nobody is assigned to it; a road joining the two
// networks activates it, and cutting that road again deactivates it.
func TestWarehouseNeedsRoadToTradingPost(t *testing.T) {
	c := catalogue(t)
	w := testWorld(t, c) // Trading Post at (1,0), road y = 4 from x 2 to 17
	var south []Pos
	for x := 5; x <= 17; x++ {
		south = append(south, Pos{x, 8})
	}
	mustApply(t, w, c, PlaceRoad{IslandID: "main", Type: "road_dirt", Tiles: south})
	mustApply(t, w, c, PlaceBuilding{IslandID: "main", Type: "warehouse", X: 14, Y: 6}) // 2
	mustApply(t, w, c, PlaceBuilding{IslandID: "main", Type: "lumberjack", X: 6, Y: 6}) // 3
	mustApply(t, w, c, PlaceFields{IslandID: "main", FarmID: 3, Type: "tree_plot", Tiles: []Pos{{6, 5}}})
	is := w.Islands()[0]
	wh, lj := is.Building(2), is.Building(3)

	check := func(step string, active bool) {
		t.Helper()
		wantWh, wantLj, wantStatus := int64(0), int64(0), StatusNotConnected
		if active {
			wantWh, wantLj, wantStatus = 1, 2, StatusOK
		}
		if wh.AssignedWarehouseID != wantWh || lj.AssignedWarehouseID != wantLj {
			t.Fatalf("%s: warehouse root %d (want %d), lumberjack assigned to %d (want %d)", step, wh.AssignedWarehouseID, wantWh, lj.AssignedWarehouseID, wantLj)
		}
		if bd := displayed(t, w, c, 2); bd.Status != wantStatus {
			t.Fatalf("%s: warehouse status %s, want %s", step, bd.Status, wantStatus)
		}
		if bd := displayed(t, w, c, 3); (bd.Status == StatusNotConnected) == active {
			t.Fatalf("%s: lumberjack status %s", step, bd.Status)
		}
	}
	check("separate network", false)

	link := []Pos{{17, 5}, {17, 6}, {17, 7}}
	mustApply(t, w, c, PlaceRoad{IslandID: "main", Type: "road_dirt", Tiles: link})
	check("linked", true)

	mustApply(t, w, c, DemolishRoad{IslandID: "main", Tiles: []Pos{{17, 6}}})
	check("cut", false)

	mustApply(t, w, c, PlaceRoad{IslandID: "main", Type: "road_dirt", Tiles: []Pos{{17, 6}}})
	check("restored", true)
}

// Without any road at the Trading Post nothing is connected, even a
// producer next to a warehouse on the same road (D-081: one root).
func TestNoRoadAtTradingPostConnectsNothing(t *testing.T) {
	c := catalogue(t)
	w := testWorld(t, c)
	mustApply(t, w, c, PlaceBuilding{IslandID: "main", Type: "warehouse", X: 14, Y: 5}) // 2, below the road
	mustApply(t, w, c, PlaceBuilding{IslandID: "main", Type: "fisher", X: 16, Y: 2})    // 3
	is := w.Islands()[0]
	if is.Building(2).AssignedWarehouseID != 1 || is.Building(3).AssignedWarehouseID == 0 {
		t.Fatal("warehouse or fisher not connected on the Trading Post's road")
	}
	// Remove the road tiles next to the Trading Post (x 2..5 at y 4).
	mustApply(t, w, c, DemolishRoad{IslandID: "main", Tiles: []Pos{{2, 4}, {3, 4}, {4, 4}, {5, 4}}})
	if a, b := is.Building(2).AssignedWarehouseID, is.Building(3).AssignedWarehouseID; a != 0 || b != 0 {
		t.Fatalf("warehouse root %d, fisher assigned to %d; want both 0", a, b)
	}
}
