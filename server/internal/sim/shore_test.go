package sim

import (
	"errors"
	"strings"
	"testing"
)

// shoreWorld is a 40×40 island: sea above row 18, a coast row 18, grass
// below; Merchants unlocked, gold, planks and stone, a Trading Post at
// (4,16) with its two water rows.
func shoreWorld(t *testing.T) *World {
	t.Helper()
	c := shippedCatalogue(t)
	rows := make([]string, 0, 40)
	for y := range 40 {
		ch := "."
		switch {
		case y < 18:
			ch = "~"
		case y == 18:
			ch = "c"
		}
		rows = append(rows, strings.Repeat(ch, 40))
	}
	w := NewWorld(t0)
	w.SetIslands(islandFromRows("main", rows...))
	if err := PlaceFree(w, c, PlaceBuilding{IslandID: "main", Type: "trading_post", X: 4, Y: 16}, nil); err != nil {
		t.Fatal(err)
	}
	w.Gold = 100_000_000
	w.UnlockedTiers = append(w.UnlockedTiers, "citizens", "merchants", "patricians") // military needs the Patricians (D-078 §3)
	for _, g := range []string{"stone", "planks"} {
		if err := AddStock(w, c, "main", g, 290_000, nil); err != nil {
			t.Fatal(err)
		}
	}
	return w
}

// TestShorePlacement (D-077 §5): a shore building stands on the beach
// (straddling the water line), fully on the water against a quay, in every
// rotation; it is refused without water, with open water at its back
// edge, on a terrace, over a river, and on the Trading Post's harbour
// lane; plans and moves follow the same rule; a failed command changes
// nothing.
func TestShorePlacement(t *testing.T) {
	c := shippedCatalogue(t)
	expect := func(t *testing.T, w *World, cmd Command, want error) {
		t.Helper()
		before := encode(t, w)
		err := Apply(w, c, cmd)
		if !errors.Is(err, want) {
			t.Fatalf("Apply(%#v) = %v, want %v", cmd, err, want)
		}
		if want != nil && string(before) != string(encode(t, w)) {
			t.Fatalf("failed %#v changed the world", cmd)
		}
	}

	t.Run("beach", func(t *testing.T) {
		// Trading pier 6×9 at y 12..20: rows 12..17 water, 18..20 land.
		w := shoreWorld(t)
		expect(t, w, PlaceBuilding{IslandID: "main", Type: "trading_pier", X: 20, Y: 12}, nil)
		// The depot 4×11 deep in the land (one water row).
		expect(t, w, PlaceBuilding{IslandID: "main", Type: "depot", X: 30, Y: 17}, nil)
	})
	t.Run("rotations", func(t *testing.T) {
		// A depot 4×11 at rotation 90 (front east, back west) cannot reach
		// land with its back edge on a north-facing coast: open water.
		w := shoreWorld(t)
		expect(t, w, PlaceBuilding{IslandID: "main", Type: "depot", X: 20, Y: 10, Rotation: 90}, ErrShoreBackEdge)
		// Rotation 180 (front south): its back row is at the top — water.
		expect(t, w, PlaceBuilding{IslandID: "main", Type: "depot", X: 20, Y: 10, Rotation: 180}, ErrShoreBackEdge)
		// Rotation 180 reaching down onto land: the back row (top) is water,
		// the tile behind it too.
		expect(t, w, PlaceBuilding{IslandID: "main", Type: "depot", X: 20, Y: 12, Rotation: 180}, ErrShoreBackEdge)
		// Rotation 0, back row on the coast: fine.
		expect(t, w, PlaceBuilding{IslandID: "main", Type: "depot", X: 20, Y: 8, Rotation: 0}, nil)
	})
	t.Run("full-water-against-quay", func(t *testing.T) {
		w := shoreWorld(t)
		var quay []Pos
		for x := 20; x < 26; x++ {
			quay = append(quay, Pos{x, 17})
		}
		mustApply(t, w, c, PlaceRoad{IslandID: "main", Type: "quay", Tiles: quay})
		// Pier rows 8..16 all water; behind its back row: the quay row.
		expect(t, w, PlaceBuilding{IslandID: "main", Type: "trading_pier", X: 20, Y: 8}, nil)
		is := w.Island("main")
		for x := 20; x < 26; x++ {
			if is.RoadAt(x, 17) == "" {
				t.Fatalf("quay at (%d,17) gone", x)
			}
		}
		// One column shifted off the quay: open water behind it.
		w2 := shoreWorld(t)
		mustApply(t, w2, c, PlaceRoad{IslandID: "main", Type: "quay", Tiles: quay})
		expect(t, w2, PlaceBuilding{IslandID: "main", Type: "trading_pier", X: 21, Y: 8}, ErrShoreBackEdge)
		w3 := shoreWorld(t)
		mustApply(t, w3, c, PlaceRoad{IslandID: "main", Type: "quay", Tiles: quay[:5]})
		expect(t, w3, PlaceBuilding{IslandID: "main", Type: "trading_pier", X: 20, Y: 8}, ErrShoreBackEdge)
	})
	t.Run("on-quay", func(t *testing.T) {
		// A shore building over quay tiles replaces them (D-060).
		w := shoreWorld(t)
		mustApply(t, w, c, PlaceRoad{IslandID: "main", Type: "quay", Tiles: []Pos{{30, 17}, {31, 17}}})
		expect(t, w, PlaceBuilding{IslandID: "main", Type: "depot", X: 30, Y: 9}, nil)
		if is := w.Island("main"); is.RoadAt(30, 17) != "" || is.RoadAt(31, 17) != "" {
			t.Fatal("quay under the depot not replaced")
		}
	})
	t.Run("rejected", func(t *testing.T) {
		w := shoreWorld(t)
		// All land.
		expect(t, w, PlaceBuilding{IslandID: "main", Type: "depot", X: 20, Y: 20}, ErrShoreNeedsWater)
		// Open water: back row and the tile behind it are water.
		expect(t, w, PlaceBuilding{IslandID: "main", Type: "depot", X: 20, Y: 2}, ErrShoreBackEdge)
		// A trading pier's berth tiles: its flank columns (x 19 and 26).
		expect(t, w, PlaceBuilding{IslandID: "main", Type: "trading_pier", X: 20, Y: 12}, nil)
		expect(t, w, PlaceBuilding{IslandID: "main", Type: "depot", X: 26, Y: 9}, ErrHarbourBlocked)
		expect(t, w, PlaceBuilding{IslandID: "main", Type: "depot", X: 16, Y: 9}, ErrHarbourBlocked)
		expect(t, w, PlaceBuilding{IslandID: "main", Type: "depot", X: 27, Y: 9}, nil)
		// A terrace under the land part.
		is := w.Island("main")
		is.Tiles[is.index(33, 19)].Level = 1
		expect(t, w, PlaceBuilding{IslandID: "main", Type: "depot", X: 32, Y: 9}, ErrNeedsLowShore)
		// Plans follow the rule.
		expect(t, w, PlaceBuilding{IslandID: "main", Type: "depot", X: 32, Y: 2, Planned: true}, ErrShoreBackEdge)
		expect(t, w, PlaceBuilding{IslandID: "main", Type: "depot", X: 32, Y: 9, Planned: true}, ErrNeedsLowShore)
	})
	t.Run("move", func(t *testing.T) {
		for _, planned := range []bool{false, true} {
			w := shoreWorld(t)
			mustApply(t, w, c, PlaceBuilding{IslandID: "main", Type: "depot", X: 20, Y: 9, Planned: planned})
			id := w.NextBuildingID - 1
			expect(t, w, MoveBuilding{IslandID: "main", BuildingID: id, X: 20, Y: 2}, ErrShoreBackEdge)
			expect(t, w, MoveBuilding{IslandID: "main", BuildingID: id, X: 20, Y: 20}, ErrShoreNeedsWater)
			expect(t, w, MoveBuilding{IslandID: "main", BuildingID: id, X: 24, Y: 8}, nil)
		}
	})
}

