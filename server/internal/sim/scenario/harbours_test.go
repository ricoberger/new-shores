package scenario

import (
	"bytes"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"testing"

	"github.com/ricoberger/new-shores/server/internal/sim"
)

// shipDisplay returns the display of a ship.
func shipDisplay(t *testing.T, ds sim.DisplayState, id int64) sim.ShipDisplay {
	t.Helper()
	for _, s := range ds.Ships {
		if s.ID == id {
			return s
		}
	}
	t.Fatalf("no ship %d", id)
	return sim.ShipDisplay{}
}

// tradingPostDisplay returns the Trading Post of an island.
func tradingPostDisplay(t *testing.T, is sim.IslandDisplay) sim.BuildingDisplay {
	t.Helper()
	for _, b := range is.Buildings {
		if b.Berths != nil {
			return b
		}
	}
	t.Fatalf("no trading post on %s", is.ID)
	return sim.BuildingDisplay{}
}

// TestBerthQueueScenario checks goldens berth_queue and berth_queue_served
// (MECHANICS §9.3): one berth, two arrivals; the second waits in the queue
// with its cargo aboard until the first releases the berth after its
// per-unit handling, then unloads for its own handling time.
func TestBerthQueueScenario(t *testing.T) {
	rep := runScenario(t, "berth_queue")
	for _, snap := range rep.Snapshots {
		states := map[int64]string{}
		for _, s := range snap.Ships {
			states[s.ID] = s.State
		}
		if states[1] != sim.ShipManualLeg || states[2] != sim.ShipWaitingForBerth {
			t.Errorf("%s: ship states %v, want ship 1 unloading and ship 2 waiting", snap.At, states)
		}
	}
	is := islandDisplay(t, rep.Final, "harbour")
	tp := tradingPostDisplay(t, is)
	if b := tp.Berths; b.Total != 1 || b.Busy != 1 || !slices.Equal(b.Ships, []int64{1}) || !slices.Equal(b.Queue, []int64{2}) {
		t.Errorf("berths %+v", b)
	}
	s1, s2 := shipDisplay(t, rep.Final, 1), shipDisplay(t, rep.Final, 2)
	if s1.BerthUntil == nil || *s1.BerthUntil != "2026-01-01T00:00:26.000Z" || len(s1.Cargo) != 0 {
		t.Errorf("ship 1 %+v", s1)
	}
	if s2.QueuedAt == nil || *s2.QueuedAt != "2026-01-01T00:00:13.000Z" || len(s2.Cargo) != 1 || s2.Cargo[0].Amount != 50_000 {
		t.Errorf("ship 2 %+v", s2)
	}
	// The grant is the next change; the display fixture of the scenario
	// shows the queue to the client.
	if rep.Final.NextChangeAt == nil || *rep.Final.NextChangeAt != "2026-01-01T00:00:26.000Z" {
		t.Errorf("next change %v", rep.Final.NextChangeAt)
	}
	if got := is.Inventory["planks"].Stock; got != 20_000 {
		t.Errorf("planks %d, want ship 1's 20", got)
	}

	served := runScenario(t, "berth_queue_served")
	snaps := served.Snapshots
	// 26 s: ship 1 idle, ship 2 granted (unloading until 46 s).
	at26 := snaps[len(snaps)-3]
	if at26.At != "2026-01-01T00:00:26.000Z" || at26.Ships[0].State != sim.ShipIdle || at26.Ships[1].State != sim.ShipManualLeg ||
		at26.Inventory["harbour"]["planks"].Stock != 70_000 {
		t.Errorf("at 26 s: %+v", at26)
	}
	before := snaps[len(snaps)-2]
	if before.At != "2026-01-01T00:00:45.999Z" || before.Ships[1].State != sim.ShipManualLeg {
		t.Errorf("at 45.999 s: %+v", before)
	}
	for _, s := range served.Final.Ships {
		if s.State != sim.ShipIdle || s.BerthUntil != nil {
			t.Errorf("final ship %+v", s)
		}
	}
	if b := tradingPostDisplay(t, islandDisplay(t, served.Final, "harbour")).Berths; b.Busy != 0 || len(b.Queue) != 0 {
		t.Errorf("final berths %+v", b)
	}
}

