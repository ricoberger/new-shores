package scenario

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/ricoberger/new-shores/server/internal/sim"
)

// stallMinutes returns the world minutes since the scenario start of an
// RFC 3339 report timestamp.
func stallMinutes(t *testing.T, s *Scenario, at string) float64 {
	t.Helper()
	ts, err := time.Parse(timeLayout, at)
	if err != nil {
		t.Fatal(err)
	}
	return ts.Sub(s.Start).Minutes()
}

// stallTimeline returns the minute of the insolvency cascade, of the first
// auto-resume and of the full recovery (the auto_resume that leaves nothing
// paused for insolvency), -1 when it did not happen.
func stallTimeline(t *testing.T, s *Scenario, rep *Report) (cascade, firstResume, recovered float64) {
	t.Helper()
	cascade, firstResume, recovered = -1, -1, -1
	open := 0
	for _, e := range rep.PauseEvents {
		m := stallMinutes(t, s, e.At)
		switch e.Action {
		case "auto_pause":
			if cascade < 0 {
				cascade = m
			}
			open++
		case "auto_resume":
			if firstResume < 0 {
				firstResume = m
			}
			open--
			if open == 0 && recovered < 0 {
				recovered = m
			}
		}
	}
	return cascade, firstResume, recovered
}

// stallOpeningEnd returns the index of the first step after the opening:
// the settler houses are its last placements.
func stallOpeningEnd(t *testing.T, s *Scenario) int {
	t.Helper()
	last := -1
	for i, st := range s.Steps {
		if st.Place != nil && st.Place.Type == "house_settlers" {
			last = i
		}
	}
	if last < 0 {
		t.Fatal("no house in the opening")
	}
	return last + 1
}

func encodeStep(t *testing.T, st Step) string {
	t.Helper()
	data, err := json.Marshal(st)
	if err != nil {
		t.Fatal(err)
	}
	return string(data)
}

// checkStallRestrictions: start stock only, no grants, no workforce.
func checkStallRestrictions(t *testing.T, s *Scenario) {
	t.Helper()
	if !s.Seed.Start || s.Seed.Gold != "" || len(s.Seed.Stock) != 0 || len(s.Seed.Workforce) != 0 || s.DevBonus != nil {
		t.Fatalf("seed = %+v, want the content starting stock only", s.Seed)
	}
	for _, st := range s.Steps {
		if st.Stock != nil {
			t.Fatal("stall scenarios must not grant stock")
		}
	}
}

// TestStallRecoveryAuto checks golden (x), automatic variant: the tier-1
// opening runs out of gold before the first catch lands; the cascade
// pauses every pausable building at one instant; fully stalled, the balance
// is not negative (nothing that runs has upkeep) and gold grows from the
// floor taxes; the auto-resume chain restarts on its own and within 60
// minutes after the cascade nothing is unpaid, the balance is >= 0 and
// gold strictly increases. No command follows the opening.
func TestStallRecoveryAuto(t *testing.T) {
	const name = "stall_recovery_auto"
	s := loadScenario(t, name)
	checkStallRestrictions(t, s)
	end := stallOpeningEnd(t, s)
	for i, st := range s.Steps[end:] {
		if st.Advance == nil {
			t.Fatalf("step %d after the opening is a command", end+i)
		}
	}
	rep := runScenario(t, name)
	c := loadCatalogue(t)

	cascade, firstResume, recovered := stallTimeline(t, s, rep)
	t.Logf("cascade at minute %.2f, first auto-resume at minute %.2f, full recovery at minute %.2f", cascade, firstResume, recovered)
	if cascade < 0 || firstResume <= cascade || recovered < firstResume || recovered-cascade > 60 {
		t.Fatalf("cascade %.2f, first resume %.2f, recovery %.2f", cascade, firstResume, recovered)
	}

	// The cascade pauses every pausable building at one instant.
	pausable, pausableUpkeep := 0, int64(0)
	for _, b := range rep.Final.Islands[0].Buildings {
		if def := c.BuildingByID[b.Type]; def.PauseCategory != "never" && def.UpkeepPerMin > 0 {
			pausable++
			pausableUpkeep += def.UpkeepPerMin
		}
	}
	paused := 0
	for _, e := range rep.PauseEvents {
		if e.Action == "auto_pause" {
			paused++
			if stallMinutes(t, s, e.At) != cascade {
				t.Errorf("pause of %s at %s, not at the cascade", e.Type, e.At)
			}
		}
	}
	if pausable < 5 || paused != pausable {
		t.Fatalf("%d of %d pausable buildings paused", paused, pausable)
	}

	// Fully stalled: right after the cascade gold is zero, every pausable
	// building is unpaid, the balance is >= 0 and gold grows from the floor
	// taxes until the first auto-resume.
	at := s.Start.Add(time.Duration(cascade * float64(time.Minute)))
	w, err := RunSteps(s, c, end)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := sim.Advance(w, c, at); err != nil {
		t.Fatal(err)
	}
	ds, err := sim.Display(w, c, at)
	if err != nil {
		t.Fatal(err)
	}
	ins := ds.Insolvency
	if ds.Gold != 0 || ds.BalanceRatePerMin < 0 || ds.TaxRatePerMin <= 0 || ds.UpkeepRatePerMin != 0 || ins.UnpaidBuildings != pausable ||
		ins.UnpaidShips != 0 || ins.UnpaidUpkeepPerMin != pausableUpkeep || ins.BalanceIfResumedPerMin >= 0 {
		t.Fatalf("stalled: gold %d balance %d tax %d insolvency %+v", ds.Gold, ds.BalanceRatePerMin, ds.TaxRatePerMin, ins)
	}
	t.Logf("fully stalled: balance %d, floor taxes %d, unpaid upkeep %d, balance if resumed %d milli-gold/min",
		ds.BalanceRatePerMin, ds.TaxRatePerMin, ins.UnpaidUpkeepPerMin, ins.BalanceIfResumedPerMin)
	mid := at.Add(time.Duration((firstResume - cascade) / 2 * float64(time.Minute)))
	if _, err := sim.Advance(w, c, mid); err != nil {
		t.Fatal(err)
	}
	if w.Gold <= 0 {
		t.Errorf("gold %d while stalled, want > 0", w.Gold)
	}

	// Recovered: nothing unpaid, balance >= 0, gold strictly increasing.
	if ins := rep.Final.Insolvency; ins.UnpaidBuildings != 0 || ins.UnpaidShips != 0 || ins.UnpaidUpkeepPerMin != 0 ||
		ins.BalanceIfResumedPerMin != rep.Final.BalanceRatePerMin {
		t.Errorf("final insolvency %+v", ins)
	}
	if rep.Final.BalanceRatePerMin <= 0 {
		t.Errorf("final balance %d", rep.Final.BalanceRatePerMin)
	}
	var last int64 = -1
	for _, snap := range rep.Snapshots {
		if stallMinutes(t, s, snap.At) <= recovered {
			continue
		}
		if snap.Gold <= last {
			t.Errorf("gold not increasing at %s: %d after %d", snap.At, snap.Gold, last)
		}
		last = snap.Gold
	}
	if last < 0 {
		t.Error("no snapshot after the recovery")
	}
	checkGoldNonNegative(t, rep)
}

