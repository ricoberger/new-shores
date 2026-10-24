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
		"~~~~~.......mmmmmm.~",
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
	if err := PlaceFree(w, c, PlaceBuilding{IslandID: "main", Type: "trading_post", X: 1, Y: 0}, nil); err != nil {
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
	// A farm with fields starts without fields (D-049).
	if b := w.Islands[0].Building(id); b == nil || b.Type != "wheat_farm" || b.Efficiency != 0 {
		t.Fatalf("farm = %+v", b)
	}
	// Its fields need the fertility too.
	field := PlaceBuilding{IslandID: "main", Type: "wheat_field", X: 5, Y: 5}
	mustApply(t, w, c, field)
	w.Islands[0].Fertilities = []string{"apple"}
	expectApplyErr(t, w, c, PlaceBuilding{IslandID: "main", Type: "wheat_field", X: 5, Y: 6}, ErrNoFertility)
	w.Islands[0].Fertilities = []string{"wheat"}
	mustApply(t, w, c, Demolish{IslandID: "main", BuildingID: w.NextBuildingID - 1})
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

// TestUpgradeWarehouse (R-13, D-051): cost, level, capacity and
// throughput of a Trading Post upgrade, errors leave the world unchanged;
// a Warehouse upgrade raises throughput only; the last level; the demolish
// refund of an upgraded Warehouse.
func TestUpgradeWarehouse(t *testing.T) {
	c := catalogue(t)
	w := depositWorld(t, c)
	wh := int64(1)
	cmd := UpgradeTradingPost{IslandID: "main", BuildingID: wh}
	lvl2 := c.BuildingByID["trading_post"].TradingPost.Levels[1]
	cost := func(cost *content.Cost, good string) Qty {
		for _, m := range cost.Materials {
			if m.Good == good {
				return m.Amount
			}
		}
		return 0
	}
	stoneCost, planksCost := cost(lvl2.Cost, "stone"), cost(lvl2.Cost, "planks")

	expectApplyErr(t, w, c, UpgradeTradingPost{IslandID: "main", BuildingID: 99}, ErrBuildingNotFound)
	expectApplyErr(t, w, c, UpgradeTradingPost{IslandID: "nowhere", BuildingID: wh}, ErrUnknownIsland)
	h := placeFree(t, w, c, "house_settlers", 6, 5, 0)
	expectApplyErr(t, w, c, UpgradeTradingPost{IslandID: "main", BuildingID: h}, ErrUpgradeUnavailable)
	// The two upgrades do not mix: a Trading Post is no Warehouse.
	expectApplyErr(t, w, c, UpgradeWarehouse{IslandID: "main", BuildingID: wh}, ErrUpgradeUnavailable)

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
	whd := buildingDisplay(t, ds, wh)
	if *whd.Level != 2 || *whd.Capacity != lvl2.Capacity || *whd.ThroughputPerMin != lvl2.ThroughputPerMin || ds.Islands[0].Inventory["planks"].Capacity != lvl2.Capacity ||
		whd.Berths == nil || whd.Berths.Total != lvl2.Berths || w.Islands[0].Building(wh).Berths != lvl2.Berths ||
		ds.Islands[0].CapacitySource == nil || ds.Islands[0].CapacitySource.Level != 2 || ds.Islands[0].CapacitySource.Capacity != lvl2.Capacity {
		t.Errorf("display: level %d capacity %d throughput %d inventory %+v", *whd.Level, *whd.Capacity, *whd.ThroughputPerMin, ds.Islands[0].Inventory["planks"])
	}

	// A Warehouse: throughput only, never capacity; up to its last level.
	whDef := c.BuildingByID["warehouse"]
	inland := placeFree(t, w, c, "warehouse", 6, 7, 0)
	expectApplyErr(t, w, c, UpgradeTradingPost{IslandID: "main", BuildingID: inland}, ErrUpgradeUnavailable)
	capBefore := display(t, w, c).Islands[0].Inventory["planks"].Capacity
	for lvl := 2; lvl <= len(whDef.Warehouse.Levels); lvl++ {
		mustApply(t, w, c, UpgradeWarehouse{IslandID: "main", BuildingID: inland})
	}
	expectApplyErr(t, w, c, UpgradeWarehouse{IslandID: "main", BuildingID: inland}, ErrUpgradeUnavailable)
	ds = display(t, w, c)
	if d := buildingDisplay(t, ds, inland); d.Capacity != nil || *d.Level != len(whDef.Warehouse.Levels) || *d.ThroughputPerMin != whDef.Warehouse.Levels[len(whDef.Warehouse.Levels)-1].ThroughputPerMin {
		t.Errorf("warehouse display = %+v", d)
	}
	if got := ds.Islands[0].Inventory["planks"].Capacity; got != capBefore {
		t.Errorf("capacity %d -> %d: a warehouse must not add capacity", capBefore, got)
	}

	// Demolishing the upgraded Warehouse refunds 50 % of the placement and
	// of every paid level, no gold (D-019).
	l := NewLedger()
	gold = w.Gold
	planks = w.Islands[0].Inventory.Stock["planks"]
	stone = w.Islands[0].Inventory.Stock["stone"]
	if err := ApplyWithLedger(w, c, Demolish{IslandID: "main", BuildingID: inland}, l); err != nil {
		t.Fatal(err)
	}
	wantPlanks, wantStone := refundAmount(material(whDef.Cost, "planks")), Qty(0)
	for lvl := 2; lvl <= len(whDef.Warehouse.Levels); lvl++ {
		wantPlanks += refundAmount(cost(whDef.LevelCost(lvl), "planks"))
		wantStone += refundAmount(cost(whDef.LevelCost(lvl), "stone"))
	}
	if w.Gold != gold || w.Islands[0].Inventory.Stock["planks"] != planks+wantPlanks || w.Islands[0].Inventory.Stock["stone"] != stone+wantStone {
		t.Errorf("refund: gold %d->%d planks %d->%d stone %d->%d", gold, w.Gold, planks, w.Islands[0].Inventory.Stock["planks"], stone, w.Islands[0].Inventory.Stock["stone"])
	}
	if f := l.Flow("main", "stone"); f.Refunded != wantStone*SubPerMilli {
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
	mustApply(t, w, c, UpgradeTradingPost{IslandID: "main", BuildingID: 1})
	after := display(t, w, c)
	load := func(ds DisplayState) int64 {
		for _, b := range ds.Islands[0].Buildings {
			if b.ID == 1 {
				return *b.LoadPermille
			}
		}
		return -1
	}
	// load = R / T: the same running output over the level-2 instead of
	// the level-1 throughput.
	levels := c.BuildingByID["trading_post"].TradingPost.Levels
	t1, t2 := levels[0].ThroughputPerMin, levels[1].ThroughputPerMin
	if lb, la := load(before), load(after); lb <= 0 || la >= lb || la < lb*t1/t2-1 || la > lb*t1/t2+1 {
		t.Errorf("load before %d after %d", lb, la)
	}
}

// TestAutoPauseTierTwoFirst (R-16): with the shipped tier-2 content, the
// insolvency cascade pauses tier-2 buildings of a category before the
// tier-1 ones (MECHANICS §7: within a step, highest tier first).
func TestAutoPauseTierTwoFirst(t *testing.T) {
	c := orderCatalogue(t)
	w, fisher, weaver, sawmill, sheep, lumberjack := insolventTown(t, c)
	bakery := placeFree(t, w, c, "bakery", 9, 5, 0)
	charcoal := placeFree(t, w, c, "charcoal_burner", 11, 5, 0)
	bs := mustAdvance(t, w, c, time.Minute)
	want := []int64{bakery, weaver, charcoal, lumberjack, sawmill, sheep, fisher}
	if got := pauseEvents(bs, BoundaryAutoPause); !equalIDs(got, want) {
		t.Errorf("pause order = %v, want %v", got, want)
	}
}
