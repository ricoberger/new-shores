package scenario

import (
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/ricoberger/new-shores/server/internal/sim"
)

func islandDisplay(t *testing.T, ds sim.DisplayState, id string) sim.IslandDisplay {
	t.Helper()
	for _, is := range ds.Islands {
		if is.ID == id {
			return is
		}
	}
	t.Fatalf("no island %s", id)
	return sim.IslandDisplay{}
}

// TestShipBuilt checks scenario (n): the sloop appears idle at the start
// island exactly at the order's due time, not a millisecond earlier.
func TestShipBuilt(t *testing.T) {
	rep := runScenario(t, "ship_built")
	before, at := rep.Snapshots[0], rep.Snapshots[1]
	if len(before.Ships) != 0 || before.At != "2026-01-01T00:01:59.999Z" {
		t.Errorf("before: %+v at %s", before.Ships, before.At)
	}
	if at.At != "2026-01-01T00:02:00.000Z" || at.Boundaries != 1 || len(at.Ships) != 1 || at.Ships[0].State != sim.ShipIdle || at.Ships[0].IslandID != "start" {
		t.Errorf("at due time: %+v", at)
	}
	// Upkeep of the ship counts from the build.
	if before.BalanceRatePerMin-at.BalanceRatePerMin != loadCatalogue(t).ShipByID["sloop"].UpkeepPerMin {
		t.Errorf("balance %d -> %d", before.BalanceRatePerMin, at.BalanceRatePerMin)
	}
	if g := rep.Totals["start"]["sails"]; g.Spent != 10_000 {
		t.Errorf("sails %+v", g)
	}
}

// TestManualShipmentExcess checks scenario (o): the cargo remaining aboard
// equals the capacity excess at island 2.
func TestManualShipmentExcess(t *testing.T) {
	rep := runScenario(t, "manual_shipment_excess")
	before := rep.Snapshots[len(rep.Snapshots)-2]
	inv := before.Inventory["island2"]
	free := map[string]int64{"planks": 300_000 - inv["planks"].Stock, "wood": 300_000 - inv["wood"].Stock}
	sh := rep.Final.Ships[0]
	if sh.State != sim.ShipIdle || sh.IslandID != "island2" || sh.Leg != nil {
		t.Fatalf("ship %+v", sh)
	}
	aboard := map[string]int64{}
	for _, sl := range sh.Cargo {
		aboard[sl.Good] += sl.Amount
	}
	for good, shipped := range map[string]int64{"planks": 50_000, "wood": 50_000} {
		if aboard[good] != shipped-free[good] || aboard[good] <= 0 {
			t.Errorf("%s aboard %d, want %d shipped - %d free", good, aboard[good], shipped, free[good])
		}
		if g := islandDisplay(t, rep.Final, "island2").Inventory[good]; g.Stock != g.Capacity {
			t.Errorf("%s at island 2 = %+v, want capacity", good, g)
		}
	}
}

// TestRouteLoop checks scenario (p): the loop time, three loops and exact
// conservation over both islands plus the cargo aboard (sub-milli ledger).
func TestRouteLoop(t *testing.T) {
	r := stepRunner(t, "route_loop")
	r.runSteps(t, 0, len(r.s.Steps))
	ds := r.mustDisplay(t)
	if len(ds.Routes) != 1 || ds.Routes[0].LoopMs != 160_000 || !slices.Equal(ds.Routes[0].ShipIDs, []int64{1}) {
		t.Fatalf("routes %+v", ds.Routes)
	}
	now := r.w.LastEvaluatedAt.UnixMilli()
	for _, g := range r.c.Goods {
		var islands, ledger int64
		for _, is := range r.w.Islands {
			stock := sim.FineStock(is, g.ID, now)
			f := r.l.Flow(is.ID, g.ID)
			islands += stock
			ledger += f.Produced - f.Consumed - f.Lost - f.Spent + f.Refunded + f.Granted
			if want := f.Produced - f.Consumed - f.Lost - f.Spent + f.Refunded + f.Granted - f.Loaded + f.Unloaded; stock != want {
				t.Errorf("%s on %s: %d, ledger %d", g.ID, is.ID, stock, want)
			}
		}
		var cargo int64
		for _, s := range r.w.Ships {
			for _, sl := range s.Cargo {
				if sl.Good == g.ID {
					cargo += sl.Amount * sim.SubPerMilli
				}
			}
		}
		if islands+cargo != ledger {
			t.Errorf("%s: islands %d + cargo %d != ledger %d", g.ID, islands, cargo, ledger)
		}
	}
	rep := runScenario(t, "route_loop")
	loops := rep.Snapshots[len(rep.Snapshots)-3:]
	for i, s := range loops {
		if len(s.Ships) != 1 || s.Ships[0].State != sim.ShipOnRoute || s.Ships[0].IslandID != "island2" || s.Boundaries != 2 {
			t.Errorf("loop %d: %+v", i+1, s)
		}
	}
	if t2 := rep.Totals["island2"]["wood"]; t2.Unloaded == 0 || rep.Totals["start"]["planks"].Unloaded == 0 {
		t.Errorf("nothing carried: %+v", rep.Totals)
	}
}

