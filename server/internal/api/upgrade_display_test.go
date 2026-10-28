package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/ricoberger/new-shores/server/internal/sim"
	"github.com/ricoberger/new-shores/server/internal/sim/scenario"
)

// TestHouseUpgradeDisplayOverHTTP checks the upgrade block of a house in
// GET /world (D-027: the server evaluates the gate, the client only shows
// it): one house of the reference game just before its first upgrade, in
// each state of the gate. The block must agree with the command: available
// exactly when upgrade_house succeeds, otherwise the reason names the
// condition the command fails with.
func TestHouseUpgradeDisplayOverHTTP(t *testing.T) {
	c := shippedCatalogue(t)
	s, err := scenario.Load(os.DirFS(filepath.Join(repoRoot(t), "server", "testdata", "scenarios")), "bootstrap_citizens.json")
	if err != nil {
		t.Fatal(err)
	}
	step := slices.IndexFunc(s.Steps, func(st scenario.Step) bool { return st.Upgrade != nil })
	if step < 0 {
		t.Fatal("no upgrade step")
	}
	base, err := scenario.RunSteps(s, c, step)
	if err != nil {
		t.Fatal(err)
	}
	at := s.Steps[step].Upgrade
	islandID := at.Island
	if islandID == "" {
		islandID = base.Islands[0].ID
	}
	houseID := base.Island(islandID).BuildingAt(c, at.X, at.Y).ID
	citizensCost := c.BuildingByID["house_citizens"].Cost

	cases := []struct {
		name string
		// mutate puts the house into the state.
		mutate func(w *sim.World, h *sim.Building)
		want   string // the reason; "" when available
		code   string // the error code of upgrade_house; "" when it succeeds
	}{
		{"available", func(*sim.World, *sim.Building) {}, "", ""},
		{"tier_locked", func(_ *sim.World, h *sim.Building) {
			// A full Citizen house: Merchants are not unlocked yet.
			h.Type, h.House.Residents = "house_citizens", c.TierByID["citizens"].ResidentsMax
		}, sim.UpgradeTierLocked, "tier_locked"},
		{"not_full", func(_ *sim.World, h *sim.Building) { h.House.Residents -= 1000 }, sim.UpgradeNotFull, "house_not_full"},
		{"needs_below_threshold", func(w *sim.World, _ *sim.Building) {
			// No fish in stock, in transit or coming: the food need fails.
			is := w.Island(islandID)
			delete(is.Inventory.Stock, "fish")
			delete(is.Inventory.StockSub, "fish")
			for _, b := range is.Buildings {
				b.Transit = nil
				b.Paused = b.Paused || b.Type == "fisher"
			}
		}, sim.UpgradeNeedsBelowThreshold + ":food:60", "needs_unmet"},
		{"cannot_afford", func(w *sim.World, _ *sim.Building) {
			w.Gold = 0
			for _, m := range citizensCost.Materials {
				delete(w.Island(islandID).Inventory.Stock, m.Good)
				delete(w.Island(islandID).Inventory.StockSub, m.Good)
			}
		}, sim.UpgradeCannotAfford, "insufficient_gold"},
		{"no_house", func(_ *sim.World, h *sim.Building) {
			// A full Patrician house: there is no next tier.
			h.Type, h.House.Residents = "house_patricians", c.TierByID["patricians"].ResidentsMax
		}, sim.UpgradeNoHouse, "upgrade_unavailable"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			w := base.Clone()
			tc.mutate(w, w.Island(islandID).Building(houseID))
			ts := newTestServerWith(t, w, w.LastEvaluatedAt, 1, c)
			res := ts.do(http.MethodGet, "/api/v1/world", "", true)
			if res.status != http.StatusOK {
				t.Fatalf("GET /world: %d %s", res.status, res.body)
			}
			var wj worldJSON
			if err := json.Unmarshal(res.body, &wj); err != nil {
				t.Fatal(err)
			}
			var ds sim.DisplayState
			if err := json.Unmarshal(wj.Display, &ds); err != nil {
				t.Fatal(err)
			}
			var got *sim.UpgradeDisplay
			for _, is := range ds.Islands {
				for _, b := range is.Buildings {
					if b.Residents != nil && b.Upgrade == nil {
						t.Errorf("house %d on %s has no upgrade block", b.ID, is.ID)
					}
					if is.ID == islandID && b.ID == houseID {
						got = b.Upgrade
					}
				}
			}
			want := &sim.UpgradeDisplay{Available: tc.want == "", Reason: tc.want}
			if got == nil || *got != *want {
				t.Fatalf("upgrade = %+v, want %+v", got, want)
			}
			cmd := ts.command(fmt.Sprintf(`{"type":"upgrade_house","island_id":%q,"building_id":%d}`, islandID, houseID), nil)
			switch {
			case tc.code == "" && cmd.status != http.StatusOK:
				t.Errorf("upgrade_house failed although available: %d %s", cmd.status, cmd.body)
			case tc.code != "" && (cmd.status == http.StatusOK || !strings.HasPrefix(errorCode(t, cmd), tc.code)):
				t.Errorf("upgrade_house: %d %s, want error %s", cmd.status, cmd.body, tc.code)
			}
		})
	}
}

