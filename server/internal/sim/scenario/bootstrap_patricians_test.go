package scenario

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"slices"
	"testing"
	"time"

	"github.com/ricoberger/new-shores/server/internal/sim"
)

// patriciansPrefix returns the number of steps bootstrap_patricians shares
// with bootstrap_merchants: all of them but the latter's final wait.
func patriciansPrefix(t *testing.T) int {
	t.Helper()
	steps := func(name string) []any {
		raw, err := os.ReadFile(filepath.Join(scenarioDir(t), name+".json")) // #nosec G304 -- test fixture path.
		if err != nil {
			t.Fatal(err)
		}
		var doc struct {
			Steps []any `json:"steps"`
		}
		if err := json.Unmarshal(raw, &doc); err != nil {
			t.Fatal(err)
		}
		return doc.Steps
	}
	ref, got := steps("bootstrap_merchants"), steps("bootstrap_patricians")
	n := len(ref) - 1
	if len(got) < n || !reflect.DeepEqual(ref[:n], got[:n]) {
		t.Fatal("bootstrap_patricians does not continue bootstrap_merchants (all steps but its final wait)")
	}
	return n
}

// patricianNeeds reports the Patrician houses of a display and whether
// every need category of each (carried ones included) is at least 0.6.
func patricianNeeds(ds sim.DisplayState) (houses int, ok bool) {
	ok = true
	for _, is := range ds.Islands {
		for _, b := range is.Buildings {
			if b.Type != "house_patricians" {
				continue
			}
			houses++
			for _, n := range b.Needs {
				if n.FulfilmentPermille < 600 {
					ok = false
				}
			}
		}
	}
	return houses, ok && houses > 0
}

// TestBootstrapPatricians checks golden (bootstrap_patricians), the tier-4
// reference game (D-056, CONTENT §12): it continues the tier-3 reference
// game bootstrap_merchants step for step (so the tier 1-3 timings are
// those of bootstrap_merchants), from the content starting stock only;
// Patricians unlock within 900 minutes, the first Patrician house stands
// within 960, and the game ends before minute 1800 with every need
// category of every Patrician house (carried ones included) at least 0.6
// (the generator stopped at the minute it first held, then a final
// 30-minute wait); the
// Patrician houses and public buildings stand on the home island and the
// tier-4 chains on at least two other islands, shipped home by routes;
// no permanent insolvency.
func TestBootstrapPatricians(t *testing.T) {
	const name = "bootstrap_patricians"
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
	prefix := patriciansPrefix(t)
	rep := runScenario(t, name)
	checkNoPermanentInsolvency(t, rep)

	unlocked := -1.0
	for _, snap := range rep.Snapshots {
		if slices.Contains(snap.UnlockedTiers, "patricians") {
			unlocked = snapshotMinutes(t, rep, s, snap)
			break
		}
	}
	t.Logf("patricians unlocked by minute %.0f", unlocked)
	if unlocked < 0 || unlocked > 900 {
		t.Errorf("patricians unlocked at minute %.0f (want <= 900)", unlocked)
	}

	// The first upgrade into a Patrician house: the last upgrade before
	// the first snapshot with Patricians.
	first := -1
	for _, snap := range rep.Snapshots {
		if snap.Population["patricians"] > 0 {
			for j := snap.Step; j >= 0; j-- {
				if s.Steps[j].Upgrade != nil {
					first = j
					break
				}
			}
			break
		}
	}
	if first < prefix {
		t.Fatal("no Patrician house")
	}
	t.Logf("first Patrician house at minute %.0f", minutesAt(t, s, first))
	if minutesAt(t, s, first) > 960 {
		t.Errorf("first Patrician house at minute %.0f (want <= 960)", minutesAt(t, s, first))
	}

	// Every category >= 0.6 by minute 1800: the game ends (its final
	// wait included) before that minute with every category at least 0.6.
	end := minutesAt(t, s, len(s.Steps))
	n, ok := patricianNeeds(rep.Final)
	t.Logf("every category of the %d Patrician houses >= 0.6 at the end (minute %.0f): %v", n, end, ok)
	if !ok || end > 1800 {
		t.Errorf("at the end (minute %.0f, want <= 1800) a category of the %d Patrician houses is below 0.6", end, n)
	}

	// Layout: Patrician houses and public buildings at home, the tier-4
	// chains on at least two other islands with a route bringing their
	// goods home.
	home := rep.Final.Islands[0].ID
	tier4 := map[string]bool{}
	c, err := s.LoadContent(repoRoot(t))
	if err != nil {
		t.Fatal(err)
	}
	for _, def := range c.Buildings {
		if def.Tier == "patricians" && def.Recipe != nil {
			tier4[def.ID] = true
		}
	}
	chains := map[string]bool{}
	for _, is := range rep.Final.Islands {
		for _, b := range is.Buildings {
			if (b.Type == "house_patricians" || b.Type == "church") && is.ID != home {
				t.Errorf("%s on %s, want the home island", b.Type, is.ID)
			}
			if tier4[b.Type] && is.ID != home {
				chains[is.ID] = true
			}
		}
	}
	shipped := map[string]bool{}
	for _, rt := range rep.Final.Routes {
		if len(rt.ShipIDs) == 0 {
			continue
		}
		for _, st := range rt.Stops {
			if chains[st.IslandID] && len(st.Load) > 0 {
				shipped[st.IslandID] = true
			}
		}
	}
	if len(chains) < 2 || len(shipped) < len(chains) {
		t.Errorf("tier-4 chains on %v, shipped home from %v; want at least two other islands, all shipped", chains, shipped)
	}
}
