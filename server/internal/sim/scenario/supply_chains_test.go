package scenario

import (
	"testing"
)

// TestSupplyChainsPauseLast checks golden supply_chains_pause_last
// (D-075 §5, the #74 strand case): the insolvency cascade after the
// settler houses skips the weaver — the island's only running producer of
// wool garments, which the houses get below 0.6 — and pauses everything
// else that is pausable, the two fishers included (fish is in stock, its
// need is met). The weaver is never paused, the town grows out of it and
// within 60 minutes after the cascade nothing is unpaid, the balance is
// >= 0 and gold has not gone negative.
func TestSupplyChainsPauseLast(t *testing.T) {
	const name = "supply_chains_pause_last"
	s := loadScenario(t, name)
	rep := runScenario(t, name)

	cascade, _, recovered := stallTimeline(t, s, rep)
	t.Logf("cascade at minute %.2f, full recovery at minute %.2f", cascade, recovered)
	if cascade < 17 || recovered < cascade || recovered-cascade > 60 {
		t.Fatalf("cascade %.2f, recovery %.2f", cascade, recovered)
	}
	var order []string
	for _, e := range rep.PauseEvents {
		if e.Type == "weaver_wool" {
			t.Errorf("weaver %s at %s", e.Action, e.At)
		}
		if e.Action == "auto_pause" {
			if stallMinutes(t, s, e.At) != cascade {
				t.Errorf("pause of %s at %s, not at the cascade", e.Type, e.At)
			}
			order = append(order, e.Type)
		}
	}
	// The auto-pause order without the guarded weaver: intermediate
	// (lowest upkeep first, then ID), then tier-1 food.
	want := []string{"lumberjack", "sheep_farm", "sawmill", "fisher", "fisher"}
	if len(order) != len(want) {
		t.Fatalf("paused %v, want %v", order, want)
	}
	for i := range want {
		if order[i] != want[i] {
			t.Fatalf("paused %v, want %v", order, want)
		}
	}

	// The town grows out of it: more settlers at the end than when the
	// cascade hit, nothing unpaid, a positive balance.
	var atCascade, final int64 = -1, 0
	for _, snap := range rep.Snapshots {
		if atCascade < 0 && stallMinutes(t, s, snap.At) >= cascade {
			atCascade = snap.Population["settlers"]
		}
		final = snap.Population["settlers"]
	}
	if final <= atCascade {
		t.Errorf("settlers %d at the end, %d at the cascade", final, atCascade)
	}
	if ins := rep.Final.Insolvency; ins.UnpaidBuildings != 0 || ins.UnpaidShips != 0 || rep.Final.BalanceRatePerMin <= 0 {
		t.Errorf("final insolvency %+v balance %d", ins, rep.Final.BalanceRatePerMin)
	}
	checkGoldNonNegative(t, rep)
}
