package sim

import (
	"errors"
	"strings"
	"testing"
)

// quayColumn is the column x of quay tiles from y0 down to y1.
func quayColumn(x, y0, y1 int) []Pos {
	var out []Pos
	for y := y0; y <= y1; y++ {
		out = append(out, Pos{x, y})
	}
	return out
}

// TestQuaysConnected (D-077 §8): a quay tile reaches the island's own land
// over edge-adjacent quay tiles, built or planned, or a built building;
// a batch may connect itself; a diagonal touch is not enough; a failed
// placement changes nothing.
func TestQuaysConnected(t *testing.T) {
	c := shippedCatalogue(t)
	expect := func(t *testing.T, w *World, cmd Command, want error) {
		t.Helper()
		before := encode(t, w)
		if err := Apply(w, c, cmd); !errors.Is(err, want) {
			t.Fatalf("Apply(%#v) = %v, want %v", cmd, err, want)
		}
		if want != nil && string(before) != string(encode(t, w)) {
			t.Fatalf("failed %#v changed the world", cmd)
		}
	}
	// shoreWorld: sea above row 18, coast row 18, Trading Post at (4,16).
	w := shoreWorld(t)
	// A pier 8 tiles out in one batch: the shallows end there.
	expect(t, w, PlaceRoad{IslandID: "main", Type: "quay", Tiles: quayColumn(30, 10, 17)}, nil)
	expect(t, w, PlaceRoad{IslandID: "main", Type: "quay", Tiles: []Pos{{30, 9}}}, ErrTerrain)
	// A floating tile, a diagonal one, a floating batch.
	expect(t, w, PlaceRoad{IslandID: "main", Type: "quay", Tiles: []Pos{{25, 12}}}, ErrQuayDisconnected)
	expect(t, w, PlaceRoad{IslandID: "main", Type: "quay", Tiles: []Pos{{31, 9}}}, ErrTerrain)
	expect(t, w, PlaceRoad{IslandID: "main", Type: "quay", Tiles: []Pos{{31, 11}, {32, 12}}}, ErrQuayDisconnected)
	expect(t, w, PlaceRoad{IslandID: "main", Type: "quay", Tiles: quayRow(12, 20, 23)}, ErrQuayDisconnected)
	// Off the pier: a head along row 10.
	expect(t, w, PlaceRoad{IslandID: "main", Type: "quay", Tiles: quayRow(10, 31, 36)}, nil)
	// Planned quays anchor and are anchored like built ones.
	expect(t, w, PlaceRoad{IslandID: "main", Type: "quay", Tiles: quayColumn(20, 12, 17), Planned: true}, nil)
	// A built quay needs built ground: the planned column does not carry it.
	expect(t, w, PlaceRoad{IslandID: "main", Type: "quay", Tiles: []Pos{{21, 12}}}, ErrQuayDisconnected)
	expect(t, w, PlaceRoad{IslandID: "main", Type: "quay", Tiles: []Pos{{21, 12}}, Planned: true}, nil)
	expect(t, w, PlaceRoad{IslandID: "main", Type: "quay", Tiles: []Pos{{22, 14}}, Planned: true}, ErrQuayDisconnected)
}

