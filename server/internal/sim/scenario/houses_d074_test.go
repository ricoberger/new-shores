package scenario

import "testing"

// citizensAt returns the Citizens population (milli) of the snapshot after
// step i.
func citizensAt(t *testing.T, rep *Report, step int) int64 {
	t.Helper()
	for _, snap := range rep.Snapshots {
		if snap.Step == step {
			return snap.Population["citizens"]
		}
	}
	t.Fatalf("no snapshot after step %d", step)
	return 0
}

// TestHouseGrowthTarget (D-074 §1): a Citizen house holds 10 / 15 at
// satisfaction 0.544, fills to 15 at 1, declines to 8 at 0.354 and to the
// floor of 5 (never below) at 0.
func TestHouseGrowthTarget(t *testing.T) {
	rep := runScenario(t, "house_growth_target")
	for _, c := range []struct {
		step int
		want int64
		what string
	}{
		{9, 10_000, "0.544 after 5 min"},
		{10, 10_000, "0.544 holds"},
		{20, 15_000, "satisfaction 1"},
		{23, 8_000, "0.354 holds"},
		{25, 5_000, "unconnected: floor"},
		{26, 5_000, "never below the floor"},
	} {
		if got := citizensAt(t, rep, c.step); got != c.want {
			t.Errorf("%s (step %d): %d milli-citizens, want %d", c.what, c.step, got, c.want)
		}
	}
}

// TestHouseUpgradeKeepsResidents (D-074 §2): the upgraded house keeps its
// 8 residents and then grows to its Citizens target of 10.
func TestHouseUpgradeKeepsResidents(t *testing.T) {
	rep := runScenario(t, "house_upgrade_keeps_residents")
	if got := citizensAt(t, rep, 8); got != 8_000 {
		t.Errorf("after the upgrade: %d milli-citizens, want 8000", got)
	}
	if got := citizensAt(t, rep, 12); got != 10_000 {
		t.Errorf("at the target: %d milli-citizens, want 10000", got)
	}
}
