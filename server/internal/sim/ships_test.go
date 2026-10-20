package sim

import (
	"bytes"
	"errors"
	"maps"
	"strings"
	"testing"
	"time"

	"github.com/ricoberger/new-shores/server/internal/content"
)

// shipWorld is a two-island archipelago: "a" at (0, 0), settled, with a
// warehouse at (1, 2), a road along y = 5 and a connected shipyard at
// (6, 1); "b" at (6, 8) (10 tiles away: 10 s at speed 1.0), unsettled with
// a coastal site for a warehouse at (1, 1). Gold and planks are plentiful.
func shipWorld(t testing.TB, c *content.Catalogue) *World {
	t.Helper()
	w := NewWorld(t0)
	a := islandFromRows("a",
		"~~~~~~~~~~~~~~~~~~~~~~~~",
		"~cccccccccccccccccccccc~",
		"~cccccccccccccccccccccc~",
		"~......................~",
		"~......................~",
		"~......................~",
		"~......................~",
		"~......................~",
		"~~~~~~~~~~~~~~~~~~~~~~~~",
	)
	b := islandFromRows("b",
		"~~~~~~~~~~~~",
		"~cccccccccc~",
		"~cccccccccc~",
		"~..........~",
		"~..........~",
		"~..........~",
		"~~~~~~~~~~~~",
	)
	b.Name, b.X, b.Y = "Island B", 6, 8
	w.Islands = []*Island{a, b}
	if err := PlaceFree(w, c, PlaceBuilding{IslandID: "a", Type: "warehouse", X: 1, Y: 2}, nil); err != nil {
		t.Fatal(err)
	}
	w.Gold = 100_000_000
	for good, qty := range map[string]Qty{"planks": 250_000, "sails": 100_000, "wood": 200_000} {
		if err := AddStock(w, c, "a", good, qty, nil); err != nil {
			t.Fatal(err)
		}
	}
	var road []Pos
	for x := 1; x <= 20; x++ {
		road = append(road, Pos{x, 5})
	}
	mustApply(t, w, c, PlaceRoad{IslandID: "a", Type: "road_dirt", Tiles: road})
	mustApply(t, w, c, PlaceBuilding{IslandID: "a", Type: "shipyard", X: 6, Y: 1})
	return w
}

// builtSloop orders a sloop at the shipyard (building 2) and advances until
// it is built; it returns the ship.
func builtSloop(t testing.TB, w *World, c *content.Catalogue) *Ship {
	t.Helper()
	mustApply(t, w, c, OrderShip{IslandID: "a", BuildingID: 2, ShipType: "sloop"})
	mustAdvance(t, w, c, 2*time.Minute)
	if len(w.Ships) == 0 {
		t.Fatal("no ship built")
	}
	return w.Ships[len(w.Ships)-1]
}

// material returns the amount of good in a cost (milli-units).
func material(cost content.Cost, good string) Qty {
	for _, m := range cost.Materials {
		if m.Good == good {
			return m.Amount
		}
	}
	return 0
}

func expectErr(t *testing.T, w *World, c *content.Catalogue, cmd Command, want error) {
	t.Helper()
	before := encode(t, w)
	if err := Apply(w, c, cmd); !errors.Is(err, want) {
		t.Fatalf("Apply(%#v) = %v, want %v", cmd, err, want)
	}
	if !bytes.Equal(before, encode(t, w)) {
		t.Fatalf("Apply(%#v) failed but changed the world", cmd)
	}
}

// TestTravelMsGolden pins the single travel-time formula (integer
// arithmetic, rounded up to whole milliseconds).
func TestTravelMsGolden(t *testing.T) {
	for _, tt := range []struct {
		x0, y0, x1, y1 int
		speed, tpm     int64
		want           int64
	}{
		{0, 0, 72, 96, 1000, 60_000, 120_000}, // dev archipelago: 120 tiles at 60 tiles/min
		{0, 0, 6, 8, 1000, 60_000, 10_000},
		{0, 0, 1, 1, 1200, 60_000, 1_180}, // ceil(1415 milli-tiles * 6e7 / 7.2e7)
		{0, 0, 3, 4, 1000, 7_000, 42_858}, // ceil(5000 * 6e7 / 7e6)
		{5, 5, 5, 5, 1000, 60_000, 1},     // minimum 1 ms
		{-3, 0, 0, 4, 500, 60_000, 10_000},
		{0, 0, 2_000_000, 0, 1, 1, 60_000_000_000_000_000}, // coordinates clamp to 1e6 tiles
	} {
		if got := TravelMs(tt.x0, tt.y0, tt.x1, tt.y1, tt.speed, tt.tpm); got != tt.want {
			t.Errorf("TravelMs(%d,%d -> %d,%d, %d, %d) = %d, want %d", tt.x0, tt.y0, tt.x1, tt.y1, tt.speed, tt.tpm, got, tt.want)
		}
	}
	for n := range uint64(200_000) {
		r := isqrt(n)
		if r*r > n || (r+1)*(r+1) <= n {
			t.Fatalf("isqrt(%d) = %d", n, r)
		}
	}
	if r := isqrt(1<<64 - 1); r != 1<<32-1 {
		t.Fatalf("isqrt(max) = %d", r)
	}
}

