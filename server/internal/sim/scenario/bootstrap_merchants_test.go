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

// merchantsPrefix returns the number of steps bootstrap_merchants shares
// with bootstrap_citizens: all of them but the latter's final wait.
func merchantsPrefix(t *testing.T) int {
	t.Helper()
	steps := func(name string) []json.RawMessage {
		raw, err := os.ReadFile(filepath.Join(scenarioDir(t), name+".json")) // #nosec G304 -- test fixture path.
		if err != nil {
			t.Fatal(err)
		}
		var doc struct {
			Steps []json.RawMessage `json:"steps"`
		}
		if err := json.Unmarshal(raw, &doc); err != nil {
			t.Fatal(err)
		}
		return doc.Steps
	}
	decode := func(raw []json.RawMessage) []any {
		out := make([]any, len(raw))
		for i, r := range raw {
			if err := json.Unmarshal(r, &out[i]); err != nil {
				t.Fatal(err)
			}
		}
		return out
	}
	ref, got := steps("bootstrap_citizens"), steps("bootstrap_merchants")
	n := len(ref) - 1
	if len(got) < n || !reflect.DeepEqual(decode(ref[:n]), decode(got[:n])) {
		t.Fatal("bootstrap_merchants does not continue bootstrap_citizens (all steps but its final wait)")
	}
	return n
}

// TestBootstrapMerchants checks golden (bootstrap_merchants), the tier-3
// reference game (D-056, CONTENT §12): it continues the tier 1-2
// reference game bootstrap_citizens step for step (so the tier 1-2
// timings are those of bootstrap_citizens), from the content starting
// stock only; Merchants unlock within 240 minutes, the first Merchant
// house stands within 270, and by 420 every need category of every
// Merchant house (carried ones included) is at least 0.6; no permanent
// insolvency.
func TestBootstrapMerchants(t *testing.T) {
	const name = "bootstrap_merchants"
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
	prefix := merchantsPrefix(t)
	rep := runScenario(t, name)
	checkNoPermanentInsolvency(t, rep)

	unlocked := -1.0
	for _, snap := range rep.Snapshots {
		if slices.Contains(snap.UnlockedTiers, "merchants") {
			unlocked = snapshotMinutes(t, rep, s, snap)
			break
		}
	}
	t.Logf("merchants unlocked by minute %.0f", unlocked)
	if unlocked < 0 || unlocked > 240 {
		t.Errorf("merchants unlocked at minute %.0f (want <= 240)", unlocked)
	}

	// The first upgrade into a Merchant house: an upgrade after the first
	// snapshot with Merchants unlocked whose next snapshot has Merchants.
	first := -1
	for _, snap := range rep.Snapshots {
		if snap.Population["merchants"] > 0 {
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
		t.Fatal("no Merchant house")
	}
	t.Logf("first Merchant house at minute %.0f", minutesAt(t, s, first))
	if minutesAt(t, s, first) > 270 {
		t.Errorf("first Merchant house at minute %.0f (want <= 270)", minutesAt(t, s, first))
	}

	// Every category of every Merchant house >= 0.6: the first advance
	// after the tier 1-2 prefix, in steps of ten advances, at which it
	// holds must be at most minute 420, and it must still hold at the end.
	checkMerchantNeeds := func(ds sim.DisplayState) (houses int, ok bool) {
		ok = true
		for _, is := range ds.Islands {
			for _, b := range is.Buildings {
				if b.Type != "house_merchants" {
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
	if n, ok := checkMerchantNeeds(rep.Final); !ok {
		t.Errorf("at the end, a category of the %d Merchant houses is below 0.6", n)
	}
	advances, total := 0, 0
	for i, st := range s.Steps {
		if st.Advance != nil {
			total++
			if i < prefix {
				advances++
			}
		}
	}
	at := -1.0
	for k := advances; k < total; k += 10 {
		r := runUntilAdvance(t, name, k)
		m := snapshotMinutes(t, r, s, r.Snapshots[len(r.Snapshots)-1])
		if _, ok := checkMerchantNeeds(r.Final); ok {
			at = m
			break
		}
		if m > 420 {
			break
		}
	}
	t.Logf("every Merchant category >= 0.6 by minute %.0f", at)
	if at < 0 || at > 420 {
		t.Errorf("Merchant categories >= 0.6 at minute %.0f (want <= 420)", at)
	}
}
