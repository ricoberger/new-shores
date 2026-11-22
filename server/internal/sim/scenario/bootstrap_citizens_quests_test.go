package scenario

import (
	"encoding/json"
	"slices"
	"strings"
	"testing"
	"time"
)

// referenceTimings are the measured minutes of a reference game:
// Citizens unlocked (first snapshot) and the first Citizen house (upgrade
// step). Island 2 and tools left the Citizens games with D-083.
type referenceTimings struct {
	citizens, house float64
}

// referenceStart returns the start island of a reference game: the island
// of its first found_island step. Since D-083 the Citizens games settle
// no other island (one island suffices until Merchants).
func referenceStart(t *testing.T, s *Scenario) string {
	t.Helper()
	var found []string
	for _, st := range s.Steps {
		if st.FoundIsland != nil {
			found = append(found, st.FoundIsland.Island)
		}
	}
	if len(found) != 1 {
		t.Fatalf("%s founds %d islands, want 1 (D-083)", s.Name, len(found))
	}
	return found[0]
}

func measureReference(t *testing.T, s *Scenario, rep *Report) referenceTimings {
	t.Helper()
	m := referenceTimings{citizens: -1, house: -1}
	if i := firstStep(s, func(st Step) bool { return st.Upgrade != nil }); i >= 0 {
		m.house = minutesAt(t, s, i)
	}
	for _, snap := range rep.Snapshots {
		if m.citizens < 0 && slices.Contains(snap.UnlockedTiers, "citizens") {
			m.citizens = snapshotMinutes(t, rep, s, snap)
		}
	}
	return m
}

// TestBootstrapCitizensQuests checks golden (y): the reference game of
// bootstrap_citizens with the intro quests claimed as soon as they are
// completed. Claims are the only change to the plan (same commands in the
// same order, same seed restrictions); the rewards give at least 15
// minutes of headroom on the first-Citizen-house target (<= 85),
// absolutely and against bootstrap_citizens; every quest of the intro
// chain and citizens_stone (D-083: it leads to the first Citizen house)
// is completed and claimed; the rest of the tier-2 chain stays at its
// first quest (the shipyard, which the plan builds only in the Merchants
// segment since D-074); no permanent insolvency.
func TestBootstrapCitizensQuests(t *testing.T) {
	const name = "bootstrap_citizens_quests"
	s := loadScenario(t, name)
	ref := loadScenario(t, "bootstrap_citizens")
	if !s.Seed.Start || s.Seed.Gold != "" || len(s.Seed.Stock) != 0 || len(s.Seed.Workforce) != 0 {
		t.Fatalf("seed = %+v, want the content starting stock only", s.Seed)
	}
	commands := func(sc *Scenario) []string {
		var out []string
		for _, st := range sc.Steps {
			if st.Advance != nil || st.ClaimQuest != nil {
				continue
			}
			data, err := json.Marshal(st)
			if err != nil {
				t.Fatal(err)
			}
			out = append(out, string(data))
		}
		return out
	}
	if !slices.Equal(commands(s), commands(ref)) {
		t.Fatal("the plan differs from bootstrap_citizens beyond claims and waits")
	}
	for _, st := range s.Steps {
		if st.Stock != nil {
			t.Fatal("the reference game must not grant stock")
		}
		if st.Advance != nil {
			if d, err := time.ParseDuration(st.Advance.Duration); err != nil || d < time.Minute || d%time.Minute != 0 {
				t.Errorf("advance %s is not a whole number of minutes", st.Advance.Duration)
			}
		}
		if st.Pause != nil || st.Resume != nil || st.Demolish != nil || st.DemolishRd != nil {
			t.Errorf("reference game uses pause/resume/demolish: %+v", st)
		}
	}

	rep := runScenario(t, name)
	got := measureReference(t, s, rep)
	base := measureReference(t, ref, runScenario(t, "bootstrap_citizens"))
	referenceStart(t, s)
	t.Logf("with quests: citizens unlocked by %.0f, first Citizen house at %.0f", got.citizens, got.house)
	t.Logf("without claims: citizens unlocked by %.0f, first Citizen house at %.0f", base.citizens, base.house)
	if got.house < 0 || got.house > 85 || base.house-got.house < 15 {
		t.Errorf("first Citizen house at minute %.0f (bootstrap_citizens %.0f), want <= 85 and >= 15 min earlier", got.house, base.house)
	}

	// Every quest of the intro chain and citizens_stone is completed and
	// claimed; the tier-2
	// chain (D-056) waits at the shipyard, which the Citizens plan no longer
	// builds (D-074: the Merchants plan does).
	c, err := s.LoadContent(repoRoot(t))
	if err != nil {
		t.Fatal(err)
	}
	claimed := map[string]bool{}
	for _, q := range rep.Quests {
		if q.ClaimedAt != "" {
			claimed[q.ID] = true
		}
	}
	for _, q := range c.Quests {
		if !claimed[q.ID] && (strings.HasPrefix(q.ID, "intro_") || q.ID == "citizens_stone") {
			t.Errorf("quest %s not completed and claimed", q.ID)
		}
	}
	if a := rep.Final.Quests.Active; len(a) != 1 || a[0].ID != "citizens_shipyard" || len(rep.Final.Quests.Claimable) != 0 {
		t.Errorf("final quests %+v", rep.Final.Quests)
	}
	checkNoPermanentInsolvency(t, rep)
}
