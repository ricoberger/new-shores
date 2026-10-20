package content

import (
	"fmt"
	"maps"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

// TestLoadCitizensContent checks the tier-2 content (R-1 – R-7): needs,
// capability blocks of the new buildings and the warehouse level 2.
func TestLoadCitizensContent(t *testing.T) {
	c, err := Load(filepath.Join(repoRoot(t), "content", "old_coast"))
	if err != nil {
		t.Fatal(err)
	}
	types := map[string]string{
		"wheat": "raw", "flour": "intermediate", "bread": "food", "apples": "raw", "cider": "drink", "hemp": "raw",
		"linen_garments": "clothing", "stone": "construction", "iron_ore": "raw", "charcoal": "intermediate", "iron": "intermediate",
		"tools": "construction",
	}
	for id, typ := range types {
		if g := c.GoodByID[id]; g == nil || g.Type != typ {
			t.Errorf("good %s = %+v, want type %s", id, g, typ)
		}
	}

	needs := c.NeedsByTier["citizens"]
	var got []string
	var weights int64
	for _, n := range needs {
		weights += n.Weight
		if n.Kind != NeedRequired {
			t.Errorf("%s kind %s", n.ID, n.Kind)
		}
		if n.IsGoods() {
			got = append(got, fmt.Sprintf("%s:%s:%s:%d:%d", n.ID, n.Category, n.Goods[0].Good, n.Goods[0].PerResidentPerMin, n.Weight))
			if len(n.Goods) != 1 || n.VarietyBonus != 100_000 || n.MaxExtraGoods != 2 {
				t.Errorf("%s = %+v", n.ID, n)
			}
		} else {
			got = append(got, fmt.Sprintf("%s:%s:%d:%d", n.ID, n.Building, n.Radius, n.Weight))
		}
	}
	want := []string{
		"citizens_food:food:bread:8:200000", "citizens_drink:drink:cider:6:200000", "citizens_clothing:clothing:linen_garments:5:200000",
		"citizens_market_small:market_small:12:100000", "citizens_chapel:chapel:16:150000", "citizens_tavern:tavern:14:150000",
	}
	if !slices.Equal(got, want) || weights != WeightScale {
		t.Errorf("citizens needs = %v (weights %d), want %v", got, weights, want)
	}
	// D-012: the Settlers' needs are unchanged.
	if n := c.NeedsByTier["settlers"]; len(n) != 3 || n[0].Goods[0].Good != "fish" || n[1].Goods[0].Good != "wool_garments" || n[2].Building != "market_small" {
		t.Errorf("settlers needs changed: %+v", n)
	}

	hc := c.BuildingByID["house_citizens"]
	if hc.House == nil || hc.House.Tier != "citizens" || hc.Width != 2 || hc.Height != 2 || hc.PauseCategory != "never" || hc.UpkeepPerMin != 0 {
		t.Errorf("house_citizens = %+v", hc)
	}
	if r := c.BuildingByID["road_paved"]; r.Road == nil || r.Road.MsPerTile != 600 || r.Tier != "citizens" {
		t.Errorf("road_paved = %+v", r)
	}
	if tv := c.BuildingByID["tavern"]; tv.Service == nil || tv.Service.Radius != 14 || tv.PauseCategory != "public" || !tv.RequiresRoad {
		t.Errorf("tavern = %+v", tv)
	}

	type chain struct {
		in, out   string
		cycleMs   int64
		wfTier    string
		wf        Qty
		fertility string
		deposit   string
		pause     string
	}
	chains := map[string]chain{
		"wheat_farm":      {"", "wheat", 60_000, "settlers", 6000, "wheat", "", "intermediate"},
		"mill":            {"wheat", "flour", 30_000, "citizens", 4000, "", "", "intermediate"},
		"bakery":          {"flour", "bread", 60_000, "citizens", 6000, "", "", "need_goods"},
		"orchard":         {"", "apples", 90_000, "settlers", 6000, "apple", "", "intermediate"},
		"cidery":          {"apples", "cider", 45_000, "citizens", 6000, "", "", "need_goods"},
		"hemp_farm":       {"", "hemp", 60_000, "settlers", 6000, "hemp", "", "intermediate"},
		"weaver_linen":    {"hemp", "linen_garments", 45_000, "citizens", 6000, "", "", "need_goods"},
		"sailmaker":       {"hemp", "sails", 60_000, "citizens", 6000, "", "", "intermediate"},
		"quarry":          {"", "stone", 45_000, "settlers", 8000, "", "stone", "intermediate"},
		"iron_mine":       {"", "iron_ore", 60_000, "settlers", 10_000, "", "iron", "intermediate"},
		"charcoal_burner": {"wood", "charcoal", 45_000, "settlers", 4000, "", "", "intermediate"},
		"smelter":         {"iron_ore,charcoal", "iron", 60_000, "settlers", 8000, "", "", "intermediate"},
		"toolmaker":       {"iron", "tools", 60_000, "settlers", 8000, "", "", "intermediate"},
	}
	for id, w := range chains {
		b := c.BuildingByID[id]
		var ins []string
		for _, in := range b.Recipe.Inputs {
			ins = append(ins, in.Good)
		}
		fert := ""
		if b.WorkArea != nil {
			fert = b.WorkArea.Fertility
		}
		if b.Tier != "citizens" || !b.RequiresRoad || strings.Join(ins, ",") != w.in || b.Recipe.Outputs[0].Good != w.out || b.Recipe.CycleMs != w.cycleMs ||
			b.Workforce.Tier != w.wfTier || b.Workforce.Amount != w.wf || fert != w.fertility || b.RequiresDeposit != w.deposit || b.PauseCategory != w.pause {
			t.Errorf("%s = %+v recipe %+v workforce %+v work area %+v", id, b, b.Recipe, b.Workforce, b.WorkArea)
		}
		// Every cycle divides 360 s so that rates are exact (MECHANICS §1.1).
		if 360_000%b.Recipe.CycleMs != 0 {
			t.Errorf("%s cycle %d ms does not divide 360 s", id, b.Recipe.CycleMs)
		}
	}

	wh := c.BuildingByID["warehouse"].Warehouse
	if len(wh.Levels) != 2 || wh.Levels[0].Cost != nil || wh.Levels[1].Capacity != 500_000 || wh.Levels[1].ThroughputPerMin != 90_000 || wh.Levels[1].Cost == nil {
		t.Fatalf("warehouse levels = %+v", wh.Levels)
	}
	if lc := wh.Levels[1].Cost; lc.Gold <= 0 || len(lc.Materials) == 0 {
		t.Errorf("level 2 cost = %+v", lc)
	}
}

// TestLoadRejectsInvalidTierTwoFormat covers the format additions of R-5
// and R-6: level costs, requires_deposit and work_area.fertility.
func TestLoadRejectsInvalidTierTwoFormat(t *testing.T) {
	schemaDir := filepath.Join(repoRoot(t), "content", "schema")
	tests := []struct {
		name    string
		replace []string
		want    []string
	}{
		{
			"cost on the first level",
			[]string{`{ "capacity": 300, "throughput_per_min": 60 }`, `{ "capacity": 300, "throughput_per_min": 60, "cost": { "gold": 1 } }`},
			[]string{FileBuildings, `building "warehouse"`, "warehouse.levels[0].cost", "first level has no cost"},
		},
		{
			"missing cost on a later level",
			[]string{`"throughput_per_min": 90,
          "cost": { "gold": 300, "planks": 20, "stone": 10 }`, `"throughput_per_min": 90`},
			[]string{FileBuildings, `building "warehouse"`, "warehouse.levels[1].cost", "upgrade level needs a cost"},
		},
		{
			"unknown good in a level cost",
			[]string{`"cost": { "gold": 300, "planks": 20, "stone": 10 }`, `"cost": { "gold": 300, "marble": 20 }`},
			[]string{FileBuildings, `building "warehouse"`, "cost.marble", `unknown good "marble"`},
		},
		{
			"deposit without recipe",
			[]string{`"service": { "radius": 14 }`, `"service": { "radius": 14 },
    "requires_deposit": "stone"`},
			[]string{FileBuildings, `building "tavern"`, "requires_deposit", "recipe"},
		},
		{
			"deposit with an invalid id",
			[]string{`"requires_deposit": "stone"`, `"requires_deposit": "Stone"`},
			[]string{FileBuildings, `building "quarry"`, "schema violation"},
		},
		{
			"fertility outside the work area",
			[]string{`"service": { "radius": 14 }`, `"service": { "radius": 14 },
    "fertility": "wheat"`},
			[]string{FileBuildings, `building "tavern"`, "schema violation"},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			dir := copyContent(t, FileBuildings, tt.replace...)
			_, err := LoadWithSchemas(dir, schemaDir)
			if err == nil {
				t.Fatal("Load succeeded, want error")
			}
			for _, w := range tt.want {
				if !strings.Contains(err.Error(), w) {
					t.Errorf("error %q does not contain %q", err, w)
				}
			}
		})
	}
}

