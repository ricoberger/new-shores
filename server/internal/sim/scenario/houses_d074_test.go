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

// TestHouseGrowthTarget (D-074 §1, D-080 sizes): a Citizen house grows
// towards 9 / 14 at satisfaction 0.544 and holds there, fills to 14 at 1,
// declines to 8 at 0.354 and to the floor of 5 (never below) at 0.
func TestHouseGrowthTarget(t *testing.T) {
	rep := runScenario(t, "house_growth_target")
	for _, c := range []struct {
		step int
		want int64
		what string
	}{
		{9, 8_000, "0.544 after 5 min: on its way"},
		{10, 9_000, "0.544 holds"},
		{20, 14_000, "satisfaction 1"},
		{23, 8_000, "0.354 holds"},
		{25, 5_000, "unconnected: floor"},
		{26, 5_000, "never below the floor"},
	} {
		if got := citizensAt(t, rep, c.step); got != c.want {
			t.Errorf("%s (step %d): %d milli-citizens, want %d", c.what, c.step, got, c.want)
		}
	}
}

// TestHouseUpgradeKeepsResidents (D-074 §2, D-080 sizes): the upgraded
// house keeps its 6 residents and then grows to its Citizens target of 9.
func TestHouseUpgradeKeepsResidents(t *testing.T) {
	rep := runScenario(t, "house_upgrade_keeps_residents")
	if got := citizensAt(t, rep, 8); got != 6_000 {
		t.Errorf("after the upgrade: %d milli-citizens, want 6000", got)
	}
	if got := citizensAt(t, rep, 12); got != 9_000 {
		t.Errorf("at the target: %d milli-citizens, want 9000", got)
	}
}
