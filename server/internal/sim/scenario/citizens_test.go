package scenario

import (
	"slices"
	"testing"

	"github.com/ricoberger/new-shores/server/internal/sim"
)

// TestCitizensNeeds checks golden (u): Citizen houses with every need met
// (three goods categories, market, chapel, tavern) are fully satisfied,
// grow and pay Citizens tax; the warehouse runs at level 2.
func TestCitizensNeeds(t *testing.T) {
	rep := runScenario(t, "citizens_needs")
	is := rep.Final.Islands[0]
	n := 0
	for _, b := range is.Buildings {
		switch b.Type {
		case "house_citizens":
			n++
			if *b.SatisfactionPermille != 1000 || *b.GrowthRatePerMin <= 0 || *b.TaxRatePerMin <= 0 {
				t.Errorf("citizen house %d: satisfaction %d growth %d tax %d", b.ID, *b.SatisfactionPermille, *b.GrowthRatePerMin, *b.TaxRatePerMin)
			}
			var kinds []string
			for _, need := range b.Needs {
				kinds = append(kinds, need.Category+need.Building)
				if need.FulfilmentPermille != 1000 {
					t.Errorf("house %d need %s fulfilment %d (%s)", b.ID, need.ID, need.FulfilmentPermille, need.Reason)
				}
			}
			if want := []string{"food", "drink", "clothing", "market_small", "chapel", "tavern"}; !slices.Equal(kinds, want) {
				t.Errorf("house %d needs %v, want %v", b.ID, kinds, want)
			}
		case "trading_post":
			if *b.Level != 2 || *b.Capacity != 500_000 || *b.ThroughputPerMin != loadCatalogue(t).BuildingByID["trading_post"].TradingPost.Levels[1].ThroughputPerMin || *b.LoadPermille <= 0 {
				t.Errorf("trading post level %d capacity %d throughput %d load %d", *b.Level, *b.Capacity, *b.ThroughputPerMin, *b.LoadPermille)
			}
		}
	}
	if n != 4 || is.Population["citizens"] <= 4*5_000 {
		t.Errorf("citizen houses %d, citizens %d", n, is.Population["citizens"])
	}
	if !rep.Final.Tiers[1].Unlocked {
		t.Error("citizens not unlocked")
	}
	if is.Inventory["planks"].Capacity != 500_000 {
		t.Errorf("capacity %d", is.Inventory["planks"].Capacity)
	}
	checkGoldNonNegative(t, rep)
}

// TestToolsRoute checks golden (v): the Settler-staffed tool chain on
// island 2 runs, a route unloads tools on the start island, and tools are
// conserved over both islands and the ship.
func TestToolsRoute(t *testing.T) {
	rep := runScenario(t, "tools_route")
	var i2 sim.IslandDisplay
	for _, is := range rep.Final.Islands {
		if is.ID == "island2" {
			i2 = is
		}
	}
	for _, b := range i2.Buildings {
		if b.Type == "toolmaker" && (b.Status != sim.StatusOK || b.Rates.Outputs["tools"] <= 0 || b.Workforce.Tier != "settlers") {
			t.Errorf("toolmaker %s rate %d workforce %+v", b.Status, b.Rates.Outputs["tools"], b.Workforce)
		}
	}
	if u := rep.Totals["start"]["tools"].Unloaded; u <= 0 {
		t.Errorf("tools unloaded on start = %d", u)
	}
	// Conservation (sub-milli exact): produced on island 2 = stock, transit
	// and buffers on both islands plus the cargo aboard.
	l := rep.Ledger()
	f2, fs := l.Flow("island2", "tools"), l.Flow("start", "tools")
	if f2.Produced <= 0 || f2.Loaded <= 0 || fs.Unloaded != f2.Loaded-cargoFine(rep, "tools") {
		t.Errorf("flows island2 %+v start %+v cargo %d", f2, fs, cargoFine(rep, "tools"))
	}
	var held int64
	for _, is := range rep.Final.Islands {
		g := is.Inventory["tools"]
		held += g.Stock + g.InTransit
	}
	for _, sh := range rep.Final.Ships {
		for _, c := range sh.Cargo {
			if c.Good == "tools" {
				held += c.Amount
			}
		}
	}
	produced := sim.FineToMilli(f2.Produced - f2.Consumed)
	if held < produced-2 || held > produced+2 {
		t.Errorf("tools held %d, produced %d", held, produced)
	}
}