// TestFoundIsland checks scenario (q): island 2 is settled from the ship's
// cargo and its fisher is connected to the new warehouse and produces.
func TestFoundIsland(t *testing.T) {
	r := stepRunner(t, "found_island")
	r.runSteps(t, 0, len(r.s.Steps))
	is := r.w.Island("island2")
	var wh, fisher *sim.Building
	for _, b := range is.Buildings {
		switch r.c.BuildingByID[b.Type] {
		case r.c.BuildingByID[firstWarehouseType(r.c)]:
			wh = b
		default:
			if r.c.BuildingByID[b.Type].Recipe != nil {
				fisher = b
			}
		}
	}
	if wh == nil || fisher == nil || fisher.AssignedWarehouseID != wh.ID {
		t.Fatalf("warehouse %+v producer %+v", wh, fisher)
	}
	ds := r.mustDisplay(t)
	i2 := islandDisplay(t, ds, "island2")
	if !i2.Settled || i2.Name != "Island 2" || i2.Inventory["fish"].Stock <= 0 {
		t.Errorf("island 2: %+v", i2)
	}
	planks := func(id string) int64 {
		for _, m := range r.c.BuildingByID[id].Cost.Materials {
			if m.Good == "planks" {
				return m.Amount
			}
		}
		return 0
	}
	// Warehouse from the cargo, two houses and the fisher.
	if f := r.l.Flow("island2", "planks"); f.Spent != (planks("warehouse")+2*planks("house_settlers")+planks("fisher"))*sim.SubPerMilli {
		t.Errorf("planks spent %d", f.Spent)
	}
}

// TestShipInsolvencyScenario checks scenario (r): the ship is paused at
// step 4 (after the intermediate chain, before tier-1 food) and resumed
// with identical cargo.
func TestShipInsolvencyScenario(t *testing.T) {
	rep := runScenario(t, "ship_insolvency")
	var pauses []string
	for _, e := range rep.PauseEvents {
		if e.Action == "auto_pause" {
			pauses = append(pauses, e.Type)
		}
	}
	if want := "weaver_wool,lumberjack,sawmill,sheep_farm,sloop,fisher"; strings.Join(pauses, ",") != want {
		t.Fatalf("pauses %v, want %s", pauses, want)
	}
	var paused *ShipSnapshot
	for i := range rep.Snapshots {
		for j := range rep.Snapshots[i].Ships {
			if s := &rep.Snapshots[i].Ships[j]; s.Paused && paused == nil {
				paused = s
			}
		}
	}
	resumed := false
	for _, e := range rep.PauseEvents {
		resumed = resumed || (e.Action == "auto_resume" && e.ShipID == 1)
	}
	if paused == nil || paused.State != sim.ShipAnchoredUnpaid || paused.IslandID != "island2" || !resumed {
		t.Fatalf("paused %+v, resumed %v", paused, resumed)
	}
	final := rep.Final.Ships[0]
	cargo := map[string]int64{}
	for _, sl := range final.Cargo {
		cargo[sl.Good] += sl.Amount
	}
	if final.Paused || final.State != sim.ShipIdle || len(cargo) != len(paused.Cargo) {
		t.Fatalf("final ship %+v", final)
	}
	for g, a := range paused.Cargo {
		if cargo[g] != a || a != 50_000 {
			t.Errorf("cargo %s %d after resume, %d while paused", g, cargo[g], a)
		}
	}
	checkGoldNonNegative(t, rep)
}

// TestOffline12hRoute checks scenario (s): one 12-hour Advance with a
// running route ends with the stocks at their caps and a consistent ship;
// it records the boundary count and the Advance wall time (budget 50 ms
// as for the other 12-hour scenarios; the target is < 5 ms).
func TestOffline12hRoute(t *testing.T) {
	r := stepRunner(t, "offline_12h_route")
	r.runSteps(t, 0, len(r.s.Steps))
	ds := r.mustDisplay(t)
	for island, goods := range map[string][]string{"start": {"wood", "planks", "fish"}, "island2": {"planks", "fish"}} {
		inv := islandDisplay(t, ds, island).Inventory
		for _, g := range goods {
			if v := inv[g]; v.Stock+v.InTransit != v.Capacity {
				t.Errorf("%s/%s = %+v, want at capacity", island, g, v)
			}
		}
	}
	s := r.w.Ships[0]
	if s.State != sim.ShipOnRoute || s.Leg == nil || s.Paused || len(sim.DueEvents(r.w)) != 1 {
		t.Errorf("ship %+v", s)
	}
	best, rep := bestAdvance(t, loadScenario(t, "offline_12h_route"))
	last := rep.Snapshots[len(rep.Snapshots)-1]
	t.Logf("12h with a running route: best of 3 = %s, boundaries in the 12h advance = %d (scenario total %d)", best, last.Boundaries, rep.BoundaryCount)
	if best >= 50*time.Millisecond || last.Boundaries >= 10_000 {
		t.Errorf("12h advance took %s with %d boundaries, budget 50ms", best, last.Boundaries)
	}
}
