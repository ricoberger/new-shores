package scenario

import (
	"encoding/json"
	"slices"
	"strings"
	"testing"
	"time"
)

// referenceTimings are the measured minutes of a reference game: island 2
// founded, Citizens unlocked (first snapshot), first Citizen house
// (upgrade step) and tools on the start island (first snapshot).
type referenceTimings struct {
	island2, citizens, house, tools float64
}

// referenceIslands returns the start island and island 2 of a reference
// game on the generated archipelago: the islands of its first and second
// found_island steps.
func referenceIslands(t *testing.T, s *Scenario) (start, island2 string) {
	t.Helper()
	var found []string
	for _, st := range s.Steps {
		if st.FoundIsland != nil {
			found = append(found, st.FoundIsland.Island)
		}
	}
	if len(found) < 2 {
		t.Fatalf("%s founds %d islands, want 2", s.Name, len(found))
	}
	return found[0], found[1]
}

func measureReference(t *testing.T, s *Scenario, rep *Report) referenceTimings {
	t.Helper()
	start, island2 := referenceIslands(t, s)
	m := referenceTimings{island2: -1, citizens: -1, house: -1, tools: -1}
	if i := firstStep(s, func(st Step) bool { return st.FoundIsland != nil && st.FoundIsland.Island == island2 }); i >= 0 {
		m.island2 = minutesAt(t, s, i)
	}
	if i := firstStep(s, func(st Step) bool { return st.Upgrade != nil }); i >= 0 {
		m.house = minutesAt(t, s, i)
	}
	for _, snap := range rep.Snapshots {
		at := snapshotMinutes(t, rep, s, snap)
		if m.citizens < 0 && slices.Contains(snap.UnlockedTiers, "citizens") {
			m.citizens = at
		}
		if m.tools < 0 && snap.Inventory[start]["tools"].Stock > 0 {
			m.tools = at
		}
	}
	return m
}

// TestBootstrapCitizensQuests checks golden (y): the reference game of
// bootstrap_citizens with the intro quests claimed as soon as they are
// completed. Claims are the only change to the plan (same commands in the
// same order, same seed restrictions); the rewards give at least 15
// minutes of headroom on the island-2 (<= 45) and first-Citizen-house
// (<= 85) targets, absolutely and against bootstrap_citizens; every quest
// of the intro chain is completed and claimed, and so are the tier-2
// quests the plan completes (shipyard, second sloop; the rest of that
// chain stays active); no permanent insolvency.
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
	t.Logf("with quests: island 2 at minute %.0f, citizens unlocked by %.0f, first Citizen house at %.0f, tools home by %.0f",
		got.island2, got.citizens, got.house, got.tools)
	t.Logf("without claims: island 2 at minute %.0f, citizens unlocked by %.0f, first Citizen house at %.0f, tools home by %.0f",
		base.island2, base.citizens, base.house, base.tools)
	if got.island2 < 0 || got.island2 > 45 || base.island2-got.island2 < 15 {
		t.Errorf("island 2 at minute %.0f (bootstrap_citizens %.0f), want <= 45 and >= 15 min earlier", got.island2, base.island2)
	}
	if got.house < 0 || got.house > 85 || base.house-got.house < 15 {
		t.Errorf("first Citizen house at minute %.0f (bootstrap_citizens %.0f), want <= 85 and >= 15 min earlier", got.house, base.house)
	}
	if got.tools < 0 {
		t.Error("no tools arrived on the start island")
	}

	// Every quest of the intro chain is completed and claimed; of the
	// tier-2 chain (D-056) the plan builds the shipyard and the sloop.
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
		if !claimed[q.ID] && (strings.HasPrefix(q.ID, "intro_") || q.ID == "citizens_shipyard" || q.ID == "citizens_sloop") {
			t.Errorf("quest %s not completed and claimed", q.ID)
		}
	}
	if a := rep.Final.Quests.Active; len(a) != 1 || a[0].ID != "citizens_tavern" || len(rep.Final.Quests.Claimable) != 0 {
		t.Errorf("final quests %+v", rep.Final.Quests)
	}
	checkNoPermanentInsolvency(t, rep)
}
