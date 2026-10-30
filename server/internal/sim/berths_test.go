package sim

import (
	"slices"
	"testing"
	"time"
)

// berthWorld is shipWorld (island "a" settled with a level-1 Trading Post,
// one berth; "b" unsettled at (6, 8)) plus two ships at sea west of "a"'s
// harbour (3, -1) carrying planks: ship 1 at (-9, -1) with 20 planks,
// ship 2 at (-10, -1) with 50 planks. Both sail to "a" at t0: ship 1
// arrives after 12 s, ship 2 after 13 s.
func berthWorld(t *testing.T) (*World, *Ship, *Ship) {
	t.Helper()
	c := catalogue(t)
	w := shipWorld(t, c)
	s1, err := LaunchShipAtSea(w, c, "sloop", Pos{X: -9, Y: -1}, map[string]Qty{"planks": 20_000})
	if err != nil {
		t.Fatal(err)
	}
	s2, err := LaunchShipAtSea(w, c, "sloop", Pos{X: -10, Y: -1}, map[string]Qty{"planks": 50_000})
	if err != nil {
		t.Fatal(err)
	}
	mustApply(t, w, c, SailShip{ShipID: s1.ID, ToIslandID: "a"})
	mustApply(t, w, c, SailShip{ShipID: s2.ID, ToIslandID: "a"})
	return w, s1, s2
}

// TestBerthQueueTwoShipsOneBerth (MECHANICS §9.3): the first arrival takes
// the only berth and unloads at once (10 s + 0.2 s per unit); the second
// waits (waiting_for_berth, its arrival effects deferred) and is granted
// the berth as its next due moment when the first releases it.
func TestBerthQueueTwoShipsOneBerth(t *testing.T) {
	c := catalogue(t)
	w, s1, s2 := berthWorld(t)
	start := w.LastEvaluatedAt.UnixMilli()
	planks := w.Island("a").Inventory.Stock["planks"]

	mustAdvance(t, w, c, 13*time.Second)
	// Ship 1 arrived at 12 s and holds the berth for 10 s + 20 x 0.2 s.
	if s1.State != ShipManualLeg || s1.BerthUntilMs != start+12_000+14_000 || len(s1.Cargo) != 0 {
		t.Fatalf("ship 1 = %+v", s1)
	}
	// Ship 2 arrived at 13 s and waits with its cargo aboard.
	if s2.State != ShipWaitingForBerth || s2.IslandID != "a" || s2.QueuedAtMs != start+13_000 || len(s2.Cargo) != 1 {
		t.Fatalf("ship 2 = %+v", s2)
	}
	if got := w.Island("a").Inventory.Stock["planks"]; got != planks+20_000 {
		t.Fatalf("planks %d, want only ship 1's unloaded", got)
	}
	// The grant is ship 2's due moment.
	if ev := DueEvents(w); len(ev) != 1 || ev[0].Kind != DueShipArrived || ev[0].ShipID != s2.ID || ev[0].At.UnixMilli() != start+26_000 {
		t.Fatalf("due = %+v", ev)
	}
	ds := display(t, w, c)
	tp := buildingDisplay(t, ds, 1)
	if tp.Berths == nil || tp.Berths.Total != 1 || tp.Berths.Busy != 1 || !slices.Equal(tp.Berths.Ships, []int64{s1.ID}) || !slices.Equal(tp.Berths.Queue, []int64{s2.ID}) {
		t.Fatalf("berths = %+v", tp.Berths)
	}
	for _, sd := range ds.Ships {
		switch sd.ID {
		case s1.ID:
			if sd.BerthUntil == nil || *sd.BerthUntil != formatMs(start+26_000) || sd.QueuedAt != nil {
				t.Errorf("ship 1 display %+v", sd)
			}
		case s2.ID:
			if sd.State != ShipWaitingForBerth || sd.QueuedAt == nil || *sd.QueuedAt != formatMs(start+13_000) || sd.BerthUntil != nil {
				t.Errorf("ship 2 display %+v", sd)
			}
		}
	}

	// At 26 s ship 1 is done (idle) and ship 2 unloads its 50 planks:
	// 10 s + 50 x 0.2 s = 20 s.
	mustAdvance(t, w, c, 13*time.Second)
	if s1.State != ShipIdle || s1.BerthUntilMs != 0 {
		t.Fatalf("ship 1 after unloading = %+v", s1)
	}
	if s2.State != ShipManualLeg || s2.QueuedAtMs != 0 || s2.BerthUntilMs != start+26_000+20_000 || len(s2.Cargo) != 0 ||
		w.Island("a").Inventory.Stock["planks"] != planks+70_000 {
		t.Fatalf("ship 2 at its berth = %+v", s2)
	}
	mustAdvance(t, w, c, 20*time.Second)
	if s2.State != ShipIdle || len(DueEvents(w)) != 0 {
		t.Fatalf("ship 2 after unloading = %+v due %+v", s2, DueEvents(w))
	}
}

