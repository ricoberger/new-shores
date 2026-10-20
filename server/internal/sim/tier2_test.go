package sim

import (
	"bytes"
	"errors"
	"slices"
	"testing"
	"time"

	"github.com/ricoberger/new-shores/server/internal/content"
)

// depositWorld is a 20x10 island of the shipped content with a seeded
// warehouse at (1,1), a stone deposit block 'S' (x 13..14, y 2..3) and an
// iron deposit block 'I' (x 16..17, y 2..3) inside a mountain area
// (x 12..17, y 1..4), coast at the bottom left for a second warehouse,
// Citizens unlocked, plenty of gold, planks and stone.
func depositWorld(t *testing.T, c *content.Catalogue) *World {
	t.Helper()
	rows := []string{
		"~~~~~~~~~~~~~~~~~~~~",
		"~cccc.......mmmmmm.~",
		"~....fffff..mSSmII.~",
		"~....fffff..mSSmII.~",
		"~...........mmmmmm.~",
		"~..................~",
		"~..................~",
		"~..................~",
		"~cccc..............~",
		"~~~~~~~~~~~~~~~~~~~~",
	}
	var tiles []Tile
	for _, r := range rows {
		for _, ch := range r {
			switch ch {
			case 'S':
				tiles = append(tiles, Tile{Terrain: content.TerrainMountain, Deposit: &Deposit{Kind: "stone", Quantity: -1}})
			case 'I':
				tiles = append(tiles, Tile{Terrain: content.TerrainMountain, Deposit: &Deposit{Kind: "iron", Quantity: -1}})
			default:
				terrain := map[rune]string{'~': "water", 'c': "coast", '.': "grass", 'f': "forest", 'm': "mountain"}[ch]
				tiles = append(tiles, Tile{Terrain: terrain})
			}
		}
	}
	w := NewWorld(t0)
	w.Islands = []*Island{NewIsland("main", len(rows[0]), len(rows), tiles)}
	if err := PlaceFree(w, c, PlaceBuilding{IslandID: "main", Type: "warehouse", X: 1, Y: 1}, nil); err != nil {
		t.Fatal(err)
	}
	w.Gold = 10_000_000
	addStock(t, w, c, "planks", 200)
	addStock(t, w, c, "stone", 50)
	w.UnlockedTiers = []string{"citizens"}
	return w
}

// expectApplyErr applies cmd, expects the sentinel want and an unchanged
// world.
func expectApplyErr(t *testing.T, w *World, c *content.Catalogue, cmd Command, want error) {
	t.Helper()
	before := encode(t, w)
	if err := Apply(w, c, cmd); !errors.Is(err, want) {
		t.Fatalf("Apply(%+v) = %v, want %v", cmd, err, want)
	}
	if !bytes.Equal(before, encode(t, w)) {
		t.Fatalf("Apply(%+v): world changed on error", cmd)
	}
}

// TestFertility (R-10): a building whose work area needs a fertility can
// only be placed or moved on an island with that tag, checked before cost.
func TestFertility(t *testing.T) {
	c := catalogue(t)
	w := depositWorld(t, c)
	farm := PlaceBuilding{IslandID: "main", Type: "wheat_farm", X: 6, Y: 5}
	expectApplyErr(t, w, c, farm, ErrNoFertility)
	// Site errors come first: terrain before fertility, fertility before
	// cost.
	expectApplyErr(t, w, c, PlaceBuilding{IslandID: "main", Type: "wheat_farm", X: 12, Y: 1}, ErrTerrain)
	gold := w.Gold
	w.Gold = 0
	expectApplyErr(t, w, c, farm, ErrNoFertility)
	w.Gold = gold

	w.Islands[0].Fertilities = []string{"apple", "hemp"}
	expectApplyErr(t, w, c, farm, ErrNoFertility)
	w.Islands[0].Fertilities = []string{"wheat"}
	mustApply(t, w, c, farm)
	id := w.NextBuildingID - 1
	if b := w.Islands[0].Building(id); b == nil || b.Type != "wheat_farm" || b.Efficiency != 1000 {
		t.Fatalf("farm = %+v", b)
	}
	mustApply(t, w, c, MoveBuilding{IslandID: "main", BuildingID: id, X: 7, Y: 5})

	// Moving applies the same rule; buildings without a fertility are not
	// affected (fertility has no rate effect, MECHANICS §2).
	w.Islands[0].Fertilities = []string{"apple"}
	expectApplyErr(t, w, c, MoveBuilding{IslandID: "main", BuildingID: id, X: 6, Y: 5}, ErrNoFertility)
	mustApply(t, w, c, PlaceBuilding{IslandID: "main", Type: "sheep_farm", X: 13, Y: 6})
	cw := w.Clone()
	w.Islands[0].Fertilities[0] = "hemp"
	if !slices.Equal(cw.Islands[0].Fertilities, []string{"apple"}) {
		t.Errorf("clone shares fertilities: %v", cw.Islands[0].Fertilities)
	}
}