// TestQuaysNeverFloat (D-077 §8): demolishing quay tiles (single and
// rectangle, plans included) or a building a quay is anchored to, or
// moving that building, is rejected when a quay that reached the land
// would not any more; cutting off a loose end entirely is fine.
func TestQuaysNeverFloat(t *testing.T) {
	c := shippedCatalogue(t)
	expect := func(t *testing.T, w *World, cmd Command, want error) {
		t.Helper()
		before := encode(t, w)
		if err := Apply(w, c, cmd); !errors.Is(err, want) {
			t.Fatalf("Apply(%#v) = %v, want %v", cmd, err, want)
		}
		if want != nil && string(before) != string(encode(t, w)) {
			t.Fatalf("failed %#v changed the world", cmd)
		}
	}
	t.Run("roads", func(t *testing.T) {
		w := shoreWorld(t)
		mustApply(t, w, c, PlaceRoad{IslandID: "main", Type: "quay", Tiles: quayColumn(30, 10, 17)})
		mustApply(t, w, c, PlaceRoad{IslandID: "main", Type: "quay", Tiles: quayRow(10, 31, 34), Planned: true})
		expect(t, w, DemolishRoad{IslandID: "main", Tiles: []Pos{{30, 14}}}, ErrQuayWouldFloat)
		expect(t, w, DemolishRoads{IslandID: "main", Tiles: quayRow(14, 28, 32)}, ErrQuayWouldFloat)
		// The planned head hangs on the pier's tip.
		expect(t, w, DemolishRoad{IslandID: "main", Tiles: []Pos{{30, 10}}}, ErrQuayWouldFloat)
		expect(t, w, DemolishRoad{IslandID: "main", Tiles: []Pos{{31, 10}}}, ErrQuayWouldFloat)
		expect(t, w, DemolishRoad{IslandID: "main", Tiles: quayRow(10, 33, 34)}, nil)
		// The tip with what hangs on it, then the rest.
		expect(t, w, DemolishRoad{IslandID: "main", Tiles: append(quayColumn(30, 10, 13), Pos{31, 10}, Pos{32, 10})}, nil)
		expect(t, w, DemolishRoads{IslandID: "main", Tiles: quayColumn(30, 10, 17)}, nil)
		if is := w.Island("main"); len(is.Roads) != 0 || len(is.PlannedRoads) != 0 {
			t.Fatalf("roads left: %v %v", is.Roads, is.PlannedRoads)
		}
	})
	t.Run("building", func(t *testing.T) {
		// A depot fully on the water against a quay row, a quay tile beside
		// it anchored only by the depot.
		w := shoreWorld(t)
		mustApply(t, w, c, PlaceRoad{IslandID: "main", Type: "quay", Tiles: append(quayRow(17, 31, 34), quayColumn(30, 16, 17)...)})
		mustApply(t, w, c, PlaceBuilding{IslandID: "main", Type: "depot", X: 31, Y: 6})
		id := w.NextBuildingID - 1
		expect(t, w, PlaceRoad{IslandID: "main", Type: "quay", Tiles: []Pos{{35, 12}}}, nil)
		expect(t, w, Demolish{IslandID: "main", BuildingID: id}, ErrQuayWouldFloat)
		expect(t, w, MoveBuilding{IslandID: "main", BuildingID: id, X: 22, Y: 8}, ErrQuayWouldFloat)
		expect(t, w, DemolishRoad{IslandID: "main", Tiles: []Pos{{35, 12}}}, nil)
		expect(t, w, MoveBuilding{IslandID: "main", BuildingID: id, X: 22, Y: 8}, nil)
		expect(t, w, Demolish{IslandID: "main", BuildingID: id}, nil)
	})
}

// TestShoreBuildingKeepsHarbourOpen (D-077 §8): a shore building that
// would close the last gap of a bay holding the Trading Post's harbour
// point is rejected (harbour_blocked), placed and planned, while the
// same site is fine with the bay open.
func TestShoreBuildingKeepsHarbourOpen(t *testing.T) {
	c := shippedCatalogue(t)
	// 30 wide: open sea rows 0..3, a bay x 5..20 in rows 4..9 between
	// land columns, the coast row 10, grass below.
	rows := make([]string, 0, 24)
	for y := range 24 {
		switch {
		case y < 4:
			rows = append(rows, strings.Repeat("~", 30))
		case y < 10:
			rows = append(rows, "ccccc"+strings.Repeat("~", 16)+strings.Repeat("c", 9))
		case y == 10:
			rows = append(rows, strings.Repeat("c", 30))
		default:
			rows = append(rows, strings.Repeat(".", 30))
		}
	}
	setup := func(t *testing.T) *World {
		w := NewWorld(t0)
		w.SetIslands(islandFromRows("main", rows...))
		if err := PlaceFree(w, c, PlaceBuilding{IslandID: "main", Type: "trading_post", X: 6, Y: 8}, nil); err != nil {
			t.Fatal(err)
		}
		w.Gold = 100_000_000
		w.UnlockedTiers = append(w.UnlockedTiers, "citizens", "merchants")
		for _, g := range []string{"stone", "planks"} {
			if err := AddStock(w, c, "main", g, 290_000, nil); err != nil {
				t.Fatal(err)
			}
		}
		return w
	}
	depot := PlaceBuilding{IslandID: "main", Type: "depot", X: 18, Y: 0}
	w := setup(t)
	mustApply(t, w, c, depot)
	w = setup(t)
	// The quay closes the bay's mouth in row 3, just beyond the Trading
	// Post's harbour lane (rows 4..7, D-078 §1), up to the gap x 18..20.
	mustApply(t, w, c, PlaceRoad{IslandID: "main", Type: "quay", Tiles: quayRow(3, 4, 17)})
	before := encode(t, w)
	for _, planned := range []bool{false, true} {
		cmd := depot
		cmd.Planned = planned
		if err := Apply(w, c, cmd); !errors.Is(err, ErrHarbourBlocked) {
			t.Fatalf("planned %v: %v, want %v", planned, err, ErrHarbourBlocked)
		}
	}
	if string(before) != string(encode(t, w)) {
		t.Fatal("a failed placement changed the world")
	}
}