// TestBerthQueueComposes: the berth timeline is the same whether the world
// is advanced in one step or split at the arrivals, the grant and the
// releases (and one millisecond around them).
func TestBerthQueueComposes(t *testing.T) {
	c := catalogue(t)
	whole, _, _ := berthWorld(t)
	base := whole.LastEvaluatedAt
	mustAdvance(t, whole, c, time.Minute)
	split, _, _ := berthWorld(t)
	for _, ms := range []int64{11_999, 12_000, 12_999, 13_000, 25_999, 26_000, 26_001, 45_999, 46_000, 60_000} {
		if _, err := Advance(split, c, base.Add(time.Duration(ms)*time.Millisecond)); err != nil {
			t.Fatal(err)
		}
	}
	if string(encode(t, whole)) != string(encode(t, split)) {
		t.Fatal("split advancement differs")
	}
}

// TestBerthFIFOAndUpgrade: ships queued at the same millisecond are
// granted by ship ID; an upgrade to a level with two berths grants the
// waiting ship at once (the command applies the due moment it creates).
func TestBerthFIFOAndUpgrade(t *testing.T) {
	c := catalogue(t)
	w := shipWorld(t, c)
	var ships []*Ship
	for range 3 {
		s, err := LaunchShipAtSea(w, c, "sloop", Pos{X: -7, Y: -1}, map[string]Qty{"planks": 10_000})
		if err != nil {
			t.Fatal(err)
		}
		ships = append(ships, s)
	}
	// Same position: all three arrive at the same millisecond.
	for i := len(ships) - 1; i >= 0; i-- {
		mustApply(t, w, c, SailShip{ShipID: ships[i].ID, ToIslandID: "a"})
	}
	mustAdvance(t, w, c, 10*time.Second)
	if ships[0].State != ShipManualLeg || ships[1].State != ShipWaitingForBerth || ships[2].State != ShipWaitingForBerth {
		t.Fatalf("states %s %s %s", ships[0].State, ships[1].State, ships[2].State)
	}
	if q := berthQueue(w, "a"); len(q) != 2 || q[0] != ships[1] || q[1] != ships[2] {
		t.Fatalf("queue %+v", q)
	}
	if err := AddStock(w, c, "a", "stone", 10_000, nil); err != nil {
		t.Fatal(err)
	}
	now := w.LastEvaluatedAt.UnixMilli()
	mustApply(t, w, c, UpgradeTradingPost{IslandID: "a", BuildingID: 1})
	if ships[1].State != ShipManualLeg || ships[1].BerthUntilMs != now+12_000 || ships[2].State != ShipWaitingForBerth {
		t.Fatalf("after the upgrade: %+v %+v", ships[1], ships[2])
	}
	if b := buildingDisplay(t, display(t, w, c), 1).Berths; b.Total != 2 || b.Busy != 2 || len(b.Queue) != 1 {
		t.Fatalf("berths %+v", b)
	}
}

// TestBerthRules: a paused ship is not granted a berth (it anchors and
// keeps its cargo); an island without a Trading Post has no pier, so a
// ship arriving there handles at once without a berth.
func TestBerthRules(t *testing.T) {
	c := catalogue(t)
	t.Run("paused at the grant", func(t *testing.T) {
		w, s1, s2 := berthWorld(t)
		mustAdvance(t, w, c, 13*time.Second)
		now := w.LastEvaluatedAt.UnixMilli()
		pauseShip(s2, 1, now)
		grantBerth(w, c, s2, now, nil)
		if s2.State != ShipAnchoredUnpaid || s2.BerthUntilMs != 0 || s2.QueuedAtMs != 0 || len(s2.Cargo) != 1 || len(berthQueue(w, "a")) != 0 {
			t.Fatalf("paused ship at its grant = %+v", s2)
		}
		if s1.State != ShipManualLeg {
			t.Fatalf("ship 1 = %+v", s1)
		}
	})
	t.Run("no pier at an unsettled island", func(t *testing.T) {
		w := shipWorld(t, c)
		s, err := LaunchShipAtSea(w, c, "sloop", Pos{X: 6, Y: 18}, map[string]Qty{"planks": 30_000})
		if err != nil {
			t.Fatal(err)
		}
		mustApply(t, w, c, SailShip{ShipID: s.ID, ToIslandID: "b"})
		mustAdvance(t, w, c, 10*time.Second)
		if s.State != ShipIdle || s.IslandID != "b" || s.BerthUntilMs != 0 || cargoAmounts(s)["planks"] != 30_000 {
			t.Fatalf("ship at b = %+v", s)
		}
	})
}

