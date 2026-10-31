package sim

import (
	"errors"
	"strings"
	"testing"

	"github.com/ricoberger/new-shores/server/internal/content"
)

// The trading pier adds its berths to the island's (D-060, MECHANICS
// §9.3); demolishing it takes them away again.
func TestTradingPierAddsBerths(t *testing.T) {
	c := shippedCatalogue(t)
	w := quayWorld(t, c, 2, quayCoast()...)
	is := w.Island("main")
	if got := berthTotal(is); got != 1 {
		t.Fatalf("berths with the Trading Post = %d, want 1", got)
	}
	mustApply(t, w, c, PlaceBuilding{IslandID: "main", Type: "trading_pier", X: 12, Y: 3})
	if got := berthTotal(is); got != 3 {
		t.Fatalf("berths with a pier = %d, want 3", got)
	}
	pier := is.Buildings[len(is.Buildings)-1]
	if pier.Berths != 2 || pier.Level != 0 {
		t.Errorf("pier berths/level = %d/%d, want 2/0", pier.Berths, pier.Level)
	}
	if err := Apply(w, c, UpgradeBuilding{IslandID: "main", BuildingID: pier.ID}); !errors.Is(err, ErrUpgradeUnavailable) {
		t.Errorf("upgrading a pier: err = %v, want ErrUpgradeUnavailable", err)
	}
	mustApply(t, w, c, Demolish{IslandID: "main", BuildingID: pier.ID})
	if got := berthTotal(is); got != 1 {
		t.Fatalf("berths after demolishing the pier = %d, want 1", got)
	}
}

// Any number of depots adds fixed capacity, with no upgrade. Demolition
// still guards/clamps surplus and refunds construction materials.
func TestDepotCapacity(t *testing.T) {
	c := shippedCatalogue(t)
	rows := []string{}
	for y := 0; y < 18; y++ {
		ch := "."
		if y < 9 {
			ch = "~"
		}
		if y == 9 {
			ch = "c"
		}
		rows = append(rows, strings.Repeat(ch, 48))
	}
	w := quayWorld(t, c, 2, rows...)
	is := w.Island("main")
	for _, x := range []int{12, 25} {
		mustApply(t, w, c, PlaceBuilding{IslandID: "main", Type: "depot", X: x, Y: 0})
	}
	depot := is.Buildings[len(is.Buildings)-1]
	if depot.Level != 0 || depot.Berths != 0 || capacityMilli(is, c) != 600_000 {
		t.Fatal("depots must add 150 each without levels or berths")
	}
	if err := Apply(w, c, UpgradeBuilding{IslandID: "main", BuildingID: depot.ID}); !errors.Is(err, ErrUpgradeUnavailable) {
		t.Fatalf("depot upgrade: %v", err)
	}
	ds, err := Display(w, c, w.LastEvaluatedAt)
	if err != nil {
		t.Fatal(err)
	}
	for _, b := range ds.Islands[0].Buildings {
		if b.ID == depot.ID && (b.Level != nil || b.Capacity == nil || *b.Capacity != 150_000) {
			t.Fatalf("depot display: %+v", b)
		}
	}
	if err := AddStock(w, c, "main", "fish", 500_000, nil); err != nil {
		t.Fatal(err)
	}
	if err := Apply(w, c, Demolish{IslandID: "main", BuildingID: depot.ID}); !errors.Is(err, ErrSurplusLoss) {
		t.Fatalf("surplus guard: %v", err)
	}
	planks := is.Inventory.fine("planks")
	mustApply(t, w, c, Demolish{IslandID: "main", BuildingID: depot.ID, AcceptSurplusLoss: true})
	if capacityMilli(is, c) != 450_000 || is.Inventory.fine("fish")/SubPerMilli != 450_000 {
		t.Fatal("depot demolition must clamp to remaining capacity")
	}
	if (is.Inventory.fine("planks")-planks)/SubPerMilli != 10_000 {
		t.Fatal("depot must refund half its construction planks only")
	}
}

// A quay must not cut a trading pier off the open sea (D-060): the
// harbour check covers every berth holder, and a pier's own harbour point
// must be reachable.
func TestQuayMustNotCutOffPier(t *testing.T) {
	c := shippedCatalogue(t)
	// Pin the narrow synthetic bay; berth and harbour rules are unchanged.
	c.BuildingByID["trading_pier"].Width = 3
	c.BuildingByID["trading_pier"].Height = 4
	c.BuildingByID["trading_pier"].WaterRows = &content.WaterRows{Min: 3, Max: 3}
	// Two bays: the Trading Post's (x 3..8) and the pier's (x 12..15),
	// land columns between them, rows 2..8; coast row 9, grass below.
	rows := []string{strings.Repeat("~", 20), strings.Repeat("~", 20)}
	for range 7 {
		rows = append(rows, "ccc~~~~~~ccc~~~~cccc")
	}
	rows = append(rows, strings.Repeat("c", 20))
	for range 6 {
		rows = append(rows, strings.Repeat(".", 20))
	}
	w := quayWorld(t, c, 3, rows...)
	mustApply(t, w, c, PlaceBuilding{IslandID: "main", Type: "trading_pier", X: 12, Y: 6})
	mustApply(t, w, c, PlaceRoad{IslandID: "main", Type: "quay", Tiles: quayRow(2, 12, 14)})
	before := encode(t, w)
	if err := Apply(w, c, PlaceRoad{IslandID: "main", Type: "quay", Tiles: []Pos{{15, 2}}}); !errors.Is(err, ErrHarbourBlocked) {
		t.Fatalf("closing the pier's bay: err = %v, want ErrHarbourBlocked", err)
	}
	if string(encode(t, w)) != string(before) {
		t.Error("world changed on error")
	}

	// A pier placed in a bay already closed by quays has no way out.
	w = quayWorld(t, c, 3, rows...)
	mustApply(t, w, c, PlaceRoad{IslandID: "main", Type: "quay", Tiles: quayRow(2, 12, 15)})
	if err := Apply(w, c, PlaceBuilding{IslandID: "main", Type: "trading_pier", X: 12, Y: 6}); !errors.Is(err, ErrHarbourBlocked) {
		t.Fatalf("pier in a closed bay: err = %v, want ErrHarbourBlocked", err)
	}
}