// TestShoreDecksAreLandForShips (D-077 §5): a shore building's footprint
// is land on the sea grid, for the harbour checks and in the grid's cache
// key; a plan is not.
func TestShoreDecksAreLandForShips(t *testing.T) {
	c := shippedCatalogue(t)
	w := shoreWorld(t)
	w.Seed = 7
	is := w.Island("main")
	key := SeaGridKey(w, c, 1)
	mustApply(t, w, c, PlaceBuilding{IslandID: "main", Type: "depot", X: 20, Y: 9, Planned: true})
	if shoreDecks(c, is) != nil || SeaGridKey(w, c, 1) != key {
		t.Fatal("a planned depot is land for ships")
	}
	mustApply(t, w, c, PlaceBuilding{IslandID: "main", Type: "depot", X: 30, Y: 9})
	decks := shoreDecks(c, is)
	if decks == nil || !seaLand(is, decks, 30, 9) || !seaLand(is, decks, 33, 17) || seaLand(is, decks, 34, 9) {
		t.Fatal("the depot's footprint is not land for ships")
	}
	if SeaGridKey(w, c, 1) == key {
		t.Fatal("the sea grid key ignores the depot")
	}
	g := newSeaGrid(c, w.Islands())
	if !g.landAt(is.X+31, is.Y+10) || g.landAt(is.X+35, is.Y+10) {
		t.Fatal("the sea grid misses the depot")
	}
}