// TestHouseUpgradeFlipsAtNextChange checks that a house short of gold only
// becomes upgradable at the payload's next_change_at: a flip by gold
// crossing the cost has no boundary of its own, so the display must hand
// the client a moment to re-fetch at (D-027).
func TestHouseUpgradeFlipsAtNextChange(t *testing.T) {
	c := shippedCatalogue(t)
	s, err := scenario.Load(os.DirFS(filepath.Join(repoRoot(t), "server", "testdata", "scenarios")), "bootstrap_citizens.json")
	if err != nil {
		t.Fatal(err)
	}
	step := slices.IndexFunc(s.Steps, func(st scenario.Step) bool { return st.Upgrade != nil })
	w, err := scenario.RunSteps(s, c, step)
	if err != nil {
		t.Fatal(err)
	}
	at := s.Steps[step].Upgrade
	islandID := at.Island
	if islandID == "" {
		islandID = w.Islands[0].ID
	}
	houseID := w.Island(islandID).BuildingAt(c, at.X, at.Y).ID
	w.Gold = c.BuildingByID["house_citizens"].Cost.Gold - 1
	ts := newTestServerWith(t, w, w.LastEvaluatedAt, 1, c)
	display := func() sim.DisplayState {
		t.Helper()
		res := ts.do(http.MethodGet, "/api/v1/world", "", true)
		var wj worldJSON
		if err := json.Unmarshal(res.body, &wj); err != nil {
			t.Fatal(err)
		}
		var ds sim.DisplayState
		if err := json.Unmarshal(wj.Display, &ds); err != nil {
			t.Fatal(err)
		}
		return ds
	}
	upgrade := func(ds sim.DisplayState) sim.UpgradeDisplay {
		for _, is := range ds.Islands {
			for _, b := range is.Buildings {
				if is.ID == islandID && b.ID == houseID {
					return *b.Upgrade
				}
			}
		}
		t.Fatal("house not found")
		return sim.UpgradeDisplay{}
	}
	before := display()
	if u := upgrade(before); u.Available || u.Reason != sim.UpgradeCannotAfford {
		t.Fatalf("before: %+v", u)
	}
	if before.NextChangeAt == nil || before.BalanceRatePerMin <= 0 {
		t.Fatalf("next_change_at %v, balance %d", before.NextChangeAt, before.BalanceRatePerMin)
	}
	next, err := time.Parse(time.RFC3339, *before.NextChangeAt)
	if err != nil {
		t.Fatal(err)
	}
	evaluated, err := time.Parse(time.RFC3339, before.EvaluatedAt)
	if err != nil {
		t.Fatal(err)
	}
	// One millisecond earlier the house is still short, at next_change_at it
	// is upgradable.
	ts.clock.Add(next.Sub(evaluated) - time.Millisecond)
	if u := upgrade(display()); u.Available {
		t.Errorf("1 ms before next_change_at: %+v", u)
	}
	ts.clock.Add(time.Millisecond)
	if u := upgrade(display()); !u.Available {
		t.Errorf("at next_change_at: %+v", u)
	}
}