func TestCargoSlots(t *testing.T) {
	s := &Ship{}
	setCargo(s, 50_000, map[string]Qty{"planks": 70_000, "fish": 0})
	if len(s.Cargo) != 2 || s.Cargo[0] != (Slot{"planks", 50_000}) || s.Cargo[1] != (Slot{"planks", 20_000}) {
		t.Fatalf("cargo = %+v", s.Cargo)
	}
	a := cargoAmounts(s)
	if slotsUsed(a, 50_000) != 2 || cargoRoom(a, "planks", 50_000, 2) != 30_000 || cargoRoom(a, "fish", 50_000, 2) != 0 ||
		cargoRoom(a, "fish", 50_000, 3) != 50_000 {
		t.Errorf("slots %d room %d/%d", slotsUsed(a, 50_000), cargoRoom(a, "planks", 50_000, 2), cargoRoom(a, "fish", 50_000, 2))
	}
}

func TestOrderShipAndBuilt(t *testing.T) {
	c := catalogue(t)
	w := shipWorld(t, c)
	gold, planks, sails := w.Gold, w.Islands[0].Inventory.Stock["planks"], w.Islands[0].Inventory.Stock["sails"]

	expectErr(t, w, c, OrderShip{IslandID: "a", BuildingID: 1, ShipType: "sloop"}, ErrNotAShipyard)
	expectErr(t, w, c, OrderShip{IslandID: "a", BuildingID: 2, ShipType: "galleon"}, ErrUnknownShipType)
	expectErr(t, w, c, OrderShip{IslandID: "a", BuildingID: 99, ShipType: "sloop"}, ErrBuildingNotFound)
	sloop := c.ShipByID["sloop"]
	poor := w.Clone()
	poor.Gold = sloop.Cost.Gold - 1
	expectErr(t, poor, c, OrderShip{IslandID: "a", BuildingID: 2, ShipType: "sloop"}, ErrInsufficientGold)

	mustApply(t, w, c, OrderShip{IslandID: "a", BuildingID: 2, ShipType: "sloop"})
	if w.Gold != gold-sloop.Cost.Gold || w.Islands[0].Inventory.Stock["planks"] != planks-material(sloop.Cost, "planks") ||
		w.Islands[0].Inventory.Stock["sails"] != sails-material(sloop.Cost, "sails") {
		t.Errorf("cost not charged: gold %d planks %d sails %d", w.Gold, w.Islands[0].Inventory.Stock["planks"], w.Islands[0].Inventory.Stock["sails"])
	}
	expectErr(t, w, c, OrderShip{IslandID: "a", BuildingID: 2, ShipType: "sloop"}, ErrShipyardBusy)
	due := t0.Add(2 * time.Minute)
	if ev := DueEvents(w); len(ev) != 1 || ev[0] != (DueEvent{Kind: DueShipBuilt, At: due, IslandID: "a", BuildingID: 2}) {
		t.Fatalf("due events = %+v", ev)
	}
	ds := display(t, w, c)
	if *ds.NextChangeAt != "2026-01-01T00:02:00.000Z" {
		t.Errorf("next change %s", *ds.NextChangeAt)
	}
	sy := buildingDisplay(t, ds, 2)
	if !sy.ShipOrder.Present || sy.ShipOrder.Order == nil || sy.ShipOrder.Order.DueAt != "2026-01-01T00:02:00.000Z" || sy.Status != StatusOK {
		t.Errorf("shipyard display = %+v", sy)
	}
	if wh := buildingDisplay(t, ds, 1); wh.ShipOrder.Present {
		t.Error("warehouse has a ship_order field")
	}

	// One millisecond before the due time nothing exists; at it, the ship.
	mustAdvance(t, w, c, 2*time.Minute-time.Millisecond)
	if len(w.Ships) != 0 {
		t.Fatal("ship built early")
	}
	bs := mustAdvance(t, w, c, time.Millisecond)
	if countKind(bs, BoundaryShipBuilt) != 1 || len(w.Ships) != 1 || len(DueEvents(w)) != 0 {
		t.Fatalf("boundaries %+v ships %+v", bs, w.Ships)
	}
	s := w.Ships[0]
	if s.ID != 1 || s.Type != "sloop" || s.State != ShipIdle || s.IslandID != "a" || s.Leg != nil || len(s.Cargo) != 0 || w.Islands[0].Building(2).Order != nil {
		t.Fatalf("ship = %+v", s)
	}
	ds = display(t, w, c)
	if len(ds.Ships) != 1 || ds.Ships[0].Slots != 2 || ds.Ships[0].SlotSize != 50_000 || ds.Ships[0].UpkeepPerMin != sloop.UpkeepPerMin || ds.Ships[0].Leg != nil {
		t.Errorf("ships display = %+v", ds.Ships)
	}
	// Upkeep counts from the build: warehouse + shipyard + sloop.
	if ds.UpkeepRatePerMin != c.BuildingByID["warehouse"].UpkeepPerMin+c.BuildingByID["shipyard"].UpkeepPerMin+sloop.UpkeepPerMin {
		t.Errorf("upkeep = %d", ds.UpkeepRatePerMin)
	}
}

