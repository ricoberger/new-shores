package scenario

import (
	"slices"
	"testing"
	"time"

	"github.com/ricoberger/new-shores/server/internal/sim"
)

// minutesAt returns the world time (minutes since the start) at which step
// i of a scenario runs: the sum of the advance steps before it.
func minutesAt(t *testing.T, s *Scenario, i int) float64 {
	t.Helper()
	var d time.Duration
	for _, st := range s.Steps[:i] {
		if st.Advance != nil {
			step, err := time.ParseDuration(st.Advance.Duration)
			if err != nil {
				t.Fatal(err)
			}
			d += step
		}
	}
	return d.Minutes()
}

// snapshotMinutes returns the world minutes of a snapshot.
func snapshotMinutes(t *testing.T, rep *Report, s *Scenario, snap Snapshot) float64 {
	t.Helper()
	at, err := time.Parse(timeLayout, snap.At)
	if err != nil {
		t.Fatal(err)
	}
	return at.Sub(s.Start).Minutes()
}

func firstStep(s *Scenario, match func(Step) bool) int {
	for i, st := range s.Steps {
		if match(st) {
			return i
		}
	}
	return -1
}

// TestBootstrapCitizens checks golden (t), the tier 1-2 reference game
// (R-18): only the content starting stock is seeded; island 2 is settled
// within 60 minutes, Citizens unlock within 90, the first Citizen house
// stands within 100, and within 150 the toolmaker on island 2 runs and
// tools have arrived on the start island; no permanent insolvency.
func TestBootstrapCitizens(t *testing.T) {
	const name = "bootstrap_citizens"
	s := loadScenario(t, name)
	if !s.Seed.Start || s.Seed.Gold != "" || len(s.Seed.Stock) != 0 || len(s.Seed.Workforce) != 0 {
		t.Fatalf("seed = %+v, want the content starting stock only", s.Seed)
	}
	for _, st := range s.Steps {
		if st.Stock != nil {
			t.Fatal("the reference game must not grant stock")
		}
		if st.Advance != nil {
			if d, err := time.ParseDuration(st.Advance.Duration); err != nil || d < time.Minute {
				t.Errorf("advance %s shorter than a minute", st.Advance.Duration)
			}
		}
		if st.Pause != nil || st.Resume != nil || st.Demolish != nil || st.DemolishRd != nil {
			t.Errorf("reference game uses pause/resume/demolish: %+v", st)
		}
	}
	rep := runScenario(t, name)
	start, island2 := referenceIslands(t, s)

	found := firstStep(s, func(st Step) bool { return st.FoundIsland != nil && st.FoundIsland.Island == island2 })
	if found < 0 || minutesAt(t, s, found) > 60 {
		t.Errorf("island 2 founded at step %d, minute %.0f (want <= 60)", found, minutesAt(t, s, found))
	}
	t.Logf("island 2 settled at minute %.0f", minutesAt(t, s, found))

	// The upgrade is a command at a step time; the next snapshot shows the
	// Citizen house's residents.
	upgrade := firstStep(s, func(st Step) bool { return st.Upgrade != nil })
	if upgrade < 0 {
		t.Fatal("no upgrade step")
	}
	unlocked, tools := -1.0, -1
	citizens := int64(0)
	for i, snap := range rep.Snapshots {
		m := snapshotMinutes(t, rep, s, snap)
		if unlocked < 0 && slices.Contains(snap.UnlockedTiers, "citizens") {
			unlocked = m
		}
		if citizens == 0 && snap.Step > upgrade {
			citizens = snap.Population["citizens"]
		}
		if tools < 0 && snap.Inventory[start]["tools"].Stock > 0 {
			tools = i
		}
	}
	t.Logf("citizens unlocked by minute %.0f, first Citizen house at minute %.0f", unlocked, minutesAt(t, s, upgrade))
	if unlocked < 0 || unlocked > 90 {
		t.Errorf("citizens unlocked at minute %.0f (want <= 90)", unlocked)
	}
	if minutesAt(t, s, upgrade) > 100 || citizens < 5_000 {
		t.Errorf("first Citizen house at minute %.0f with %d milli-citizens after it, want <= 100 and >= 5000", minutesAt(t, s, upgrade), citizens)
	}
	if tools < 0 {
		t.Fatal("no tools arrived on the start island")
	}
	toolsAt := snapshotMinutes(t, rep, s, rep.Snapshots[tools])
	t.Logf("tools on the start island by minute %.0f", toolsAt)
	if toolsAt > 150 {
		t.Errorf("tools on the start island at minute %.0f (want <= 150)", toolsAt)
	}
	// At that snapshot the toolmaker on island 2 runs.
	at := runUntilAdvance(t, name, tools)
	running := false
	for _, is := range at.Final.Islands {
		for _, b := range is.Buildings {
			if is.ID == island2 && b.Type == "toolmaker" && b.Status == sim.StatusOK && b.Rates.Outputs["tools"] > 0 {
				running = true
			}
		}
	}
	if !running {
		t.Error("toolmaker on island 2 not running when tools arrived")
	}

	// Quests are optional: the intro chain completes along the plan, but
	// nothing is claimed.
	if len(rep.Quests) == 0 {
		t.Error("no quest completed")
	}
	for _, q := range rep.Quests {
		if q.ClaimedAt != "" {
			t.Errorf("quest %s claimed in the reference game without claims", q.ID)
		}
	}
	checkNoPermanentInsolvency(t, rep)
}

// checkNoPermanentInsolvency: every auto-pause is resumed, nothing is
// unpaid at the end, the balance is not negative, gold never was.
func checkNoPermanentInsolvency(t *testing.T, rep *Report) {
	t.Helper()
	open := map[[2]int64]int{}
	for _, e := range rep.PauseEvents {
		k := [2]int64{e.BuildingID, e.ShipID}
		if e.Action == "auto_pause" {
			open[k]++
		} else {
			open[k]--
		}
	}
	for k, n := range open {
		if n > 0 {
			t.Errorf("building/ship %v paused without resume", k)
		}
	}
	for _, is := range rep.Final.Islands {
		for _, b := range is.Buildings {
			if b.PausedReason == sim.PausedReasonUnpaid {
				t.Errorf("%s %d unpaid at the end", b.Type, b.ID)
			}
		}
	}
	for _, sh := range rep.Final.Ships {
		if sh.PausedReason == sim.PausedReasonUnpaid {
			t.Errorf("ship %d unpaid at the end", sh.ID)
		}
	}
	if rep.Final.BalanceRatePerMin < 0 {
		t.Errorf("final balance %d", rep.Final.BalanceRatePerMin)
	}
	checkGoldNonNegative(t, rep)
}
