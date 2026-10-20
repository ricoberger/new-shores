package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"slices"
	"testing"
	"time"

	"github.com/ricoberger/new-shores/server/internal/sim"
	"github.com/ricoberger/new-shores/server/internal/sim/scenario"
)

// TestCitizensUpgradeOverHTTP (R-28) is the acceptance evidence of the
// Citizens upgrade flow, chosen over a long browser flow (gold accrual makes
// that flow long and brittle at E2E time scales): the world of the
// reference game (golden t, scenario bootstrap_citizens) is built up to just
// before its first upgrade_house, served from the in-memory store, and the
// upgrade is issued over HTTP. The Display payload shows the Citizen house
// with its six needs, growth and tax rates, and Citizens in the population.
func TestCitizensUpgradeOverHTTP(t *testing.T) {
	c := catalogue(t)
	s, err := scenario.Load(os.DirFS(filepath.Join(repoRoot(t), "server", "testdata", "scenarios")), "bootstrap_citizens.json")
	if err != nil {
		t.Fatal(err)
	}
	upgrade := slices.IndexFunc(s.Steps, func(st scenario.Step) bool { return st.Upgrade != nil })
	if upgrade < 0 {
		t.Fatal("no upgrade step")
	}
	w, err := scenario.RunSteps(s, c, upgrade)
	if err != nil {
		t.Fatal(err)
	}
	at := s.Steps[upgrade].Upgrade
	islandID := at.Island
	if islandID == "" {
		islandID = s.Islands[0].ID
	}
	house := w.Island(islandID).BuildingAt(c, at.X, at.Y)
	if house == nil || house.Type != "house_settlers" {
		t.Fatalf("no settler house at (%d,%d): %+v", at.X, at.Y, house)
	}
	ts := newTestServerFor(t, w, w.LastEvaluatedAt, 1)

	res := ts.command(fmt.Sprintf(`{"type":"upgrade_house","island_id":%q,"building_id":%d}`, islandID, house.ID), nil)
	if res.status != http.StatusOK {
		t.Fatalf("upgrade_house: %d %s", res.status, res.body)
	}
	check := func(body []byte, wantPopulation bool) {
		t.Helper()
		var wj worldJSON
		if err := json.Unmarshal(body, &wj); err != nil {
			t.Fatal(err)
		}
		var ds sim.DisplayState
		if err := json.Unmarshal(wj.Display, &ds); err != nil {
			t.Fatal(err)
		}
		for _, is := range ds.Islands {
			if is.ID != islandID {
				continue
			}
			for _, b := range is.Buildings {
				if b.ID != house.ID {
					continue
				}
				if b.Type != "house_citizens" || b.Residents == nil || *b.Residents < 5_000 || b.GrowthRatePerMin == nil || b.TaxRatePerMin == nil {
					t.Fatalf("house = %+v", b)
				}
				var needs []string
				for _, n := range b.Needs {
					needs = append(needs, n.Category+n.Building)
				}
				if want := []string{"food", "drink", "clothing", "market_small", "chapel", "tavern"}; !slices.Equal(needs, want) {
					t.Errorf("needs = %v, want %v", needs, want)
				}
				if wantPopulation && *b.TaxRatePerMin <= 0 {
					t.Errorf("tax rate %d", *b.TaxRatePerMin)
				}
			}
			if wantPopulation && is.Population["citizens"] < 5_000 {
				t.Errorf("citizens population %d", is.Population["citizens"])
			}
		}
		if wantPopulation && (ds.TaxRatePerMin <= 0 || !ds.Tiers[1].Unlocked) {
			t.Errorf("tax %d tiers %+v", ds.TaxRatePerMin, ds.Tiers)
		}
	}
	check(res.body, false)
	ts.clock.Add(time.Minute)
	res = ts.do(http.MethodGet, "/api/v1/world", "", true)
	if res.status != http.StatusOK {
		t.Fatalf("GET /world: %d %s", res.status, res.body)
	}
	check(res.body, true)
}