// TestDeposits (R-11): deposit buildings may cover mountain tiles and must
// cover a deposit of their kind; nothing else may stand on mountains.
func TestDeposits(t *testing.T) {
	c := catalogue(t)
	w := depositWorld(t, c)
	place := func(typ string, x, y int) PlaceBuilding {
		return PlaceBuilding{IslandID: "main", Type: typ, X: x, Y: y}
	}
	// No deposit: on grass, on mountain without a deposit, on the wrong kind.
	expectApplyErr(t, w, c, place("quarry", 6, 5), ErrNoDeposit)
	expectApplyErr(t, w, c, place("quarry", 12, 4), ErrNoDeposit)
	expectApplyErr(t, w, c, place("quarry", 15, 1), ErrNoDeposit)
	// Water stays unbuildable; other buildings and roads never stand on
	// mountains.
	expectApplyErr(t, w, c, place("quarry", 17, 0), ErrTerrain)
	expectApplyErr(t, w, c, place("sawmill", 13, 2), ErrTerrain)
	expectApplyErr(t, w, c, PlaceRoad{IslandID: "main", Type: "road_dirt", Tiles: []Pos{{12, 1}}}, ErrTerrain)
	// Deposit before cost.
	gold := w.Gold
	w.Gold = 0
	expectApplyErr(t, w, c, place("quarry", 6, 5), ErrNoDeposit)
	w.Gold = gold

	mustApply(t, w, c, place("quarry", 12, 1))
	quarry := w.NextBuildingID - 1
	mustApply(t, w, c, place("iron_mine", 15, 1))
	// Occupancy: a second quarry cannot share the deposit tiles.
	expectApplyErr(t, w, c, place("quarry", 13, 2), ErrOccupied)

	// Move applies the same checks.
	expectApplyErr(t, w, c, MoveBuilding{IslandID: "main", BuildingID: quarry, X: 6, Y: 5}, ErrNoDeposit)
	mustApply(t, w, c, MoveBuilding{IslandID: "main", BuildingID: quarry, X: 12, Y: 2})
	if b := w.Islands[0].Building(quarry); b.X != 12 || b.Y != 2 {
		t.Errorf("quarry at (%d,%d)", b.X, b.Y)
	}
	// Deposits are infinite and unchanged by placements.
	if d := w.Islands[0].Tile(13, 2).Deposit; d == nil || d.Kind != "stone" || d.Quantity != -1 {
		t.Errorf("deposit = %+v", d)
	}
}

// TestUpgradeOnlyHouse (R-12): a house of a later tier cannot be placed by
// a player; seeding (PlaceFree) is unaffected.
func TestUpgradeOnlyHouse(t *testing.T) {
	c := catalogue(t)
	w := depositWorld(t, c)
	expectApplyErr(t, w, c, PlaceBuilding{IslandID: "main", Type: "house_citizens", X: 6, Y: 5}, ErrUpgradeOnly)
	w.UnlockedTiers = nil
	expectApplyErr(t, w, c, PlaceBuilding{IslandID: "main", Type: "house_citizens", X: 6, Y: 5}, ErrUpgradeOnly)
	mustApply(t, w, c, PlaceBuilding{IslandID: "main", Type: "house_settlers", X: 6, Y: 5})
	placeFree(t, w, c, "house_citizens", 9, 5, 0)
}