// TestStartAtSeaFounding (D-051): the start ship at sea sails to an
// unsettled island (no pier: idle there at once with its cargo), founds it
// with a Trading Post from its cargo and unloads the rest; sail_ship
// errors leave the world unchanged.
func TestStartAtSeaFounding(t *testing.T) {
	c := catalogue(t)
	w := shipWorld(t, c)
	s, err := LaunchShipAtSea(w, c, "sloop", Pos{X: 6, Y: 20}, map[string]Qty{"planks": 150_000, "sails": 10_000})
	if err != nil {
		t.Fatal(err)
	}
	// The founding cargo is exempt from the slot limit (D-056).
	if big, err := LaunchShipAtSea(w, c, "sloop", Pos{}, map[string]Qty{"planks": 250_000}); err != nil || len(big.Cargo) != 5 {
		t.Errorf("five slots of founding cargo on a 4-slot sloop: %v", err)
	}
	w.Ships, w.NextShipID = w.Ships[:1], 2
	expectErr(t, w, c, FoundIsland{ShipID: s.ID, IslandID: "b", BuildingType: "trading_post", X: 1, Y: 0}, ErrShipNotIdle)
	expectErr(t, w, c, SailShip{ShipID: s.ID, ToIslandID: "x"}, ErrRouteInvalid)
	expectErr(t, w, c, SailShip{ShipID: 99, ToIslandID: "b"}, ErrShipNotFound)
	expectErr(t, w, c, ManualShipment{ShipID: s.ID, ToIslandID: "b", Cargo: []CargoAmount{{"planks", 1000}}}, ErrShipNotIdle)
	start := w.LastEvaluatedAt.UnixMilli()
	mustApply(t, w, c, SailShip{ShipID: s.ID, ToIslandID: "b"})
	// To b's shore nearest the ship (no Trading Post there): (7, 14), in open water.
	travel := TravelMs(6, 20, 7, 14, 1000, c.Region.Rules.ShipSpeedMilliTilesPerMin)
	if s.State != ShipManualLeg || s.AtSea != nil || s.Leg == nil || s.Leg.From == nil || *s.Leg.From != (Pos{6, 20}) ||
		s.Leg.FromIsland != "" || s.Leg.DepartAtMs != start || s.Leg.ArriveAtMs != start+travel || !slices.Equal(s.Leg.Path, []Pos{{6, 20}, {7, 14}}) {
		t.Fatalf("sailing = %+v leg %+v", s, s.Leg)
	}
	if ds := display(t, w, c); ds.Ships[0].Leg == nil || ds.Ships[0].Leg.FromPosition == nil || *ds.Ships[0].Leg.FromPosition != (PositionDisplay{6, 20}) {
		t.Fatalf("leg display = %+v", ds.Ships[0].Leg)
	}
	expectErr(t, w, c, SailShip{ShipID: s.ID, ToIslandID: "a"}, ErrShipNotIdle)
	mustAdvance(t, w, c, time.Duration(travel)*time.Millisecond)
	if s.State != ShipIdle || s.IslandID != "b" || cargoAmounts(s)["planks"] != 150_000 {
		t.Fatalf("arrived = %+v", s)
	}
	expectErr(t, w, c, SailShip{ShipID: s.ID, ToIslandID: "b"}, ErrRouteInvalid)
	gold := w.Gold
	mustApply(t, w, c, FoundIsland{ShipID: s.ID, IslandID: "b", BuildingType: "trading_post", X: 1, Y: 0})
	b := w.Island("b")
	tp := c.BuildingByID["trading_post"]
	if !settled(b, c) || w.Gold != gold-tp.Cost.Gold || b.Inventory.Stock["planks"] != 150_000-material(tp.Cost, "planks") ||
		b.Inventory.Stock["sails"] != 10_000 || len(s.Cargo) != 0 || s.State != ShipIdle {
		t.Fatalf("founded: gold %d stock %v ship %+v", w.Gold, b.Inventory.Stock, s)
	}
	// A second Trading Post on a settled island is never placed.
	expectErr(t, w, c, PlaceBuilding{IslandID: "b", Type: "trading_post", X: 6, Y: 0}, ErrIslandAlreadySettled)
	expectErr(t, w, c, PlaceBuilding{IslandID: "b", Type: "trading_post", X: 6, Y: 0, Rotation: 90}, ErrIslandAlreadySettled)
}