// TestStallRecoveryManual checks golden (x), manual shortcut: the same
// world up to the fully stalled state; once the first catch has landed the
// player resumes the unpaid fisher and demolishes the unpaid weaver. The
// town recovers within 60 minutes of that action and no later than without
// it.
func TestStallRecoveryManual(t *testing.T) {
	auto := loadScenario(t, "stall_recovery_auto")
	s := loadScenario(t, "stall_recovery_manual")
	checkStallRestrictions(t, s)
	end := stallOpeningEnd(t, s)
	// Identical opening and stall: the manual scenario differs from the
	// automatic one only by the commands of the shortcut at one instant.
	action := firstStep(s, func(st Step) bool { return st.Resume != nil })
	n := 0
	for action+n < len(s.Steps) && s.Steps[action+n].Advance == nil {
		n++
	}
	if action < end || len(s.Steps) != len(auto.Steps)+n {
		t.Fatalf("shortcut steps %d..%d, opening end %d", action, action+n, end)
	}
	for i := range auto.Steps {
		j := i
		if i >= action {
			j = i + n
		}
		a, b := encodeStep(t, auto.Steps[i]), encodeStep(t, s.Steps[j])
		if a != b {
			t.Fatalf("step %d differs from the automatic scenario: %s vs %s", j, b, a)
		}
	}
	for i, st := range s.Steps[end:] {
		if st.Advance == nil && (end+i < action || end+i >= action+n) {
			t.Fatalf("step %d after the opening is a command", end+i)
		}
	}

	autoRep := runScenario(t, "stall_recovery_auto")
	rep := runScenario(t, "stall_recovery_manual")
	cascade, _, autoRecovered := stallTimeline(t, auto, autoRep)
	actionAt := minutesAt(t, s, action)
	if actionAt <= cascade {
		t.Fatalf("manual action at minute %.2f, before the cascade at %.2f", actionAt, cascade)
	}
	// The resumed fisher stays running, the weaver is gone; the rest
	// resumes automatically.
	open, recovered := 0, -1.0
	for _, e := range rep.PauseEvents {
		switch e.Action {
		case "auto_pause":
			open++
		case "auto_resume":
			open--
		}
		if e.Action == "auto_pause" && stallMinutes(t, s, e.At) > cascade {
			t.Errorf("paused again after the cascade: %+v", e)
		}
		// The manual resume and the demolition close two pauses.
		if open == 2 && recovered < 0 && e.Action == "auto_resume" && stallMinutes(t, s, e.At) > actionAt {
			recovered = stallMinutes(t, s, e.At)
		}
	}
	t.Logf("manual resume at minute %.2f: recovered at minute %.2f (automatic: %.2f)", actionAt, recovered, autoRecovered)
	if recovered < 0 || recovered-actionAt > 60 || recovered > autoRecovered {
		t.Errorf("manual recovery at minute %.2f after the action at %.2f; automatic at %.2f", recovered, actionAt, autoRecovered)
	}
	if ins := rep.Final.Insolvency; ins.UnpaidBuildings != 0 || rep.Final.BalanceRatePerMin < 0 {
		t.Errorf("final insolvency %+v balance %d", ins, rep.Final.BalanceRatePerMin)
	}
	checkGoldNonNegative(t, rep)
}