// TestUpgradeWarehouse (R-13): cost, level, capacity and throughput,
// errors leave the world unchanged, last level, demolish refund.
func TestUpgradeWarehouse(t *testing.T) {
	c := catalogue(t)
	w := depositWorld(t, c)
	wh := int64(1)
	cmd := UpgradeWarehouse{IslandID: "main", BuildingID: wh}
	lvl2 := c.BuildingByID["warehouse"].Warehouse.Levels[1]
	stoneCost := Qty(0)
	planksCost := Qty(0)
	for _, m := range lvl2.Cost.Materials {
		switch m.Good {
		case "stone":
			stoneCost = m.Amount
		case "planks":
			planksCost = m.Amount
		}
	}

	expectApplyErr(t, w, c, UpgradeWarehouse{IslandID: "main", BuildingID: 99}, ErrBuildingNotFound)
	expectApplyErr(t, w, c, UpgradeWarehouse{IslandID: "nowhere", BuildingID: wh}, ErrUnknownIsland)
	h := placeFree(t, w, c, "house_settlers", 6, 5, 0)
	expectApplyErr(t, w, c, UpgradeWarehouse{IslandID: "main", BuildingID: h}, ErrUpgradeUnavailable)

	// Insufficient gold or materials: unchanged world.
	gold := w.Gold
	w.Gold = lvl2.Cost.Gold - 1
	expectApplyErr(t, w, c, cmd, ErrInsufficientGold)
	w.Gold = gold
	stone := w.Islands[0].Inventory.Stock["stone"]
	w.Islands[0].Inventory.Stock["stone"] = stoneCost - 1
	expectApplyErr(t, w, c, cmd, ErrInsufficientMaterials)
	w.Islands[0].Inventory.Stock["stone"] = stone

	planks := w.Islands[0].Inventory.Stock["planks"]
	mustApply(t, w, c, cmd)
	b := w.Islands[0].Building(wh)
	if b.Level != 2 || w.Gold != gold-lvl2.Cost.Gold || w.Islands[0].Inventory.Stock["stone"] != stone-stoneCost ||
		w.Islands[0].Inventory.Stock["planks"] != planks-planksCost {
		t.Fatalf("after upgrade: level %d gold %d stone %d planks %d", b.Level, w.Gold, w.Islands[0].Inventory.Stock["stone"], w.Islands[0].Inventory.Stock["planks"])
	}
	ds := display(t, w, c)
	var whd BuildingDisplay
	for _, bd := range ds.Islands[0].Buildings {
		if bd.ID == wh {
			whd = bd
		}
	}
	if *whd.Level != 2 || *whd.Capacity != lvl2.Capacity || *whd.ThroughputPerMin != lvl2.ThroughputPerMin || ds.Islands[0].Inventory["planks"].Capacity != lvl2.Capacity {
		t.Errorf("display: level %d capacity %d throughput %d inventory %+v", *whd.Level, *whd.Capacity, *whd.ThroughputPerMin, ds.Islands[0].Inventory["planks"])
	}

	// Last level reached.
	expectApplyErr(t, w, c, cmd, ErrUpgradeUnavailable)

	// Demolishing the upgraded warehouse (a second one keeps the island
	// settled) refunds 50 % of the placement and the level materials, no
	// gold (D-019).
	placeFree(t, w, c, "warehouse", 1, 6, 0)
	l := NewLedger()
	gold = w.Gold
	planks = w.Islands[0].Inventory.Stock["planks"]
	stone = w.Islands[0].Inventory.Stock["stone"]
	if err := ApplyWithLedger(w, c, Demolish{IslandID: "main", BuildingID: wh}, l); err != nil {
		t.Fatal(err)
	}
	wantPlanks := refundAmount(material(c.BuildingByID["warehouse"].Cost, "planks")) + refundAmount(planksCost)
	if w.Gold != gold || w.Islands[0].Inventory.Stock["planks"] != planks+wantPlanks || w.Islands[0].Inventory.Stock["stone"] != stone+refundAmount(stoneCost) {
		t.Errorf("refund: gold %d->%d planks %d->%d stone %d->%d", gold, w.Gold, planks, w.Islands[0].Inventory.Stock["planks"], stone, w.Islands[0].Inventory.Stock["stone"])
	}
	if f := l.Flow("main", "stone"); f.Refunded != refundAmount(stoneCost)*SubPerMilli {
		t.Errorf("stone flow = %+v", f)
	}
}

// TestUpgradeWarehouseThroughput: the level-2 throughput lifts the
// throttling of a warehouse at once.
func TestUpgradeWarehouseThroughput(t *testing.T) {
	c := catalogue(t)
	w := testWorld(t, c)
	if err := AddStock(w, c, "main", "stone", 20_000, nil); err != nil {
		t.Fatal(err)
	}
	for _, x := range []int{5, 7, 9, 11} {
		mustApply(t, w, c, PlaceBuilding{IslandID: "main", Type: "lumberjack", X: x, Y: 5})
	}
	before := display(t, w, c)
	mustApply(t, w, c, UpgradeWarehouse{IslandID: "main", BuildingID: 1})
	after := display(t, w, c)
	load := func(ds DisplayState) int64 {
		for _, b := range ds.Islands[0].Buildings {
			if b.ID == 1 {
				return *b.LoadPermille
			}
		}
		return -1
	}
	// load = R / T: the same running output over 90 instead of 60 per min.
	if lb, la := load(before), load(after); lb <= 0 || la >= lb || la < lb*60/90-1 || la > lb*60/90+1 {
		t.Errorf("load before %d after %d", lb, la)
	}
}

// TestAutoPauseTierTwoFirst (R-16): with the shipped tier-2 content, the
// insolvency cascade pauses tier-2 buildings of a category before the
// tier-1 ones (MECHANICS §7: within a step, highest tier first).
func TestAutoPauseTierTwoFirst(t *testing.T) {
	c := catalogue(t)
	w, fisher, weaver, sawmill, sheep, lumberjack := insolventTown(t, c)
	bakery := placeFree(t, w, c, "bakery", 9, 5, 0)
	charcoal := placeFree(t, w, c, "charcoal_burner", 11, 5, 0)
	bs := mustAdvance(t, w, c, time.Minute)
	want := []int64{bakery, weaver, charcoal, lumberjack, sawmill, sheep, fisher}
	if got := pauseEvents(bs, BoundaryAutoPause); !equalIDs(got, want) {
		t.Errorf("pause order = %v, want %v", got, want)
	}
}