func TestShipyardNeedsConnection(t *testing.T) {
	c := catalogue(t)
	w := shipWorld(t, c)
	mustApply(t, w, c, PlaceBuilding{IslandID: "a", Type: "shipyard", X: 14, Y: 1})
	mustApply(t, w, c, DemolishRoad{IslandID: "a", Tiles: []Pos{{13, 5}}})
	if b := w.Islands[0].Building(3); b.AssignedWarehouseID != 0 {
		t.Fatal("shipyard behind the gap is connected")
	}
	expectErr(t, w, c, OrderShip{IslandID: "a", BuildingID: 3, ShipType: "sloop"}, ErrNotConnected)
	if b := buildingDisplay(t, display(t, w, c), 3); b.Status != StatusNotConnected || !b.ShipOrder.Present || b.ShipOrder.Order != nil {
		t.Errorf("display = %+v", b)
	}
}

func TestCancelShipOrderAndDemolishRefund(t *testing.T) {
	c := catalogue(t)
	w := shipWorld(t, c)
	expectErr(t, w, c, CancelShipOrder{IslandID: "a", BuildingID: 2}, ErrNoShipOrder)
	mustApply(t, w, c, OrderShip{IslandID: "a", BuildingID: 2, ShipType: "sloop"})
	gold, planks, sails := w.Gold, w.Islands[0].Inventory.Stock["planks"], w.Islands[0].Inventory.Stock["sails"]
	cw := w.Clone()
	mustApply(t, w, c, CancelShipOrder{IslandID: "a", BuildingID: 2})
	sloop := c.ShipByID["sloop"].Cost
	if w.Gold != gold || w.Islands[0].Inventory.Stock["planks"] != planks+refundAmount(material(sloop, "planks")) ||
		w.Islands[0].Inventory.Stock["sails"] != sails+refundAmount(material(sloop, "sails")) || len(DueEvents(w)) != 0 {
		t.Errorf("cancel: gold %d planks %d sails %d", w.Gold, w.Islands[0].Inventory.Stock["planks"], w.Islands[0].Inventory.Stock["sails"])
	}
	mustAdvance(t, w, c, 3*time.Minute)
	if len(w.Ships) != 0 {
		t.Error("cancelled order built a ship")
	}
	// Demolishing the busy shipyard refunds the building and the order.
	mustApply(t, cw, c, Demolish{IslandID: "a", BuildingID: 2})
	if cw.Islands[0].Inventory.Stock["planks"] != planks+refundAmount(material(c.BuildingByID["shipyard"].Cost, "planks"))+refundAmount(material(sloop, "planks")) ||
		cw.Islands[0].Inventory.Stock["sails"] != sails+refundAmount(material(sloop, "sails")) || len(DueEvents(cw)) != 0 {
		t.Errorf("demolish: planks %d sails %d", cw.Islands[0].Inventory.Stock["planks"], cw.Islands[0].Inventory.Stock["sails"])
	}
}

