package sim

import (
	"errors"
	"strings"
	"testing"
)

// TestUniqueKontor (D-076 §2, D-077): the Kontor exists once per world —
// built or planned, on any island; building its plan is not blocked by
// the plan itself, and demolishing it frees the slot.
func TestUniqueKontor(t *testing.T) {
	c := shippedCatalogue(t)
	w := shoreWorld(t)
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
	w.SetIslands(append(w.Islands(), islandFromRows("other", rows...))...)
	if err := PlaceFree(w, c, PlaceBuilding{IslandID: "other", Type: "trading_post", X: 4, Y: 16}, nil); err != nil {
		t.Fatal(err)
	}
	w.UnlockedTiers = append(w.UnlockedTiers, "patricians")
	for _, is := range []string{"main", "other"} {
		for _, g := range []string{"bricks", "glass"} {
			if err := AddStock(w, c, is, g, 100_000, nil); err != nil {
				t.Fatal(err)
			}
		}
	}
	if err := AddStock(w, c, "other", "planks", 100_000, nil); err != nil {
		t.Fatal(err)
	}
	kontor := func(island string, x int, planned bool) PlaceBuilding {
		// 4×11 at rotation 0: rows 8..17 water, the back row 18 on the coast.
		return PlaceBuilding{IslandID: island, Type: "kontor", X: x, Y: 8, Planned: planned}
	}
	mustApply(t, w, c, kontor("main", 20, false))
	for _, cmd := range []PlaceBuilding{kontor("main", 30, false), kontor("other", 20, false), kontor("other", 20, true)} {
		if err := Apply(w, c, cmd); !errors.Is(err, ErrUniqueBuilding) {
			t.Fatalf("%+v = %v, want ErrUniqueBuilding", cmd, err)
		}
	}
	var id int64
	for _, b := range w.Island("main").Buildings {
		if b.Type == "kontor" {
			id = b.ID
		}
	}
	mustApply(t, w, c, Demolish{IslandID: "main", BuildingID: id})
	// A plan reserves the Kontor too; building the plan is fine.
	mustApply(t, w, c, kontor("other", 20, true))
	if err := Apply(w, c, kontor("main", 20, false)); !errors.Is(err, ErrUniqueBuilding) {
		t.Fatalf("a second Kontor beside a plan = %v, want ErrUniqueBuilding", err)
	}
	plan := w.Island("other").Plans[0]
	mustApply(t, w, c, BuildPlan{IslandID: "other", PlanID: plan.ID})
	if n := len(w.Island("other").Plans); n != 0 || w.Island("other").Buildings[len(w.Island("other").Buildings)-1].Type != "kontor" {
		t.Fatalf("plans %d, buildings %+v", n, w.Island("other").Buildings)
	}
}

// TestOrnamentsAndMilitary (D-077 §2–§3): ornaments and military buildings
// stand without a road and cost their price; no collector serves them.
func TestOrnamentsAndMilitary(t *testing.T) {
	c := shippedCatalogue(t)
	w := shoreWorld(t)
	gold := w.Gold
	mustApply(t, w, c, PlaceBuilding{IslandID: "main", Type: "well", X: 20, Y: 30})
	mustApply(t, w, c, PlaceBuilding{IslandID: "main", Type: "tower", X: 24, Y: 30})
	if want := gold - c.BuildingByID["well"].Cost.Gold - c.BuildingByID["tower"].Cost.Gold; w.Gold != want {
		t.Fatalf("gold %d, want %d", w.Gold, want)
	}
	for _, b := range w.Island("main").Buildings {
		if b.Type == "well" || b.Type == "tower" {
			if b.AssignedWarehouseID != 0 {
				t.Errorf("%s assigned to %d", b.Type, b.AssignedWarehouseID)
			}
		}
	}
}

// TestWarshipCarriesNothing (D-077 §6): a ship without cargo slots has no
// room for any good and needs more slots than it has for any amount.
func TestWarshipCarriesNothing(t *testing.T) {
	if r := cargoRoom(nil, "planks", 0, 0); r != 0 {
		t.Errorf("cargo room %d", r)
	}
	if n := slotsUsed(map[string]Qty{"planks": 1}, 0); n <= 0 {
		t.Errorf("slots used %d", n)
	}
	if n := slotsUsed(map[string]Qty{}, 0); n != 0 {
		t.Errorf("slots used by nothing %d", n)
	}
	var s Ship
	setCargo(&s, 0, nil)
	if s.Cargo != nil {
		t.Errorf("cargo %+v", s.Cargo)
	}
}
