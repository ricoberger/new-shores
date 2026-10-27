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

	"github.com/ricoberger/new-shores/server/internal/content"
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
	c := shippedCatalogue(t)
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
		islandID = w.Islands[0].ID
	}
	house := w.Island(islandID).BuildingAt(c, at.X, at.Y)
	if house == nil || house.Type != "house_settlers" {
		t.Fatalf("no settler house at (%d,%d): %+v", at.X, at.Y, house)
	}
	tavernX, tavernY := roadSite(t, c, w, islandID, "tavern", house)
	ts := newTestServerWith(t, w, w.LastEvaluatedAt, 1, c)

	res := ts.command(fmt.Sprintf(`{"type":"upgrade_house","island_id":%q,"building_id":%d}`, islandID, house.ID), nil)
	if res.status != http.StatusOK {
		t.Fatalf("upgrade_house: %d %s", res.status, res.body)
	}
	check := func(body []byte, wantPopulation bool) sim.BuildingDisplay {
		t.Helper()
		var wj worldJSON
		if err := json.Unmarshal(body, &wj); err != nil {
			t.Fatal(err)
		}
		var ds sim.DisplayState
		if err := json.Unmarshal(wj.Display, &ds); err != nil {
			t.Fatal(err)
		}
		var found sim.BuildingDisplay
		for _, is := range ds.Islands {
			if is.ID != islandID {
				continue
			}
			for _, b := range is.Buildings {
				if b.ID != house.ID {
					continue
				}
				if b.Type != "house_citizens" || b.Residents == nil || *b.Residents < 5_000 || b.GrowthRatePerMin == nil || b.TaxRatePerMin == nil ||
					b.SatisfactionPermille == nil {
					t.Fatalf("house = %+v", b)
				}
				var needs []string
				for _, n := range b.Needs {
					needs = append(needs, n.Category+n.Building)
				}
				// Own categories, then the Settlers' food and clothing
				// (cumulative tiers, D-056).
				if want := []string{"food", "drink", "clothing", "market_small", "chapel", "tavern", "food", "clothing"}; !slices.Equal(needs, want) {
					t.Errorf("needs = %v, want %v", needs, want)
				}
				if wantPopulation && *b.TaxRatePerMin <= 0 {
					t.Errorf("tax rate %d", *b.TaxRatePerMin)
				}
				found = b
			}
			if wantPopulation && is.Population["citizens"] < 5_000 {
				t.Errorf("citizens population %d", is.Population["citizens"])
			}
		}
		if wantPopulation && (ds.TaxRatePerMin <= 0 || !ds.Tiers[1].Unlocked) {
			t.Errorf("tax %d tiers %+v", ds.TaxRatePerMin, ds.Tiers)
		}
		return found
	}
	check(res.body, false)
	ts.clock.Add(time.Minute)
	res = ts.do(http.MethodGet, "/api/v1/world", "", true)
	if res.status != http.StatusOK {
		t.Fatalf("GET /world: %d %s", res.status, res.body)
	}
	// Right after the upgrade only market and chapel are in reach, plus
	// the Settlers' fish and wool garments of the town (D-056: 0.4 of
	// satisfaction): 0.06 + 0.09 + 0.4 = 0.55, just above the growth
	// threshold; the house pays Citizens tax.
	floor := check(res.body, true)
	if *floor.SatisfactionPermille != 550 || *floor.GrowthRatePerMin != 550 {
		t.Errorf("floor house: satisfaction %d growth %d", *floor.SatisfactionPermille, *floor.GrowthRatePerMin)
	}

	// Supply every Citizens need: bread, cider and linen garments arrive
	// (seeded into the stored world like a delivery), and a tavern is
	// built over HTTP next to the house. After a clock advance the house
	// is fully satisfied and grows.
	ts.mutateWorld(func(world *sim.World) {
		world.Gold += 1_000_000
		for good, n := range map[string]sim.Qty{"bread": 50_000, "cider": 50_000, "linen_garments": 50_000, "stone": 20_000, "planks": 30_000} {
			if err := sim.AddStock(world, c, islandID, good, n, nil); err != nil {
				t.Fatal(err)
			}
		}
	})
	res = ts.command(fmt.Sprintf(`{"type":"place_building","island_id":%q,"building_type":"tavern","x":%d,"y":%d,"rotation":0}`, islandID, tavernX, tavernY), nil)
	if res.status != http.StatusOK {
		t.Fatalf("place tavern: %d %s", res.status, res.body)
	}
	ts.clock.Add(30 * time.Second)
	res = ts.do(http.MethodGet, "/api/v1/world", "", true)
	if res.status != http.StatusOK {
		t.Fatalf("GET /world: %d %s", res.status, res.body)
	}
	supplied := check(res.body, true)
	if *supplied.SatisfactionPermille != 1000 || *supplied.GrowthRatePerMin <= 0 || *supplied.TaxRatePerMin <= *floor.TaxRatePerMin {
		t.Errorf("supplied house: satisfaction %d growth %d tax %d (floor tax %d)", *supplied.SatisfactionPermille,
			*supplied.GrowthRatePerMin, *supplied.TaxRatePerMin, *floor.TaxRatePerMin)
	}
	for _, n := range supplied.Needs {
		if n.FulfilmentPermille != 1000 {
			t.Errorf("need %s fulfilment %d (%s)", n.ID, n.FulfilmentPermille, n.Reason)
		}
	}
	// Two more minutes: the house has gained residents.
	ts.clock.Add(2 * time.Minute)
	res = ts.do(http.MethodGet, "/api/v1/world", "", true)
	if grown := check(res.body, true); *grown.Residents <= *supplied.Residents {
		t.Errorf("residents %d -> %d", *supplied.Residents, *grown.Residents)
	}
}

// roadSite returns the valid site (rotation 0) of a building type nearest
// to building near with a road next to it.
func roadSite(t *testing.T, c *content.Catalogue, w *sim.World, islandID, typ string, near *sim.Building) (int, int) {
	t.Helper()
	is := w.Island(islandID)
	def := c.BuildingByID[typ]
	bestX, bestY, bestD := 0, 0, -1
	for y := 0; y+def.Height <= is.Height; y++ {
		for x := 0; x+def.Width <= is.Width; x++ {
			d := (x-near.X)*(x-near.X) + (y-near.Y)*(y-near.Y)
			if (bestD >= 0 && d >= bestD) || sim.CheckSite(is, c, def, x, y, 0) != nil {
				continue
			}
			road := false
			for ty := y - 1; ty <= y+def.Height; ty++ {
				for tx := x - 1; tx <= x+def.Width; tx++ {
					inside := tx >= x && tx < x+def.Width && ty >= y && ty < y+def.Height
					diagonal := (tx < x || tx >= x+def.Width) && (ty < y || ty >= y+def.Height)
					road = road || (!inside && !diagonal && is.InBounds(tx, ty) && is.RoadAt(tx, ty) != "")
				}
			}
			if road {
				bestX, bestY, bestD = x, y, d
			}
		}
	}
	if bestD < 0 {
		t.Fatalf("no %s site next to a road on %s", typ, islandID)
	}
	return bestX, bestY
}