// bootstrapProblems checks the bootstrap rule (MECHANICS §4, CONTENT §12,
// R-25) generically over a catalogue. For every tier n with a house:
//
//   - closure: the goods of the house cost, closed over the recipe inputs
//     of their producers and the construction materials of those
//     producers;
//   - every producer in the closure needs a workforce of a tier with index
//     < n (or none);
//   - every good in the closure has a producer or is in the starting stock;
//   - reachability: starting from the starting-stock goods, repeatedly
//     "build" producers of tier <= n staffed below n whose cost materials
//     and inputs are available; all house-cost goods become available.
//
// The first tier has nobody below it: its house materials must be in the
// starting stock (the first houses are built from it).
func bootstrapProblems(c *Catalogue) []string {
	producers := map[string][]*Building{}
	for _, b := range c.Buildings {
		if b.Recipe == nil {
			continue
		}
		for _, out := range b.Recipe.Outputs {
			producers[out.Good] = append(producers[out.Good], b)
		}
	}
	start := map[string]bool{}
	for _, g := range c.Start.Goods {
		start[g.Good] = true
	}
	tierIndex := func(id string) int {
		if t := c.TierByID[id]; t != nil {
			return t.Index
		}
		return len(c.Tiers)
	}

	var problems []string
	for _, tier := range c.Tiers {
		house := c.BuildingByID[tier.House]
		if house == nil {
			continue // declared-only tier
		}
		n := tier.Index
		var houseGoods []string
		for _, m := range house.Cost.Materials {
			houseGoods = append(houseGoods, m.Good)
		}
		if n == 0 {
			for _, g := range houseGoods {
				if !start[g] {
					problems = append(problems, fmt.Sprintf("%s: first-tier house material %s is not in the starting stock", tier.ID, g))
				}
			}
			continue
		}

		// Closure over producers' inputs and construction materials.
		closure := map[string]bool{}
		queue := slices.Clone(houseGoods)
		seenProducer := map[string]bool{}
		for len(queue) > 0 {
			g := queue[0]
			queue = queue[1:]
			if closure[g] {
				continue
			}
			closure[g] = true
			if len(producers[g]) == 0 && !start[g] {
				problems = append(problems, fmt.Sprintf("%s: %s has no producer and is not in the starting stock", tier.ID, g))
			}
			for _, p := range producers[g] {
				if !seenProducer[p.ID] {
					seenProducer[p.ID] = true
					if p.Workforce != nil && tierIndex(p.Workforce.Tier) >= n {
						problems = append(problems, fmt.Sprintf("%s: producer %s of %s is staffed by %s", tier.ID, p.ID, g, p.Workforce.Tier))
					}
				}
				for _, in := range p.Recipe.Inputs {
					queue = append(queue, in.Good)
				}
				for _, m := range p.Cost.Materials {
					queue = append(queue, m.Good)
				}
			}
		}

		// Reachability from the starting stock.
		avail := maps.Clone(start)
		for changed := true; changed; {
			changed = false
			for _, b := range c.Buildings {
				if b.Recipe == nil || tierIndex(b.Tier) > n || (b.Workforce != nil && tierIndex(b.Workforce.Tier) >= n) {
					continue
				}
				ok := true
				for _, m := range b.Cost.Materials {
					ok = ok && avail[m.Good]
				}
				for _, in := range b.Recipe.Inputs {
					ok = ok && avail[in.Good]
				}
				if !ok {
					continue
				}
				for _, out := range b.Recipe.Outputs {
					if !avail[out.Good] {
						avail[out.Good], changed = true, true
					}
				}
			}
		}
		for _, g := range houseGoods {
			if !avail[g] {
				problems = append(problems, fmt.Sprintf("%s: house material %s is not reachable from the starting stock", tier.ID, g))
			}
		}
	}
	return problems
}

