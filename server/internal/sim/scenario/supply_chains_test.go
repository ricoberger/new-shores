package scenario

import (
	"strings"
	"testing"
)

// TestSupplyChainsPauseLast checks golden supply_chains_pause_last
// (D-075 §5, the #74 strand case): the insolvency cascade after the
// settler houses skips the weaver — the island's last running producer of
// the wool garments the houses consume — and the sheep farm that feeds it
// (the guard is transitive), and pauses everything else that is pausable
// but the last fisher: of the two fishers the first is paused, which
// leaves the second the last producer of fish. The weaver
// is never paused, the town grows out of it and within 60 minutes after
// the cascade nothing is unpaid, the balance is >= 0 and gold has not
// gone negative.
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
		if e.Type == "weaver_wool" || e.Type == "sheep_farm" {
			t.Errorf("%s %s at %s", e.Type, e.Action, e.At)
		}
		if e.Action == "auto_pause" {
			if stallMinutes(t, s, e.At) != cascade {
				t.Errorf("pause of %s at %s, not at the cascade", e.Type, e.At)
			}
			order = append(order, e.Type)
		}
	}
	// The auto-pause order without the guarded wool chain: intermediate
	// (lowest upkeep first, then ID), then tier-1 food (one fisher).
	want := []string{"lumberjack", "sawmill", "fisher"}
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

// TestSupplyChainsMetNeed checks golden supply_chains_met_need (D-075 §5,
// "would the need fall below 0.6 without it"): the supply_chains_pause_last
// town with wool garments in stock, so the houses' clothing need is met
// when the treasury runs dry. The weaver is still the island's last
// running producer of the garments they consume, so the cascade keeps it
// running, and with it the wool chain that feeds it (the sheep farm, the
// last producer of its wool; the guard is transitive), while the cascade
// pauses the wood chain and one of the two fishers instead (the other,
// now the last, is kept). Before, a met need guarded nothing and the
// weaver (need goods) paused first.
func TestSupplyChainsMetNeed(t *testing.T) {
	const name = "supply_chains_met_need"
	s := loadScenario(t, name)
	rep := runScenario(t, name)

	cascade, _, recovered := stallTimeline(t, s, rep)
	t.Logf("cascade at minute %.2f, full recovery at minute %.2f", cascade, recovered)
	if cascade < 17 || recovered < cascade || recovered-cascade > 60 {
		t.Fatalf("cascade %.2f, recovery %.2f", cascade, recovered)
	}
	var order []string
	for _, e := range rep.PauseEvents {
		if e.Type == "weaver_wool" || e.Type == "sheep_farm" {
			t.Errorf("%s %s at %s", e.Type, e.Action, e.At)
		}
		if e.Action == "auto_pause" {
			order = append(order, e.Type)
		}
	}
	// The wood chain pauses, the wool chain is kept.
	want := []string{"lumberjack", "sawmill", "fisher"}
	if strings.Join(order, ",") != strings.Join(want, ",") {
		t.Fatalf("paused %v, want %v", order, want)
	}

	// At the first advance after the cascade the clothing need is met
	// (>= 0.6) in every house while the wool chain runs, the wood chain
	// and one fisher wait.
	c, err := s.LoadContent(repoRoot(t))
	if err != nil {
		t.Fatal(err)
	}
	for i, st := range s.Steps {
		if st.Advance == nil {
			continue
		}
		part := *s
		part.Steps = s.Steps[:i+1]
		r, err := Run(&part, c)
		if err != nil {
			t.Fatal(err)
		}
		at := r.Snapshots[len(r.Snapshots)-1].At
		if stallMinutes(t, s, at) < cascade {
			continue
		}
		houses, fishers := 0, 0
		for _, b := range r.Final.Islands[0].Buildings {
			switch b.Type {
			case "weaver_wool", "sheep_farm":
				if b.Paused {
					t.Errorf("%s paused at %s", b.Type, at)
				}
			case "lumberjack", "sawmill":
				if !b.Paused {
					t.Errorf("%s running at %s", b.Type, at)
				}
			case "fisher":
				if b.Paused {
					fishers++
				}
			case "house_settlers":
				houses++
				for _, n := range b.Needs {
					if n.ID == "settlers_clothing" && n.FulfilmentPermille < 600 {
						t.Errorf("house %d clothing %d at %s", b.ID, n.FulfilmentPermille, at)
					}
				}
			}
		}
		if houses != 5 || fishers != 1 {
			t.Errorf("at %s: %d houses, %d paused fishers", at, houses, fishers)
		}
		break
	}
	checkGoldNonNegative(t, rep)
}