// TestIdleShipOffshorePosition: a ship idle at an island without berths
// keeps the end of the leg that brought it as its position (display), also
// after an envelope round trip, and loses it when it departs or the island
// gets its Trading Post.
func TestIdleShipOffshorePosition(t *testing.T) {
	c := catalogue(t)
	w := shipWorld(t, c)
	s, err := LaunchShipAtSea(w, c, "sloop", Pos{X: 6, Y: 20}, map[string]Qty{"planks": 150_000, "sails": 10_000})
	if err != nil {
		t.Fatal(err)
	}
	pos := func(w *World) *PositionDisplay { return display(t, w, c).Ships[0].Position }
	if p := pos(w); p == nil || *p != (PositionDisplay{6, 20}) {
		t.Fatalf("at sea position = %v", p)
	}
	mustApply(t, w, c, SailShip{ShipID: s.ID, ToIslandID: "b"})
	if pos(w) != nil {
		t.Fatalf("position on a leg = %v", pos(w))
	}
	end := s.Leg.Path[len(s.Leg.Path)-1]
	mustAdvance(t, w, c, time.Hour)
	if s.State != ShipIdle || s.IslandID != "b" || s.Offshore == nil || *s.Offshore != end {
		t.Fatalf("arrived = %+v end %v", s, end)
	}
	if p := pos(w); p == nil || *p != (PositionDisplay(end)) || display(t, w, c).Ships[0].IslandID != "b" {
		t.Fatalf("idle position = %v", p)
	}
	w2, _, _, err := Decode(encode(t, w), nil)
	if err != nil {
		t.Fatal(err)
	}
	if p := pos(w2); p == nil || *p != (PositionDisplay(end)) {
		t.Fatalf("position after reload = %v", p)
	}
	mustApply(t, w, c, FoundIsland{ShipID: s.ID, IslandID: "b", BuildingType: "trading_post", X: 1, Y: 0})
	if s.Offshore != nil || pos(w) != nil {
		t.Fatalf("position after founding = %v", pos(w))
	}
}

// TestFoundingVoyagePosition: a founding voyage ends at the harbour point of
// the pending site, which is the idle ship's position.
func TestFoundingVoyagePosition(t *testing.T) {
	c := catalogue(t)
	w := shipWorld(t, c)
	s, err := LaunchShipAtSea(w, c, "sloop", Pos{X: 6, Y: 20}, map[string]Qty{"planks": 150_000, "sails": 10_000})
	if err != nil {
		t.Fatal(err)
	}
	site := &FoundingSite{BuildingType: "trading_post", X: 1, Y: 0}
	mustApply(t, w, c, SailShip{ShipID: s.ID, ToIslandID: "b", Site: site})
	end := s.Leg.Path[len(s.Leg.Path)-1]
	mustAdvance(t, w, c, time.Hour)
	if p := display(t, w, c).Ships[0].Position; s.Offshore == nil || *s.Offshore != end || p == nil || *p != (PositionDisplay(end)) {
		t.Fatalf("position = %v offshore %v end %v", p, s.Offshore, end)
	}
}

// TestDemolishLastBerthSourceMoorsShips: when the Trading Post is
// demolished, the ships idle there keep the harbour point of the demolished
// building as their sea position (also after a reload); a departure clears it.
func TestDemolishLastBerthSourceMoorsShips(t *testing.T) {
	c := catalogue(t)
	w := shipWorld(t, c)
	s, err := LaunchShipAtSea(w, c, "sloop", Pos{X: 6, Y: 20}, map[string]Qty{"planks": 150_000, "sails": 10_000})
	if err != nil {
		t.Fatal(err)
	}
	mustApply(t, w, c, SailShip{ShipID: s.ID, ToIslandID: "b"})
	mustAdvance(t, w, c, time.Hour)
	mustApply(t, w, c, FoundIsland{ShipID: s.ID, IslandID: "b", BuildingType: "trading_post", X: 1, Y: 0})
	pos := func(w *World) *PositionDisplay { return display(t, w, c).Ships[0].Position }
	if s.State != ShipIdle || s.IslandID != "b" || s.Offshore != nil || pos(w) != nil {
		t.Fatalf("before = %+v position %v", s, pos(w))
	}
	is := w.Island("b")
	tp := is.Buildings[0]
	want := HarbourAt(is, c.BuildingByID[tp.Type], tp.X, tp.Y, tp.Rotation)
	mustApply(t, w, c, Demolish{IslandID: "b", BuildingID: tp.ID, AcceptSurplusLoss: true})
	if s.Offshore == nil || *s.Offshore != want {
		t.Fatalf("offshore = %v, want %v", s.Offshore, want)
	}
	if p := pos(w); p == nil || *p != PositionDisplay(want) || display(t, w, c).Ships[0].IslandID != "b" {
		t.Fatalf("position = %v, want %v", p, want)
	}
	w2, _, _, err := Decode(encode(t, w), nil)
	if err != nil {
		t.Fatal(err)
	}
	if p := pos(w2); p == nil || *p != PositionDisplay(want) {
		t.Fatalf("position after reload = %v", p)
	}
	// Leaving clears it.
	mustApply(t, w, c, SailShip{ShipID: s.ID, ToIslandID: "a"})
	if s.Offshore != nil || pos(w) != nil {
		t.Fatalf("position on the next leg = %v", pos(w))
	}
}