func TestManualShipmentAndFounding(t *testing.T) {
	c := catalogue(t)
	w := shipWorld(t, c)
	s := builtSloop(t, w, c)
	start := w.LastEvaluatedAt.UnixMilli()

	expectErr(t, w, c, ManualShipment{ShipID: 9, ToIslandID: "b"}, ErrShipNotFound)
	expectErr(t, w, c, ManualShipment{ShipID: 1, ToIslandID: "a", Cargo: []CargoAmount{{"planks", 1000}}}, ErrRouteInvalid)
	expectErr(t, w, c, ManualShipment{ShipID: 1, ToIslandID: "x", Cargo: []CargoAmount{{"planks", 1000}}}, ErrRouteInvalid)
	expectErr(t, w, c, ManualShipment{ShipID: 1, ToIslandID: "b"}, ErrInvalidCommand)
	expectErr(t, w, c, ManualShipment{ShipID: 1, ToIslandID: "b", Cargo: []CargoAmount{{"silk", 1000}}}, ErrInvalidCommand)
	expectErr(t, w, c, ManualShipment{ShipID: 1, ToIslandID: "b", Cargo: []CargoAmount{{"planks", 0}}}, ErrInvalidCommand)
	expectErr(t, w, c, ManualShipment{ShipID: 1, ToIslandID: "b", Cargo: []CargoAmount{{"planks", 1000}, {"planks", 1000}}}, ErrInvalidCommand)
	expectErr(t, w, c, ManualShipment{ShipID: 1, ToIslandID: "b", Cargo: []CargoAmount{{"fish", 1000}}}, ErrInsufficientMaterials)
	expectErr(t, w, c, ManualShipment{ShipID: 1, ToIslandID: "b", Cargo: []CargoAmount{{"planks", 60_000}, {"wood", 1000}}}, ErrCargoExceedsSlots)
	// Placement on the unsettled island is rejected.
	expectErr(t, w, c, PlaceBuilding{IslandID: "b", Type: "warehouse", X: 1, Y: 1}, ErrIslandNotSettled)

	planks := w.Islands[0].Inventory.Stock["planks"]
	mustApply(t, w, c, ManualShipment{ShipID: 1, ToIslandID: "b", Cargo: []CargoAmount{{"planks", 50_000}, {"wood", 1_500}}})
	if s.State != ShipManualLeg || s.IslandID != "a" || *s.Leg != (Leg{"a", "b", start + 20_000, start + 30_000}) ||
		w.Islands[0].Inventory.Stock["planks"] != planks-50_000 {
		t.Fatalf("ship %+v leg %+v", s, s.Leg)
	}
	// The display re-fetch point is the departure (the ship's location
	// changes), then the arrival.
	if ds := display(t, w, c); *ds.NextChangeAt != formatMs(start+20_000) || ds.Ships[0].IslandID != "a" {
		t.Errorf("next change %s, ship at %q", *ds.NextChangeAt, ds.Ships[0].IslandID)
	}
	// At the departure the ship has left its island.
	mustAdvance(t, w, c, 20*time.Second)
	if s.IslandID != "" {
		t.Errorf("travelling ship at %q", s.IslandID)
	}
	// Arrival at the unsettled island: capacity 0, nothing unloads.
	mustAdvance(t, w, c, 10*time.Second)
	if s.State != ShipIdle || s.IslandID != "b" || s.Leg != nil || cargoAmounts(s)["planks"] != 50_000 {
		t.Fatalf("after arrival: %+v", s)
	}
	// Founding.
	expectErr(t, w, c, FoundIsland{ShipID: 1, IslandID: "a", BuildingType: "warehouse", X: 1, Y: 1}, ErrShipNotIdle)
	expectErr(t, w, c, FoundIsland{ShipID: 1, IslandID: "b", BuildingType: "fisher", X: 1, Y: 1}, ErrInvalidCommand)
	expectErr(t, w, c, FoundIsland{ShipID: 1, IslandID: "b", BuildingType: "warehouse", X: 1, Y: 3}, ErrNotCoastal)
	poor := w.Clone()
	poor.Gold = 0
	expectErr(t, poor, c, FoundIsland{ShipID: 1, IslandID: "b", BuildingType: "warehouse", X: 1, Y: 1}, ErrInsufficientGold)
	whCost := c.BuildingByID["warehouse"].Cost
	low := w.Clone()
	setCargo(low.Ship(1), 50_000, map[string]Qty{"planks": material(whCost, "planks") - 1_000})
	if err := Apply(low, c, FoundIsland{ShipID: 1, IslandID: "b", BuildingType: "warehouse", X: 1, Y: 1}); !errors.Is(err, ErrCargoInsufficient) || !strings.Contains(err.Error(), "planks") {
		t.Errorf("err = %v", err)
	}
	gold := w.Gold
	l := NewLedger()
	if err := ApplyWithLedger(w, c, FoundIsland{ShipID: 1, IslandID: "b", BuildingType: "warehouse", X: 1, Y: 1}, l); err != nil {
		t.Fatal(err)
	}
	b := w.Island("b")
	if w.Gold != gold-whCost.Gold || !settled(b, c) || b.Inventory.Stock["planks"] != 50_000-material(whCost, "planks") || b.Inventory.Stock["wood"] != 1_500 || len(s.Cargo) != 0 || s.State != ShipIdle {
		t.Errorf("founded: gold %d stock %v cargo %v", w.Gold, b.Inventory.Stock, s.Cargo)
	}
	if f := l.Flow("b", "planks"); f.Spent != material(whCost, "planks")*SubPerMilli || f.Unloaded != 50_000*SubPerMilli {
		t.Errorf("ledger %+v", f)
	}
	expectErr(t, w, c, FoundIsland{ShipID: 1, IslandID: "b", BuildingType: "warehouse", X: 5, Y: 1}, ErrIslandAlreadySettled)
	if ds := display(t, w, c); !ds.Islands[1].Settled || ds.Islands[1].Name != "Island B" || ds.Islands[1].Position != (PositionDisplay{6, 8}) {
		t.Errorf("island display %+v", ds.Islands[1])
	}
	// Building on the new island works; the last warehouse is protected.
	mustApply(t, w, c, PlaceBuilding{IslandID: "b", Type: "house_settlers", X: 6, Y: 3})
	expectErr(t, w, c, Demolish{IslandID: "b", BuildingID: 3, AcceptSurplusLoss: true}, ErrLastWarehouse)
}

