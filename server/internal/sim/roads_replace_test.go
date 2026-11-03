package sim

import (
	"errors"
	"testing"

	"github.com/ricoberger/new-shores/server/internal/content"
)

// TestPavedRoadReplacesDirt pins the replacement rule of MECHANICS §3: a
// road over a road of a lower type replaces it in one command — the new
// road's cost for every tile, the old road's demolition refund (50 % of
// its materials), the tile a road throughout — while the same type and a
// lower type over a higher one stay occupied and change nothing.
func TestPavedRoadReplacesDirt(t *testing.T) {
	c := shippedCatalogue(t)
	// A dirt road with materials, so the refund shows: 3 stone per tile.
	c.BuildingByID["road_dirt"].Cost = content.Cost{Gold: 1_000, Materials: []content.GoodAmount{{Good: "stone", Amount: 3_000}}}
	w := quayWorld(t, c, 2, quayCoast()...)
	is := w.Island("main")
	row := quayRow(15, 10, 15)
	mustApply(t, w, c, PlaceRoad{IslandID: "main", Type: "road_dirt", Tiles: row})

	gold, stone := w.Gold, is.Inventory.Stock["stone"]
	paved := c.BuildingByID["road_paved"].Cost
	// The paved road over two dirt tiles and one new tile.
	tiles := []Pos{{10, 15}, {11, 15}, {10, 16}}
	l := NewLedger()
	if err := ApplyWithLedger(w, c, PlaceRoad{IslandID: "main", Type: "road_paved", Tiles: tiles}, l); err != nil {
		t.Fatal(err)
	}
	for _, p := range tiles {
		if rt := is.RoadAt(p.X, p.Y); rt != "road_paved" {
			t.Errorf("road at (%d,%d) = %q, want road_paved", p.X, p.Y, rt)
		}
	}
	for _, p := range row[2:] {
		if rt := is.RoadAt(p.X, p.Y); rt != "road_dirt" {
			t.Errorf("road at (%d,%d) = %q, want road_dirt untouched", p.X, p.Y, rt)
		}
	}
	if got, want := w.Gold, gold-3*paved.Gold; got != want {
		t.Errorf("gold = %d, want %d (the paved cost for all three tiles, no gold refund)", got, want)
	}
	// Paved stone for three tiles, the dirt refund of 1 stone (50 % of 3, whole units) for two.
	if got, want := is.Inventory.Stock["stone"], stone-3*paved.Materials[0].Amount+2*1_000; got != want {
		t.Errorf("stone = %d, want %d", got, want)
	}
	if f := l.flow("main", "stone"); f.Refunded != 2*1_000*SubPerMilli {
		t.Errorf("ledger refunded = %d, want %d", f.Refunded, 2*1_000*SubPerMilli)
	}

	before := encodeWorld(t, w)
	for _, tc := range []struct {
		name  string
		typ   string
		tiles []Pos
	}{
		{"same type", "road_paved", []Pos{{10, 15}}},
		{"same type, one new tile", "road_dirt", []Pos{{14, 15}, {14, 16}}},
		{"lower over higher", "road_dirt", []Pos{{11, 15}}},
	} {
		if err := Apply(w, c, PlaceRoad{IslandID: "main", Type: tc.typ, Tiles: tc.tiles}); !errors.Is(err, ErrOccupied) {
			t.Errorf("%s: err = %v, want ErrOccupied", tc.name, err)
		}
		if after := encodeWorld(t, w); string(after) != string(before) {
			t.Errorf("%s: the failed command changed the world", tc.name)
		}
	}
}
