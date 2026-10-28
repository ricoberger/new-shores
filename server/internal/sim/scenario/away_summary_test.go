package scenario

import (
	"reflect"
	"testing"
	"time"

	"github.com/ricoberger/new-shores/server/internal/sim"
)

// TestAwaySummary12h checks golden (z): the summary produced after a
// 12-hour gap spans exactly the gap since the last command and reports a
// good at capacity (planks), the population decline of starving houses
// (fish starved), the insolvency pauses that follow and the ship arrival
// inside the gap.
func TestAwaySummary12h(t *testing.T) {
	const name = "away_summary_12h"
	s := loadScenario(t, name)
	rep := runScenario(t, name)
	if len(rep.AwaySummaries) != 1 {
		t.Fatalf("%d summaries", len(rep.AwaySummaries))
	}
	sum := rep.AwaySummaries[0]
	last := firstStep(s, func(st Step) bool { return st.ManualShipment != nil })
	from, err := time.Parse(timeLayout, sum.From)
	if err != nil {
		t.Fatal(err)
	}
	to, err := time.Parse(timeLayout, sum.To)
	if err != nil {
		t.Fatal(err)
	}
	if want := s.Start.Add(time.Duration(minutesAt(t, s, last) * float64(time.Minute))); !from.Equal(want) || to.Sub(from) != 12*time.Hour || sum.ID != to.UnixMilli() {
		t.Fatalf("summary %s .. %s (id %d), want from %s spanning 12h", sum.From, sum.To, sum.ID, want)
	}
	var start map[string]bool
	for _, is := range sum.Islands {
		if is.ID != "start" {
			continue
		}
		start = map[string]bool{}
		for good, g := range is.Goods {
			start[good] = g.AtCapacity
		}
		if g := is.Goods["planks"]; !g.AtCapacity || g.StockAfter == 0 || g.Produced <= 0 || g.Capacity != g.StockAfter {
			t.Errorf("planks %+v, want at capacity", g)
		}
		if g := is.Goods["fish"]; g.Consumed <= 0 || g.StockAfter != 0 {
			t.Errorf("fish %+v, want eaten up", g)
		}
	}
	if start == nil {
		t.Fatal("no start island in the summary")
	}
	if p := sum.Population["settlers"]; p.After >= p.Before {
		t.Errorf("settlers %+v, want a decline", p)
	}
	if sum.ShipsArrived < 1 || len(sum.Arrivals) < 1 || sum.Arrivals[0].IslandID != "island2" {
		t.Errorf("arrivals %d %+v", sum.ShipsArrived, sum.Arrivals)
	}
	// Insolvency during the gap: counted, and what is still unpaid at the
	// end is listed (also in the display's insolvency block).
	if sum.AutoPaused == 0 || len(sum.StillUnpaid) == 0 || len(sum.StillUnpaid) != rep.Final.Insolvency.UnpaidBuildings+rep.Final.Insolvency.UnpaidShips {
		t.Errorf("paused %d, still unpaid %+v, insolvency %+v", sum.AutoPaused, sum.StillUnpaid, rep.Final.Insolvency)
	}
	// The step leaves the summary pending, so the display carries it next
	// to the quest progress (shared client fixture).
	if rep.Final.AwaySummary == nil || rep.Final.AwaySummary.ID != sum.ID || len(rep.Final.Quests.Active) == 0 || len(rep.Final.Quests.Claimable) == 0 {
		t.Errorf("final display: summary %v quests %+v", rep.Final.AwaySummary, rep.Final.Quests)
	}
	for _, fx := range rep.Final.Islands {
		if fx.ID == "start" && fx.Inventory["fish"].Stock != 0 {
			t.Errorf("fish stock %d at the end", fx.Inventory["fish"].Stock)
		}
	}
	t.Logf("summary %s .. %s: gold %d -> %d, settlers %d -> %d, %d ship arrivals", sum.From, sum.To, sum.GoldBefore, sum.GoldAfter,
		sum.Population["settlers"].Before, sum.Population["settlers"].After, sum.ShipsArrived)
}

// TestAwaySummaryTierUnlock checks golden away_unlock: Citizens unlock
// inside the away interval and the summary lists the tier with the number
// of buildings it adds to the build menu (the 19 Citizen buildings of the
// pre-D-054 content minus the Citizen house, which is reached by
// upgrading, and three fields).
func TestAwaySummaryTierUnlock(t *testing.T) {
	rep := runScenario(t, "away_unlock")
	if len(rep.AwaySummaries) != 1 {
		t.Fatalf("%d summaries", len(rep.AwaySummaries))
	}
	sum := rep.AwaySummaries[0]
	want := []sim.AwayTier{{ID: "citizens", Buildings: 15}}
	if !reflect.DeepEqual(sum.TiersUnlocked, want) {
		t.Errorf("tiers unlocked %+v, want %+v", sum.TiersUnlocked, want)
	}
	if rep.Final.AwaySummary == nil || !reflect.DeepEqual(rep.Final.AwaySummary.TiersUnlocked, want) {
		t.Errorf("display summary %+v", rep.Final.AwaySummary)
	}
	// A tier unlocked before the interval is not listed again.
	if other := runScenario(t, "away_summary_12h").AwaySummaries[0]; len(other.TiersUnlocked) != 0 {
		t.Errorf("away_summary_12h lists %+v", other.TiersUnlocked)
	}
}