func TestManualShipmentExcessStaysAboard(t *testing.T) {
	c := catalogue(t)
	w := shipWorld(t, c)
	s := builtSloop(t, w, c)
	mustApply(t, w, c, ManualShipment{ShipID: s.ID, ToIslandID: "b", Cargo: []CargoAmount{{"planks", 50_000}}})
	mustAdvance(t, w, c, 30*time.Second)
	mustApply(t, w, c, FoundIsland{ShipID: s.ID, IslandID: "b", BuildingType: "warehouse", X: 1, Y: 1})
	// Island b holds 20 planks of 300; bring 100 wood + fill b with wood first.
	if err := AddStock(w, c, "b", "wood", 250_000, nil); err != nil {
		t.Fatal(err)
	}
	mustApply(t, w, c, ManualShipment{ShipID: s.ID, ToIslandID: "a", Cargo: []CargoAmount{{"planks", 20_000}}})
	mustAdvance(t, w, c, 30*time.Second)
	mustApply(t, w, c, ManualShipment{ShipID: s.ID, ToIslandID: "b", Cargo: []CargoAmount{{"wood", 100_000}}})
	mustAdvance(t, w, c, 30*time.Second)
	if got := cargoAmounts(s)["wood"]; s.State != ShipIdle || got != 50_000 || w.Island("b").Inventory.Stock["wood"] != 300_000 {
		t.Errorf("excess aboard %d (want 50 units), b wood %d", got, w.Island("b").Inventory.Stock["wood"])
	}
}

// routeWorld has island b founded (no stock) and the sloop idle at b.
func routeWorld(t *testing.T, c *content.Catalogue) (*World, *Ship) {
	t.Helper()
	w := shipWorld(t, c)
	s := builtSloop(t, w, c)
	mustApply(t, w, c, ManualShipment{ShipID: s.ID, ToIslandID: "b", Cargo: []CargoAmount{{"planks", 30_000}}})
	mustAdvance(t, w, c, 30*time.Second)
	mustApply(t, w, c, FoundIsland{ShipID: s.ID, IslandID: "b", BuildingType: "warehouse", X: 1, Y: 1})
	return w, s
}

func TestRouteValidationAndCRUD(t *testing.T) {
	c := catalogue(t)
	w := shipWorld(t, c)
	stop := func(island string) Stop { return Stop{IslandID: island} }
	// b is not settled yet.
	expectErr(t, w, c, CreateRoute{Stops: []Stop{stop("a"), stop("b")}}, ErrRouteInvalid)
	w, s := routeWorld(t, c)
	for name, stops := range map[string][]Stop{
		"one stop":         {stop("a")},
		"nine stops":       {stop("a"), stop("b"), stop("a"), stop("b"), stop("a"), stop("b"), stop("a"), stop("b"), stop("a")},
		"unknown island":   {stop("a"), stop("x")},
		"consecutive":      {stop("a"), stop("a"), stop("b")},
		"last equal first": {stop("a"), stop("b"), stop("a")},
		"unknown good":     {{IslandID: "a", Load: []LoadRule{{"silk", 1000}}}, stop("b")},
		"duplicate load":   {{IslandID: "a", Load: []LoadRule{{"wood", 1000}, {"wood", 2000}}}, stop("b")},
		"duplicate unload": {{IslandID: "a", Unload: []string{"wood", "wood"}}, stop("b")},
		"load and unload":  {{IslandID: "a", Load: []LoadRule{{"wood", 1000}}, Unload: []string{"wood"}}, stop("b")},
		"zero max":         {{IslandID: "a", Load: []LoadRule{{"wood", 0}}}, stop("b")},
		"fractional max":   {{IslandID: "a", Load: []LoadRule{{"wood", 1500}}}, stop("b")},
	} {
		t.Run(name, func(t *testing.T) { expectErr(t, w, c, CreateRoute{Stops: stops}, ErrRouteInvalid) })
	}
	expectErr(t, w, c, CreateRoute{Name: strings.Repeat("x", 41), Stops: []Stop{stop("a"), stop("b")}}, ErrRouteInvalid)
	mustApply(t, w, c, CreateRoute{Name: strings.Repeat("é", 40), Stops: []Stop{stop("a"), stop("b")}})
	mustApply(t, w, c, CreateRoute{Stops: []Stop{stop("a"), stop("b")}})
	if r := w.Route(2); r == nil || r.Name != "Route 2" {
		t.Fatalf("route = %+v", r)
	}
	expectErr(t, w, c, UpdateRoute{RouteID: 9, Stops: []Stop{stop("a"), stop("b")}}, ErrRouteNotFound)
	mustApply(t, w, c, UpdateRoute{RouteID: 2, Name: "Wood", Stops: []Stop{stop("b"), stop("a")}})
	mustApply(t, w, c, AssignShip{ShipID: s.ID, RouteID: 2})
	expectErr(t, w, c, DeleteRoute{RouteID: 2}, ErrRouteInUse)
	expectErr(t, w, c, DeleteRoute{RouteID: 9}, ErrRouteNotFound)
	mustApply(t, w, c, DeleteRoute{RouteID: 1})
	ds := display(t, w, c)
	if len(ds.Routes) != 1 || ds.Routes[0].Name != "Wood" || len(ds.Routes[0].ShipIDs) != 1 || ds.Routes[0].LoopMs != 2*20_000+2*10_000 {
		t.Errorf("routes = %+v", ds.Routes)
	}
}

