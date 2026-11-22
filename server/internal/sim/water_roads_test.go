package sim

import (
	"errors"
	"testing"

	"github.com/ricoberger/new-shores/server/internal/content"
)

// pontoonCatalogue is the shipped catalogue with a second water road,
// "pontoon" (a stand-in for the D-085 jetty: 1×1, shallows, 3 gold / 1
// plank), that only the fisher stands on and the quay replaces: the
// stands_on / replaces rules are content, not building IDs.
func pontoonCatalogue(t *testing.T) *content.Catalogue {
	t.Helper()
	c := shippedCatalogue(t)
	q := *c.BuildingByID["quay"]
	q.ID, q.Name, q.Tier = "pontoon", "Pontoon", "settlers"
	q.Cost = content.Cost{Gold: 3_000, Materials: []content.GoodAmount{{Good: "planks", Amount: 1_000}}}
	q.Replaces = nil
	c.Buildings = append(c.Buildings, &q)
	c.BuildingByID[q.ID] = &q
	c.BuildingByID["fisher"].StandsOn = []string{"pontoon", "quay"}
	c.BuildingByID["quay"].Replaces = []string{"pontoon"}
	return c
}

// TestStandsOnAndReplaces (D-085 §2–§3) on the quay coast (water rows
// 0..8, coast row 9, the Trading Post 6×9 at x 2..7 with its water rows
// 6..8): a water-edge building stands on the water roads of its stands_on
// (replaced, no refund), any other water road under its land part is
// terrain; a shore building whose back edge rests on such a road is
// terrain; the quay replaces the pontoon in place with half its materials
// back (floored to milli-units, no gold); the pontoon over a quay, a quay
// over a quay and a planned quay over a pontoon are occupied; failures
// change nothing.
func TestStandsOnAndReplaces(t *testing.T) {
	c := pontoonCatalogue(t)
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
	// A water road platform, rows 6..8 (the three water rows before
	// the coast), x x0..x1.
	platform := func(t *testing.T, w *World, typ string, x0, x1 int) {
		t.Helper()
		var tiles []Pos
		for y := 6; y <= 8; y++ {
			tiles = append(tiles, quayRow(y, x0, x1)...)
		}
		mustApply(t, w, c, PlaceRoad{IslandID: "main", Type: typ, Tiles: tiles})
	}

	t.Run("fisher stands on the pontoon", func(t *testing.T) {
		w := quayWorld(t, c, 2, quayCoast()...)
		platform(t, w, "pontoon", 10, 12)
		// Fisher 3×8 at y 3..10: water rows 3..5 (three), land rows on the
		// pontoon (6..8) and the coast (9..10).
		expect(t, w, PlaceBuilding{IslandID: "main", Type: "fisher", X: 10, Y: 3}, nil)
		is := w.Island("main")
		for y := 6; y <= 8; y++ {
			for x := 10; x <= 12; x++ {
				if rt := is.RoadAt(x, y); rt != "" {
					t.Errorf("pontoon at (%d,%d) under the fisher: %q", x, y, rt)
				}
			}
		}
	})
	t.Run("quay-only buildings", func(t *testing.T) {
		w := quayWorld(t, c, 2, quayCoast()...)
		platform(t, w, "pontoon", 10, 14)
		// The salt pans (5×9, default stands_on: the quay) over the
		// pontoon: its land rows hit the pontoon — terrain.
		w.UnlockedTiers = append(w.UnlockedTiers, "merchants")
		expect(t, w, PlaceBuilding{IslandID: "main", Type: "salt_pans", X: 10, Y: 2}, ErrTerrain)
		// A planned one too.
		expect(t, w, PlaceBuilding{IslandID: "main", Type: "salt_pans", X: 10, Y: 2, Planned: true}, ErrTerrain)
		// The same over a quay platform stands (the D-060 rule).
		w2 := quayWorld(t, c, 2, quayCoast()...)
		platform(t, w2, "quay", 10, 14)
		expect(t, w2, PlaceBuilding{IslandID: "main", Type: "salt_pans", X: 10, Y: 2}, nil)
	})
	t.Run("shore back edge", func(t *testing.T) {
		// shoreWorld: water rows 0..17, the coast row 18. A pontoon row at
		// y 17, x 20..25.
		w := shoreWorld(t)
		row := quayRow(17, 20, 25)
		mustApply(t, w, c, PlaceRoad{IslandID: "main", Type: "pontoon", Tiles: row})
		// A trading pier (6×9) fully on the water, its back row at y 16:
		// behind it the pontoon — terrain, not open water.
		expect(t, w, PlaceBuilding{IslandID: "main", Type: "trading_pier", X: 20, Y: 8}, ErrTerrain)
		// A depot (4×11) over the pontoon row: terrain.
		expect(t, w, PlaceBuilding{IslandID: "main", Type: "depot", X: 20, Y: 9}, ErrTerrain)
		// Against a quay row the pier stands (D-077 §8).
		w2 := shoreWorld(t)
		mustApply(t, w2, c, PlaceRoad{IslandID: "main", Type: "quay", Tiles: row})
		expect(t, w2, PlaceBuilding{IslandID: "main", Type: "trading_pier", X: 20, Y: 8}, nil)
	})
	t.Run("quay replaces the pontoon", func(t *testing.T) {
		w := quayWorld(t, c, 2, quayCoast()...)
		platform(t, w, "pontoon", 10, 12)
		is := w.Island("main")
		gold, planks, stone := w.Gold, is.Inventory.Stock["planks"], is.Inventory.Stock["stone"]
		tiles := []Pos{{10, 8}, {11, 8}, {13, 8}} // two pontoon tiles, one free
		l := NewLedger()
		if err := ApplyWithLedger(w, c, PlaceRoad{IslandID: "main", Type: "quay", Tiles: tiles}, l); err != nil {
			t.Fatal(err)
		}
		for _, p := range tiles {
			if rt := is.RoadAt(p.X, p.Y); rt != "quay" {
				t.Errorf("road at %v = %q, want quay", p, rt)
			}
		}
		quay := c.BuildingByID["quay"].Cost
		if got, want := w.Gold, gold-3*quay.Gold; got != want {
			t.Errorf("gold = %d, want %d (no gold refund)", got, want)
		}
		if got, want := is.Inventory.Stock["planks"], planks+2*500; got != want {
			t.Errorf("planks = %d, want %d (half a plank per replaced pontoon)", got, want)
		}
		if got, want := is.Inventory.Stock["stone"], stone-3*2_000; got != want {
			t.Errorf("stone = %d, want %d", got, want)
		}
		if f := l.flow("main", "planks"); f.Refunded != 2*500*SubPerMilli {
			t.Errorf("planks refunded %d", f.Refunded)
		}
	})
	t.Run("occupied", func(t *testing.T) {
		w := quayWorld(t, c, 2, quayCoast()...)
		platform(t, w, "quay", 10, 12)
		platform(t, w, "pontoon", 13, 15)
		expect(t, w, PlaceRoad{IslandID: "main", Type: "pontoon", Tiles: []Pos{{10, 8}}}, ErrOccupied)
		expect(t, w, PlaceRoad{IslandID: "main", Type: "quay", Tiles: []Pos{{10, 8}}}, ErrOccupied)
		expect(t, w, PlaceRoad{IslandID: "main", Type: "pontoon", Tiles: []Pos{{13, 8}}}, ErrOccupied)
		expect(t, w, PlaceRoad{IslandID: "main", Type: "quay", Tiles: []Pos{{13, 8}}, Planned: true}, ErrOccupied)
	})
}