// cargoFine returns the tools aboard all ships in sub-milli units (cargo is
// whole sub-milli amounts of milli-units).
func cargoFine(rep *Report, good string) int64 {
	var n int64
	for _, sh := range rep.Final.Ships {
		for _, c := range sh.Cargo {
			if c.Good == good {
				n += c.Amount * sim.SubPerMilli
			}
		}
	}
	return n
}

// TestPlacementLocks checks golden (w): the placement failures of tier-2
// content are recorded as expected errors (the runner verified the world
// stayed byte-identical) and the valid placements exist.
func TestPlacementLocks(t *testing.T) {
	rep := runScenario(t, "placement_locks")
	var got []string
	for _, e := range rep.ExpectedErrors {
		got = append(got, e.Error)
	}
	if want := []string{"upgrade_only", "no_deposit", "no_deposit", "terrain", "field_not_adjacent", "terrain", "occupied",
		"field_type_mismatch", "field_wrong_farm", "field_needs_farm", "field_max_reached", "no_fertility"}; !slices.Equal(got, want) {
		t.Errorf("expected errors = %v, want %v", got, want)
	}
	have := map[string]bool{}
	for _, is := range rep.Final.Islands {
		for _, b := range is.Buildings {
			have[is.ID+":"+b.Type] = true
			// Both farms run at full efficiency on their 16 chained fields
			// (the wheat farm has four more, up to its maximum of 20).
			if b.Fields != nil && (b.Fields.Active < 16 || b.EfficiencyPermille != 1000) {
				t.Errorf("%s %s fields %+v efficiency %d", is.ID, b.Type, b.Fields, b.EfficiencyPermille)
			}
		}
	}
	for _, want := range []string{"start:quarry", "start:wheat_farm", "start:wheat_field", "island2:hemp_farm", "island2:hemp_field"} {
		if !have[want] {
			t.Errorf("missing %s", want)
		}
	}
	if have["start:house_citizens"] || have["start:iron_mine"] || have["island2:wheat_farm"] {
		t.Errorf("a failed placement exists: %v", have)
	}
}

// TestWarehouseLoadTargets (CONTENT §12, R-21): one warehouse runs at
// roughly 80 % load (60-100 %) on a representative island of each level:
// level 1 on the reference game's start island with its full Settler
// economy (golden t, end), level 2 on a Citizens island with the balanced
// Citizens set for 400 Citizens plus that Settler support set (golden
// citizens_island_load).
func TestWarehouseLoadTargets(t *testing.T) {
	for _, tc := range []struct {
		scenario, island string
		level            int
	}{
		{"bootstrap_citizens", "start", 1},
		{"citizens_island_load", "main", 2},
	} {
		rep := runScenario(t, tc.scenario)
		// The measurement must exist: the island and exactly one warehouse
		// on it (the checklist is about one warehouse per island).
		islands, warehouses := 0, 0
		for _, is := range rep.Final.Islands {
			if is.ID != tc.island {
				continue
			}
			islands++
			for _, b := range is.Buildings {
				if b.Type != "trading_post" {
					continue
				}
				warehouses++
				if b.Level == nil || b.LoadPermille == nil || b.ThroughputPerMin == nil {
					t.Fatalf("%s/%s: warehouse %d without level/load/throughput", tc.scenario, is.ID, b.ID)
				}
				t.Logf("%s/%s: warehouse level %d load %d ‰ (throughput %d)", tc.scenario, is.ID, *b.Level, *b.LoadPermille, *b.ThroughputPerMin)
				if *b.Level != tc.level || *b.LoadPermille < 600 || *b.LoadPermille > 1000 {
					t.Errorf("%s: level %d load %d ‰, want level %d at 600-1000 ‰", tc.scenario, *b.Level, *b.LoadPermille, tc.level)
				}
			}
		}
		if islands != 1 || warehouses != 1 {
			t.Fatalf("%s: found %d islands %q with %d warehouses, want exactly one island with one warehouse", tc.scenario, islands, tc.island, warehouses)
		}
		for _, bn := range rep.Bottlenecks {
			if bn.Status == sim.StatusThrottled {
				t.Errorf("%s: %s %d throttled", tc.scenario, bn.Type, bn.BuildingID)
			}
		}
	}
}