// TestRouteLoop: a ship assigned at a stop handles it at once and departs
// after the handling time; stops are resolved at arrival, loads top up to
// the maximum aboard, unloads respect capacity.
func TestRouteLoop(t *testing.T) {
	c := catalogue(t)
	w, s := routeWorld(t, c)
	if err := AddStock(w, c, "b", "fish", 80_000, nil); err != nil {
		t.Fatal(err)
	}
	mustApply(t, w, c, CreateRoute{Stops: []Stop{
		{IslandID: "a", Load: []LoadRule{{"wood", 60_000}}, Unload: []string{"fish"}},
		{IslandID: "b", Load: []LoadRule{{"fish", 30_000}}, Unload: []string{"wood"}},
	}})
	now := w.LastEvaluatedAt.UnixMilli()
	mustApply(t, w, c, AssignShip{ShipID: s.ID, RouteID: 1})
	// At b (stop 1): load 30 fish now, depart to a (stop 0) after 20 s.
	if s.State != ShipOnRoute || s.StopIndex != 0 || *s.Leg != (Leg{"b", "a", now + 20_000, now + 30_000}) ||
		cargoAmounts(s)["fish"] != 30_000 || w.Island("b").Inventory.Stock["fish"] != 50_000 {
		t.Fatalf("after assign: %+v %+v cargo %v", s, s.Leg, s.Cargo)
	}
	expectErr(t, w, c, AssignShip{ShipID: s.ID, RouteID: 1}, ErrShipNotIdle)
	expectErr(t, w, c, ScrapShip{ShipID: s.ID}, ErrShipNotIdle)
	if ev := DueEvents(w); len(ev) != 1 || ev[0].Kind != DueShipArrived || ev[0].ShipID != s.ID || ev[0].At.UnixMilli() != now+30_000 {
		t.Fatalf("due = %+v", ev)
	}
	// Arrival at a: unload 30 fish, load wood up to 60 (fish slot freed).
	woodA := w.Island("a").Inventory.Stock["wood"]
	mustAdvance(t, w, c, 30*time.Second)
	if got := cargoAmounts(s); got["fish"] != 0 || got["wood"] != 60_000 || s.StopIndex != 1 || s.Leg.ToIsland != "b" ||
		w.Island("a").Inventory.Stock["fish"] != 30_000 || w.Island("a").Inventory.Stock["wood"] != woodA-60_000 {
		t.Fatalf("at a: cargo %v stop %d", got, s.StopIndex)
	}
	// Top-up: at the next visit of a only the missing wood is loaded.
	mustAdvance(t, w, c, 30*time.Second) // at b: unload wood, load fish
	if got := cargoAmounts(s); got["wood"] != 0 || got["fish"] != 30_000 || w.Island("b").Inventory.Stock["wood"] != 60_000 {
		t.Fatalf("at b: cargo %v", got)
	}
	// Route edit mid-leg (heading to a with StopIndex 0): in the edited
	// route stop 0 is b, so the arrival at a matches stop 1 cyclically.
	mustApply(t, w, c, UpdateRoute{RouteID: 1, Stops: []Stop{
		{IslandID: "b", Unload: []string{"fish"}},
		{IslandID: "a", Load: []LoadRule{{"planks", 10_000}}},
	}})
	mustAdvance(t, w, c, 30*time.Second) // arrives at a = stop 1 (cyclic search from StopIndex 0)
	if s.StopIndex != 0 || s.Leg.ToIsland != "b" || cargoAmounts(s)["planks"] != 10_000 || cargoAmounts(s)["fish"] != 30_000 {
		t.Fatalf("after edit: stop %d leg %+v cargo %v", s.StopIndex, s.Leg, s.Cargo)
	}
	// Unassign mid-leg: the leg continues, the arrival unloads everything.
	mustAdvance(t, w, c, 25*time.Second)
	mustApply(t, w, c, UnassignShip{ShipID: s.ID})
	expectErr(t, w, c, UnassignShip{ShipID: s.ID}, ErrShipNotOnRoute)
	if s.State != ShipManualLeg || s.RouteID != 0 {
		t.Fatalf("unassigned: %+v", s)
	}
	mustAdvance(t, w, c, 5*time.Second)
	if s.State != ShipIdle || s.IslandID != "b" || len(s.Cargo) != 0 {
		t.Fatalf("after manual arrival: %+v", s)
	}
}

// TestAssignAwayFromRoute: a ship at an island without a stop departs at
// once to stop 0 without handling.
func TestAssignAwayFromRoute(t *testing.T) {
	c := catalogue(t)
	w, s := routeWorld(t, c)
	b2 := islandFromRows("c", "~~~~~~", "~cccc~", "~....~", "~....~", "~~~~~~")
	b2.X, b2.Y = 30, 40
	w.Islands = append(w.Islands, b2)
	if err := PlaceFree(w, c, PlaceBuilding{IslandID: "c", Type: "warehouse", X: 1, Y: 1}, nil); err != nil {
		t.Fatal(err)
	}
	mustApply(t, w, c, CreateRoute{Stops: []Stop{{IslandID: "c"}, {IslandID: "a"}}})
	now := w.LastEvaluatedAt.UnixMilli()
	mustApply(t, w, c, AssignShip{ShipID: s.ID, RouteID: 1})
	want := TravelMs(6, 8, 30, 40, 1000, 60_000)
	if s.IslandID != "" || s.StopIndex != 0 || *s.Leg != (Leg{"b", "c", now, now + want}) {
		t.Fatalf("positioning: %+v %+v", s, s.Leg)
	}
	// The route changes mid-leg so that c is no stop: at the arrival the
	// ship handles nothing and departs at once to stop 0.
	mustApply(t, w, c, UpdateRoute{RouteID: 1, Stops: []Stop{{IslandID: "a"}, {IslandID: "b"}}})
	mustAdvance(t, w, c, time.Duration(want)*time.Millisecond)
	arrive := now + want
	if s.IslandID != "" || s.StopIndex != 0 || *s.Leg != (Leg{"c", "a", arrive, arrive + TravelMs(30, 40, 0, 0, 1000, 60_000)}) {
		t.Fatalf("no matching stop: %+v %+v", s, s.Leg)
	}
}