// TestCollectorWarehouse checks golden collector_warehouse (MECHANICS §5):
// producers deliver to the nearest collector by road (12 to the Trading
// Post: 24/min of its 30; 20 to the Warehouse: 40/min, throttled at level
// 1's 30, free at level 2's 55), and the capacity stays the Trading
// Post's.
func TestCollectorWarehouse(t *testing.T) {
	rep := runScenario(t, "collector_warehouse")
	is := rep.Final.Islands[0]
	var tp, wh sim.BuildingDisplay
	for _, b := range is.Buildings {
		switch b.Type {
		case "trading_post":
			tp = b
		case "warehouse":
			wh = b
		}
	}
	if wh.Level == nil || *wh.Level != 2 || wh.Capacity != nil || wh.Berths != nil || *wh.ThroughputPerMin != 55_000 {
		t.Fatalf("warehouse %+v", wh)
	}
	toTP, toWH := 0, 0
	var loadWH int64
	for _, b := range is.Buildings {
		if b.Type != "lumberjack" {
			continue
		}
		switch *b.AssignedWarehouseID {
		case tp.ID:
			toTP++
			if b.Status == sim.StatusThrottled {
				t.Errorf("lumberjack %d at the Trading Post: %s", b.ID, b.Status)
			}
		case wh.ID:
			toWH++
			loadWH += b.Rates.Outputs["wood"]
			// The east lumberjacks lie nearer to the Warehouse.
			if b.X < 30 {
				t.Errorf("lumberjack %d at x %d assigned to the Warehouse", b.ID, b.X)
			}
		default:
			t.Errorf("lumberjack %d assigned to %d", b.ID, *b.AssignedWarehouseID)
		}
	}
	if toTP == 0 || toWH == 0 || toTP+toWH != 32 {
		t.Fatalf("lumberjacks: %d to the Trading Post, %d to the Warehouse", toTP, toWH)
	}
	t.Logf("lumberjacks: %d to the Trading Post (load %d ‰), %d to the Warehouse (load %d ‰)", toTP, *tp.LoadPermille, toWH, *wh.LoadPermille)
	if *wh.LoadPermille > 1000 || *tp.LoadPermille > 1000 || toTP != 12 || toWH != 20 {
		t.Errorf("loads: trading post %d ‰, warehouse %d ‰", *tp.LoadPermille, *wh.LoadPermille)
	}
	// The capacity is the Trading Post's in every snapshot and at the end.
	if is.CapacitySource == nil || is.CapacitySource.BuildingID != tp.ID || is.Inventory["wood"].Capacity != 300_000 {
		t.Errorf("capacity source %+v, wood %+v", is.CapacitySource, is.Inventory["wood"])
	}
	// Before the upgrade the Warehouse's producers were throttled too.
	first := runUntilAdvance(t, "collector_warehouse", 0)
	for _, b := range first.Final.Islands[0].Buildings {
		if b.Type == "warehouse" && (*b.Level != 1 || *b.LoadPermille <= 1000) {
			t.Errorf("warehouse before the upgrade: level %d load %d", *b.Level, *b.LoadPermille)
		}
		if b.Type == "lumberjack" && b.X > 40 && b.Status != sim.StatusThrottled {
			t.Errorf("lumberjack %d at x %d before the upgrade: %s", b.ID, b.X, b.Status)
		}
	}
}

