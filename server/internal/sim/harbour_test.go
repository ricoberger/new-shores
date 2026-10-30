package sim

import (
	"errors"
	"strings"
	"testing"
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
	mustApply(t, w, c, PlaceBuilding{IslandID: "main", Type: "trading_pier", X: 12, Y: 6})
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

// A depot adds capacity per good; its second level needs the Merchants
// and adds more; demolishing it drops the capacity again (surplus loss
// rule, MECHANICS §5) and refunds both levels.
func TestDepotCapacity(t *testing.T) {
	c := shippedCatalogue(t)
	w := quayWorld(t, c, 2, quayCoast()...)
	is := w.Island("main")
	if got := capacityMilli(is, c); got != 300_000 {
		t.Fatalf("capacity = %d, want 300000", got)
	}
	mustApply(t, w, c, PlaceBuilding{IslandID: "main", Type: "depot", X: 16, Y: 8})
	depot := is.Buildings[len(is.Buildings)-1]
	if depot.Level != 1 || depot.Berths != 0 {
		t.Errorf("depot level/berths = %d/%d, want 1/0", depot.Level, depot.Berths)
	}
	if got := capacityMilli(is, c); got != 450_000 {
		t.Fatalf("capacity with a depot = %d, want 450000", got)
	}
	if err := Apply(w, c, UpgradeBuilding{IslandID: "main", BuildingID: depot.ID}); !errors.Is(err, ErrTierLocked) {
		t.Fatalf("level 2 without the Merchants: err = %v, want ErrTierLocked", err)
	}
	w.UnlockedTiers = append(w.UnlockedTiers, "merchants")
	if err := AddStock(w, c, "main", "bricks", 50_000, nil); err != nil {
		t.Fatal(err)
	}
	mustApply(t, w, c, UpgradeBuilding{IslandID: "main", BuildingID: depot.ID})
	if got := capacityMilli(is, c); got != 600_000 || depot.Level != 2 {
		t.Fatalf("capacity/level after the upgrade = %d/%d, want 600000/2", got, depot.Level)
	}
	if err := Apply(w, c, UpgradeBuilding{IslandID: "main", BuildingID: depot.ID}); !errors.Is(err, ErrUpgradeUnavailable) {
		t.Errorf("upgrading past the last level: err = %v, want ErrUpgradeUnavailable", err)
	}
	ds, err := Display(w, c, w.LastEvaluatedAt)
	if err != nil {
		t.Fatal(err)
	}
	for _, bd := range ds.Islands[0].Buildings {
		if bd.ID == depot.ID && (bd.Level == nil || *bd.Level != 2 || bd.Capacity == nil || *bd.Capacity != 300_000) {
			t.Errorf("depot display level/capacity = %v/%v, want 2/300000", bd.Level, bd.Capacity)
		}
	}
	if got := ds.Islands[0].Inventory["fish"].Capacity; got != 600_000 {
		t.Errorf("display capacity = %d, want 600000", got)
	}

	if err := AddStock(w, c, "main", "fish", 500_000, nil); err != nil {
		t.Fatal(err)
	}
	if err := Apply(w, c, Demolish{IslandID: "main", BuildingID: depot.ID}); !errors.Is(err, ErrSurplusLoss) {
		t.Fatalf("demolishing the depot above the remaining capacity: err = %v, want ErrSurplusLoss", err)
	}
	bricks := is.Inventory.fine("bricks")
	mustApply(t, w, c, Demolish{IslandID: "main", BuildingID: depot.ID, AcceptSurplusLoss: true})
	if got := capacityMilli(is, c); got != 300_000 {
		t.Errorf("capacity after the demolition = %d, want 300000", got)
	}
	if got := is.Inventory.fine("fish") / SubPerMilli; got != 300_000 {
		t.Errorf("fish after the demolition = %d, want 300000 (clamped)", got)
	}
	// Level 2 cost 10 bricks, refunded at half (D-019).
	if got := (is.Inventory.fine("bricks") - bricks) / SubPerMilli; got != 5_000 {
		t.Errorf("bricks refunded = %d, want 5000", got)
	}
}

// A quay must not cut a trading pier off the open sea (D-060): the
// harbour check covers every berth holder, and a pier's own harbour point
// must be reachable.
func TestQuayMustNotCutOffPier(t *testing.T) {
	c := shippedCatalogue(t)
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