func TestScrapShip(t *testing.T) {
	c := catalogue(t)
	w, s := routeWorld(t, c)
	// Fill island b up to 10 planks below its capacity.
	if err := AddStock(w, c, "b", "planks", 290_000-w.Island("b").Inventory.Stock["planks"], nil); err != nil {
		t.Fatal(err)
	}
	setCargo(s, 50_000, map[string]Qty{"planks": 20_000})
	l := NewLedger()
	if err := ApplyWithLedger(w, c, ScrapShip{ShipID: s.ID}, l); err != nil {
		t.Fatal(err)
	}
	// 10 planks fit, 10 are lost; the refund (half the sloop's planks and
	// sails) has no planks room left; sails fit.
	sloop := c.ShipByID["sloop"].Cost
	rp, rs := refundAmount(material(sloop, "planks")), refundAmount(material(sloop, "sails"))
	f := l.Flow("b", "planks")
	if len(w.Ships) != 0 || w.Island("b").Inventory.Stock["planks"] != 300_000 || w.Island("b").Inventory.Stock["sails"] != rs ||
		f.Unloaded != 20_000*SubPerMilli || f.Lost != (10_000+rp)*SubPerMilli || f.Refunded != rp*SubPerMilli {
		t.Errorf("scrap: ships %d stock %v flow %+v", len(w.Ships), w.Island("b").Inventory.Stock, f)
	}
	expectErr(t, w, c, ScrapShip{ShipID: s.ID}, ErrShipNotFound)
}

// withUpkeep returns a copy of the catalogue with changed building upkeeps
// (milli-gold per minute).
func withUpkeep(base *content.Catalogue, upkeep map[string]Qty) *content.Catalogue {
	c := *base
	c.BuildingByID = maps.Clone(base.BuildingByID)
	for id, up := range upkeep {
		b := *base.BuildingByID[id]
		b.UpkeepPerMin = up
		c.BuildingByID[id] = &b
	}
	return &c
}

// TestShipInsolvency: ships are step-4 candidates (after intermediate,
// before food); a ship on a leg finishes it and anchors on arrival without
// unloading; resumes come in reverse order and a route ship handles its
// stop and departs on resume with its cargo intact.
func TestShipInsolvency(t *testing.T) {
	c := withUpkeep(catalogue(t), map[string]Qty{"warehouse": 0, "shipyard": 0})
	w, s := routeWorld(t, c)
	mustApply(t, w, c, PlaceBuilding{IslandID: "a", Type: "sawmill", X: 12, Y: 3})
	mustApply(t, w, c, PlaceBuilding{IslandID: "a", Type: "fisher", X: 14, Y: 1})
	if err := GrantWorkforce(w, c, "a", "settlers", 100_000); err != nil {
		t.Fatal(err)
	}
	if err := AddStock(w, c, "b", "fish", 40_000, nil); err != nil {
		t.Fatal(err)
	}
	mustApply(t, w, c, CreateRoute{Stops: []Stop{{IslandID: "b", Load: []LoadRule{{"fish", 40_000}}}, {IslandID: "a"}}})
	mustApply(t, w, c, AssignShip{ShipID: s.ID, RouteID: 1})
	w.Gold, w.GoldSub = 0, 0
	bs := mustAdvance(t, w, c, time.Millisecond)
	var order []string
	for _, b := range bs {
		if b.Kind == BoundaryAutoPause {
			if b.ShipID != 0 {
				order = append(order, "ship")
			} else {
				order = append(order, w.Island(b.IslandID).Building(b.BuildingID).Type)
			}
		}
	}
	if strings.Join(order, ",") != "sawmill,ship,fisher" {
		t.Fatalf("pause order %v", order)
	}
	if !s.Paused || s.State != ShipOnRoute || s.Leg == nil || s.PausedReason != PausedReasonUnpaid {
		t.Fatalf("paused ship %+v", s)
	}
	// It finishes its leg and anchors at a without unloading.
	mustAdvance(t, w, c, 30*time.Second)
	if s.State != ShipAnchoredUnpaid || s.IslandID != "a" || s.Leg != nil || cargoAmounts(s)["fish"] != 40_000 || w.Island("a").Inventory.Stock["fish"] != 0 {
		t.Fatalf("anchored: %+v cargo %v", s, s.Cargo)
	}
	ds := display(t, w, c)
	if ds.Ships[0].UpkeepPerMin != 0 || ds.Ships[0].State != ShipAnchoredUnpaid || !ds.Ships[0].Paused || ds.UpkeepRatePerMin != 0 {
		t.Errorf("ship display %+v upkeep %d", ds.Ships[0], ds.UpkeepRatePerMin)
	}
	// Taxes: ten connected houses with fish and garments.
	for x := 1; x <= 19; x += 2 {
		if err := PlaceFree(w, c, PlaceBuilding{IslandID: "a", Type: "house_settlers", X: x, Y: 6}, nil); err != nil {
			t.Fatal(err)
		}
	}
	for _, b := range w.Islands[0].Buildings {
		if b.House != nil {
			b.House.Residents = 8_000
		}
	}
	for good, qty := range map[string]Qty{"fish": 50_000, "wool_garments": 50_000} {
		if err := AddStock(w, c, "a", good, qty, nil); err != nil {
			t.Fatal(err)
		}
	}
	var resumes []string
	var shipResume int64
	for _, b := range mustAdvance(t, w, c, 20*time.Minute) {
		if b.Kind != BoundaryAutoResume {
			continue
		}
		if b.ShipID != 0 {
			resumes = append(resumes, "ship")
			shipResume = b.At.UnixMilli()
			continue
		}
		resumes = append(resumes, w.Island(b.IslandID).Building(b.BuildingID).Type)
	}
	if strings.Join(resumes, ",") != "fisher,ship,sawmill" {
		t.Fatalf("resume order %v", resumes)
	}
	// Resumed at a (stop 1, no unload rule): the cargo is intact, the ship
	// departed for b after the handling time and keeps sailing.
	if s.Paused || s.State != ShipOnRoute || s.RouteID != 1 {
		t.Fatalf("resumed ship %+v", s)
	}
	if shipResume == 0 || w.Island("a").Inventory.Stock["fish"] > 50_000 {
		t.Errorf("resume at %d, fish at a %d", shipResume, w.Island("a").Inventory.Stock["fish"])
	}
}