// TestWaterEdgePlacement checks golden water_edge_placement (MECHANICS §2):
// the four expected failures and the placements at all four rotations.
func TestWaterEdgePlacement(t *testing.T) {
	rep := runScenario(t, "water_edge_placement")
	var errs []string
	for _, e := range rep.ExpectedErrors {
		errs = append(errs, e.Error)
	}
	if !slices.Equal(errs, []string{"not_on_water", "terrain", "not_on_water", "island_already_settled"}) {
		t.Fatalf("expected errors %v", errs)
	}
	rotations := map[int]bool{}
	yards := 0
	for _, b := range rep.Final.Islands[0].Buildings {
		switch b.Type {
		case "fisher":
			rotations[b.Rotation] = true
		case "shipyard":
			yards++
		}
	}
	if len(rotations) != 4 || yards != 1 {
		t.Errorf("fisher rotations %v, shipyards %d", rotations, yards)
	}
}

// TestStartAtSea checks golden start_at_sea (MECHANICS §8, D-051): no
// island is settled before founding; founding from the start ship leaves
// the starting stock minus the Trading Post's cost on the island.
func TestStartAtSea(t *testing.T) {
	c := loadCatalogue(t)
	rep := runScenario(t, "start_at_sea")
	var errs []string
	for _, e := range rep.ExpectedErrors {
		errs = append(errs, e.Error)
	}
	if !slices.Equal(errs, []string{"ship_not_idle", "island_not_settled", "not_on_water"}) {
		t.Fatalf("expected errors %v", errs)
	}
	home := islandDisplay(t, rep.Final, "home")
	tp := c.BuildingByID["trading_post"]
	var planksTP int64
	for _, m := range tp.Cost.Materials {
		if m.Good == "planks" {
			planksTP = m.Amount
		}
	}
	house := c.BuildingByID["house_settlers"].Cost.Materials[0].Amount
	if !home.Settled || islandDisplay(t, rep.Final, "other").Settled || home.Inventory["planks"].Stock != 150_000-planksTP-2*house || home.Inventory["sails"].Stock != 10_000 {
		t.Errorf("home %+v", home.Inventory["planks"])
	}
	s := shipDisplay(t, rep.Final, 1)
	if s.State != sim.ShipIdle || s.IslandID != "home" || s.Position != nil || len(s.Cargo) != 0 {
		t.Errorf("start ship %+v", s)
	}
	if len(rep.Quests) == 0 || rep.Quests[0].ID != "intro_home_island" || rep.Quests[0].ClaimedAt == "" {
		t.Errorf("quests %+v", rep.Quests)
	}

	voyage := runScenario(t, "start_voyage")
	vs := shipDisplay(t, voyage.Final, 1)
	if vs.State != sim.ShipManualLeg || vs.Leg == nil || vs.Leg.FromIslandID != "" || vs.Leg.FromPosition == nil || vs.Leg.ToIslandID != "home" ||
		len(voyage.Final.Quests.Active) != 1 || voyage.Final.Quests.Active[0].ID != "intro_home_island" {
		t.Errorf("voyage ship %+v quests %+v", vs, voyage.Final.Quests)
	}
}

// TestSchemaFixtures writes (with -update) or compares the schema fixtures
// of internal/sim/testdata (schema<N>_<scenario>.json): the end state of a
// scenario encoded by the current binary, for the migration template of
// the next schema version (sim.TestSchemaFixturesDecode).
func TestSchemaFixtures(t *testing.T) {
	for _, name := range []string{"bootstrap_citizens", "berth_queue", "start_voyage", "fields_mixed"} {
		t.Run(name, func(t *testing.T) {
			c, w := runToEnd(t, name)
			data, err := sim.Encode(w, c.Region.Version)
			if err != nil {
				t.Fatal(err)
			}
			path := filepath.Join(repoRoot(t), "server", "internal", "sim", "testdata", fmt.Sprintf("schema%d_%s.json", sim.SchemaVersion, name))
			if *update {
				if err := os.WriteFile(path, append(data, '\n'), 0o600); err != nil {
					t.Fatal(err)
				}
				return
			}
			want, err := os.ReadFile(path) // #nosec G304 -- test fixture path.
			if err != nil {
				t.Fatalf("read fixture (run with -update): %v", err)
			}
			if !bytes.Equal(append(data, '\n'), want) {
				t.Errorf("%s differs from the current encoding (run with -update)", path)
			}
		})
	}
}