// TestBootstrapRule (R-25) runs the generic bootstrap check over the
// shipped and the variety test content, and over a broken in-memory
// catalogue with a Citizens-staffed quarry.
func TestBootstrapRule(t *testing.T) {
	schemaDir := filepath.Join(repoRoot(t), "content", "schema")
	for _, dir := range []string{
		filepath.Join(repoRoot(t), "content", "old_coast"),
		filepath.Join(repoRoot(t), "server", "testdata", "content", "old_coast_variety"),
	} {
		c, err := LoadWithSchemas(dir, schemaDir)
		if err != nil {
			t.Fatal(err)
		}
		if p := bootstrapProblems(c); len(p) != 0 {
			t.Errorf("%s: %v", filepath.Base(dir), p)
		}
	}

	c, err := Load(filepath.Join(repoRoot(t), "content", "old_coast"))
	if err != nil {
		t.Fatal(err)
	}
	c.BuildingByID["quarry"].Workforce = &Workforce{Tier: "citizens", Amount: 8000}
	p := bootstrapProblems(c)
	if len(p) == 0 || !strings.Contains(strings.Join(p, "\n"), "producer quarry of stone is staffed by citizens") ||
		!strings.Contains(strings.Join(p, "\n"), "stone is not reachable") {
		t.Errorf("citizens-staffed quarry: %v", p)
	}

	c, err = Load(filepath.Join(repoRoot(t), "content", "old_coast"))
	if err != nil {
		t.Fatal(err)
	}
	c.Start.Goods = nil
	if p := bootstrapProblems(c); !strings.Contains(strings.Join(p, "\n"), "first-tier house material planks") {
		t.Errorf("no starting planks: %v", p)
	}
}