// TestDueEventComposition (MECHANICS §13 last invariant): applying a due
// event at its due time and advancing equals advancing straight through,
// and split points at, before and after due moments compose exactly.
func TestDueEventComposition(t *testing.T) {
	c := catalogue(t)
	w, s := routeWorld(t, c)
	if err := AddStock(w, c, "b", "fish", 80_000, nil); err != nil {
		t.Fatal(err)
	}
	mustApply(t, w, c, CreateRoute{Stops: []Stop{
		{IslandID: "a", Load: []LoadRule{{"wood", 60_000}}, Unload: []string{"fish"}},
		{IslandID: "b", Load: []LoadRule{{"fish", 30_000}}, Unload: []string{"wood"}},
	}})
	mustApply(t, w, c, AssignShip{ShipID: s.ID, RouteID: 1})
	mustApply(t, w, c, OrderShip{IslandID: "a", BuildingID: 2, ShipType: "sloop"})
	end := w.LastEvaluatedAt.Add(10 * time.Minute)
	straight := w.Clone()
	if _, err := Advance(straight, c, end); err != nil {
		t.Fatal(err)
	}
	want := encode(t, straight)

	events := DueEvents(w)
	if len(events) != 2 {
		t.Fatalf("due = %+v", events)
	}
	for _, ev := range events {
		for _, off := range []time.Duration{-time.Millisecond, 0, time.Millisecond} {
			cw := w.Clone()
			if _, err := Advance(cw, c, ev.At.Add(off)); err != nil {
				t.Fatal(err)
			}
			if off == 0 {
				if applied, err := ApplyDueEvent(cw, c, ev); err != nil || applied {
					t.Fatalf("ApplyDueEvent after Advance: %v %v (want a no-op)", applied, err)
				}
				for _, d := range DueEvents(cw) {
					if !d.At.After(ev.At) {
						t.Fatalf("due moment %+v not after %s", d, ev.At)
					}
				}
			}
			if _, err := Advance(cw, c, end); err != nil {
				t.Fatal(err)
			}
			if got := encode(t, cw); !bytes.Equal(got, want) {
				t.Fatalf("split at %s%+v differs", ev.Kind, off)
			}
		}
	}
	// ApplyDueEvent on a world evaluated exactly at the due time whose
	// effect is still pending applies it once.
	ev := events[0]
	cw := w.Clone()
	if _, err := Advance(cw, c, ev.At.Add(-time.Millisecond)); err != nil {
		t.Fatal(err)
	}
	cw.LastEvaluatedAt = ev.At // state frozen just before the due moment
	if applied, err := ApplyDueEvent(cw, c, ev); err != nil || !applied {
		t.Fatalf("ApplyDueEvent: %v %v", applied, err)
	}
	if applied, _ := ApplyDueEvent(cw, c, ev); applied {
		t.Fatal("applied twice")
	}
	if _, err := ApplyDueEvent(cw, c, DueEvent{Kind: ev.Kind, At: ev.At.Add(time.Second)}); !errors.Is(err, ErrInvalidCommand) {
		t.Fatalf("wrong time: %v", err)
	}
}
