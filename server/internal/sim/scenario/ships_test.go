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

// TestShipBuilt checks scenario (n): the cog appears idle at the start
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
	if before.BalanceRatePerMin-at.BalanceRatePerMin != loadCatalogue(t).ShipByID["cog"].UpkeepPerMin {
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
	// The snapshots end with: 1 ms before the arrival, the arrival, the
	// end of unloading at the berth.
	before := rep.Snapshots[len(rep.Snapshots)-3]
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
	if len(ds.Routes) != 1 || ds.Routes[0].LoopMs != 161_623 || !slices.Equal(ds.Routes[0].ShipIDs, []int64{1}) {
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
		case r.c.BuildingByID[firstTradingPostType(r.c)]:
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
	if f := r.l.Flow("island2", "planks"); f.Spent != (planks("trading_post")+2*planks("house_settlers")+planks("fisher"))*sim.SubPerMilli {
		t.Errorf("planks spent %d", f.Spent)
	}
}

// TestShipInsolvencyScenario checks scenario (r): the ship is paused at
// step 3 of the cascade (after the wood chain; the weaver, the fisher and
// the weaver's sheep farm are guarded, D-075 §5) and keeps its cargo;
// gold is held at zero (D-008). After the player demolishes the sheep
// farm the weaver uses up the wool in stock, its input is cut off and it
// loses its guard: the cascade pauses it, the balance turns positive and
// gold grows. The resume queue skips the weaver (cut off), so the cog
// gets the trial resume with identical cargo; the player sails it home
// and its cargo is unloaded into the start island's stock.
func TestShipInsolvencyScenario(t *testing.T) {
	rep := runScenario(t, "ship_insolvency")
	var pauses, resumes []string
	for _, e := range rep.PauseEvents {
		if e.Action == "auto_pause" {
			pauses = append(pauses, e.Type)
		} else {
			resumes = append(resumes, e.Type)
			if e.Type == "cog" && !e.Trial {
				t.Errorf("cog resumed at %s without a trial", e.At)
			}
		}
	}
	if want := "lumberjack,sawmill,cog,weaver_wool"; strings.Join(pauses, ",") != want {
		t.Fatalf("pauses %v, want %s", pauses, want)
	}
	if want := "cog"; strings.Join(resumes, ",") != want {
		t.Fatalf("resumes %v, want %s (the weaver is cut off)", resumes, want)
	}
	weaverAt, resumeAt := rep.PauseEvents[3].At, rep.PauseEvents[4].At
	var paused *ShipSnapshot
	var resumed, home *Snapshot
	for i := range rep.Snapshots {
		s := &rep.Snapshots[i]
		for j := range s.Ships {
			if sh := &s.Ships[j]; sh.Paused && paused == nil {
				paused = sh
			}
		}
		// Held at zero from the cascade until the weaver's pause, growing
		// afterwards until the trial.
		switch {
		case paused != nil && s.At < weaverAt && (s.Gold != 0 || s.BalanceRatePerMin >= 0):
			t.Errorf("%s: gold %d balance %d, want held at zero", s.At, s.Gold, s.BalanceRatePerMin)
		case s.At > weaverAt && s.At < resumeAt && (s.Gold <= 0 || s.BalanceRatePerMin <= 0):
			t.Errorf("%s: gold %d balance %d, want gold growing", s.At, s.Gold, s.BalanceRatePerMin)
		}
		if s.At > resumeAt && resumed == nil {
			resumed = s
		}
		if len(s.Ships) > 0 && s.Ships[0].IslandID == "start" && s.At > resumeAt {
			home = s
		}
	}
	if paused == nil || paused.State != sim.ShipAnchoredUnpaid || paused.IslandID != "island2" {
		t.Fatalf("paused %+v", paused)
	}
	if resumed == nil || home == nil {
		t.Fatalf("no snapshot after the resume (%v) or at home (%v)", resumed != nil, home != nil)
	}
	// Resumed idle at island 2 with the cargo it was paused with.
	ship := resumed.Ships[0]
	if ship.Paused || ship.State != sim.ShipIdle || ship.IslandID != "island2" || len(ship.Cargo) != len(paused.Cargo) {
		t.Fatalf("resumed ship %+v", ship)
	}
	for g, a := range paused.Cargo {
		if ship.Cargo[g] != a || a != 50_000 {
			t.Errorf("cargo %s %d after the resume, %d when paused", g, ship.Cargo[g], a)
		}
	}
	// Sailed home: the cargo is in the start island's stock.
	if sh := home.Ships[0]; sh.Paused || len(sh.Cargo) != 0 {
		t.Errorf("ship at home %+v", sh)
	}
	for g, a := range paused.Cargo {
		if got := home.Inventory["start"][g].Stock - resumed.Inventory["start"][g].Stock; got != a {
			t.Errorf("%s unloaded at home: %d, want %d", g, got, a)
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
