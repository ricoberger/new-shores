package content

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

// TestLoadPatriciansChains checks the tier-4 goods and production chains
// (D-056 C4, CONTENT §5 and §7): one recipe per building with its inputs,
// cycle, workforce, slot or fertility, cost and upkeep.
func TestLoadPatriciansChains(t *testing.T) {
	c, err := Load(filepath.Join(repoRoot(t), "content", "old_coast"))
	if err != nil {
		t.Fatal(err)
	}
	types := map[string]string{
		"cattle": "raw", "raw_oysters": "raw", "grapes": "raw", "quartz": "raw", "copper_ore": "raw", "gold_ore": "raw",
		"barrels": "intermediate", "malt": "intermediate", "thread": "intermediate", "brass": "intermediate", "gold_bars": "intermediate",
		"glass": "construction", "roast_beef": "food", "oysters": "food", "wine": "drink", "grain_spirit": "drink",
		"fine_garments": "clothing", "lace": "clothing", "candles": "comfort", "spectacles": "comfort", "jewellery": "luxury", "instruments": "luxury",
	}
	for id, typ := range types {
		if g := c.GoodByID[id]; g == nil || g.Type != typ {
			t.Errorf("good %s = %+v, want type %s", id, g, typ)
		}
	}
	// gold is the reserved cost key, never a good (CONTENT §5).
	if c.GoodByID["gold"] != nil {
		t.Error("a good named gold")
	}

	type chain struct {
		in, out   string
		cycleMs   int64
		wfTier    string
		wf        Qty
		fertility string
		deposit   string
		pause     string
		// cost as "gold/planks/stone/bricks/glass" in units, upkeep in gold/min.
		cost   string
		upkeep int64
		smoke  bool
	}
	const ng, im = "need_goods", "intermediate"
	chains := map[string]chain{
		"cattle_farm":      {"", "cattle", 120_000, "settlers", 8000, "", "", im, "410/5/9/6/0", 4, false},
		"slaughterhouse":   {"cattle,salt", "roast_beef", 60_000, "patricians", 8000, "", "", ng, "390/6/6/3/3", 8, true},
		"oyster_beds":      {"", "raw_oysters", 90_000, "settlers", 6000, "", "", im, "480/12/9/6/0", 3, false},
		"oyster_house":     {"raw_oysters,salt", "oysters", 60_000, "patricians", 6000, "", "", ng, "510/6/6/3/6", 10, true},
		"vineyard":         {"", "grapes", 90_000, "settlers", 8000, "grapes", "", im, "330/6/9/3/0", 2, false},
		"cooperage":        {"planks,iron", "barrels", 60_000, "citizens", 8000, "", "", im, "840/9/12/9/6", 7, true},
		"winepress":        {"grapes,barrels", "wine", 60_000, "patricians", 8000, "", "", ng, "540/6/15/6/0", 8, true},
		"malt_house":       {"wheat", "malt", 60_000, "citizens", 6000, "", "", im, "270/6/6/3/0", 2, true},
		"grain_distillery": {"malt,barrels,charcoal|coal", "grain_spirit", 90_000, "patricians", 8000, "", "", ng, "600/6/9/6/6", 5, true},
		"fashion_house":    {"dyed_garments,thread", "fine_garments", 120_000, "patricians", 10_000, "", "", ng, "900/6/9/6/12", 7, false},
		"thread_spinner":   {"hemp", "thread", 45_000, "citizens", 6000, "", "", im, "240/6/0/6/0", 2, false},
		"lace_maker":       {"thread", "lace", 120_000, "patricians", 10_000, "", "", ng, "650/5/3/6/9", 4, false},
		"candle_foundry":   {"tallow,hemp", "candles", 45_000, "patricians", 6000, "", "", ng, "680/5/0/9/9", 12, true},
		"quartz_quarry":    {"", "quartz", 60_000, "citizens", 10_000, "", "quartz", im, "300/6/3/6/0", 4, false},
		"glass_smelter":    {"quartz,charcoal|coal", "glass", 60_000, "citizens", 8000, "", "", im, "270/6/6/3/0", 3, true},
		"copper_mine":      {"", "copper_ore", 60_000, "citizens", 10_000, "", "copper", im, "210/6/3/3/0", 5, false},
		"copper_smelter":   {"copper_ore,charcoal|coal", "brass", 60_000, "citizens", 8000, "", "", im, "740/5/9/9/6", 6, true},
		"optician":         {"glass,brass", "spectacles", 90_000, "patricians", 8000, "", "", ng, "680/5/0/9/9", 12, true},
		"gold_mine":        {"", "gold_ore", 120_000, "citizens", 10_000, "", "gold", im, "210/6/3/3/0", 5, false},
		"gold_smelter":     {"gold_ore,charcoal|coal", "gold_bars", 60_000, "citizens", 8000, "", "", im, "740/5/9/9/6", 6, true},
		"goldsmith":        {"gold_bars", "jewellery", 90_000, "patricians", 6000, "", "", ng, "680/5/0/9/9", 12, true},
		"luthier":          {"planks,brass", "instruments", 120_000, "patricians", 8000, "", "", ng, "870/6/9/9/9", 8, false},
	}
	var tier4 []string
	for _, b := range c.Buildings {
		if b.Tier == "patricians" && b.Recipe != nil {
			tier4 = append(tier4, b.ID)
		}
	}
	if len(tier4) != len(chains) {
		t.Errorf("tier-4 producers %v, want %d", tier4, len(chains))
	}
	for id, w := range chains {
		b := c.BuildingByID[id]
		if b == nil || b.Recipe == nil {
			t.Errorf("%s missing", id)
			continue
		}
		var ins []string
		for _, in := range b.Recipe.Inputs {
			ins = append(ins, strings.Join(in.Goods, "|"))
			want := Qty(1000)
			if id == "winepress" && in.Good == "grapes" {
				want = 2000 // 2 grapes + barrels → wine (CONTENT §5)
			}
			if in.Amount != want {
				t.Errorf("%s input %s amount %d", id, in.Good, in.Amount)
			}
		}
		fert := ""
		if b.WorkArea != nil {
			fert = b.WorkArea.Fertility
		}
		mat := map[string]Qty{}
		for _, m := range b.Cost.Materials {
			mat[m.Good] = m.Amount / 1000
		}
		cost := fmt.Sprintf("%d/%d/%d/%d/%d", b.Cost.Gold/1000, mat["planks"], mat["stone"], mat["bricks"], mat["glass"])
		if b.Tier != "patricians" || !b.RequiresRoad || strings.Join(ins, ",") != w.in || len(b.Recipe.Outputs) != 1 || b.Recipe.Outputs[0].Good != w.out ||
			b.Recipe.Outputs[0].Amount != 1000 || b.Recipe.CycleMs != w.cycleMs || b.Workforce == nil || b.Workforce.Tier != w.wfTier || b.Workforce.Amount != w.wf ||
			fert != w.fertility || b.RequiresDeposit != w.deposit || b.PauseCategory != w.pause || cost != w.cost || b.UpkeepPerMin != w.upkeep*1000 || b.Smoke != w.smoke {
			t.Errorf("%s = recipe %+v workforce %+v work area %+v deposit %q pause %q cost %s upkeep %d smoke %v", id, b.Recipe, b.Workforce, b.WorkArea,
				b.RequiresDeposit, b.PauseCategory, cost, b.UpkeepPerMin, b.Smoke)
		}
		if 360_000%b.Recipe.CycleMs != 0 {
			t.Errorf("%s cycle %d ms does not divide 360 s", id, b.Recipe.CycleMs)
		}
	}
	// Oyster beds: a harbour-slot producer with 4 water rows and a boat loop.
	if ob := c.BuildingByID["oyster_beds"]; ob.WaterTiles != 4 || !ob.Boat || ob.Coastal {
		t.Errorf("oyster_beds = %+v", ob)
	}
	// Fields: the vineyard's 100 vine rows; the cattle farm shares the
	// dairy farm's pasture module (TestShippedFields).
	if v := c.BuildingByID["vineyard"]; v.Fields == nil || v.Fields.Type != "vine_row" || v.Fields.Required != 100 || v.Fields.Max != 100 {
		t.Errorf("vineyard fields %+v", v.Fields)
	}
	if cf := c.BuildingByID["cattle_farm"]; cf.Fields == nil || cf.Fields.Type != "cattle_pasture" || cf.Fields.Required != 5 || cf.Fields.Max != 5 {
		t.Errorf("cattle_farm fields %+v", cf.Fields)
	}
	// The tier-4 deposits: quartz, copper and gold, never on the home island,
	// exactly one gold slot (CONTENT §9).
	pools := map[string]string{}
	for _, d := range c.Islands.Deposits {
		pools[d.ID] = fmt.Sprintf("%d-%d", d.Count.Min, d.Count.Max)
	}
	if pools["quartz"] != "2-4" || pools["copper"] != "1-3" || pools["gold"] != "1-1" {
		t.Errorf("tier-4 deposit pools %v", pools)
	}
	for _, kind := range []string{"quartz", "copper", "gold"} {
		if !slices.Contains(c.Islands.Home.DepositsNone, kind) {
			t.Errorf("home island may get %s", kind)
		}
	}
}

// modelManifest is the part of client/public/models/manifest.json the
// footprint and anchor checks read.
type modelManifest struct {
	Models map[string]struct {
		Footprint struct {
			W int `json:"w"`
			H int `json:"h"`
		} `json:"footprint"`
		Anchors map[string][]float64 `json:"anchors"`
	} `json:"models"`
}

// TestTierFourMatchesPlannedModels: every tier-4 building of the content
// has the footprint, water rows, deposit slot and smoke flag of its
// planned model (assets/build/planned/tier4.json) and of its built model
// (client/public/models/manifest.json): chimney and smoke anchors exactly
// on smoking producers, a boat anchor exactly on boat producers (the
// oyster beds). grain_distillery is not planned: its model is the
// distillery recipe with its own roof (D-041) and the distillery's 5x6.
func TestTierFourMatchesPlannedModels(t *testing.T) {
	c, err := Load(filepath.Join(repoRoot(t), "content", "old_coast"))
	if err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(filepath.Join(repoRoot(t), "assets", "build", "planned", "tier4.json"))
	if err != nil {
		t.Fatal(err)
	}
	var planned []plannedEntry
	if err := json.Unmarshal(data, &planned); err != nil {
		t.Fatal(err)
	}
	data, err = os.ReadFile(filepath.Join(repoRoot(t), "client", "public", "models", "manifest.json"))
	if err != nil {
		t.Fatal(err)
	}
	var manifest modelManifest
	if err := json.Unmarshal(data, &manifest); err != nil {
		t.Fatal(err)
	}
	seen := map[string]bool{}
	for _, p := range planned {
		b := c.BuildingByID[p.ID]
		if b == nil {
			continue // authored in a later step (houses, services)
		}
		seen[p.ID] = true
		if b.Tier != "patricians" || b.Width != p.Footprint[0] || b.Height != p.Footprint[1] || b.WaterTiles != p.WaterTiles ||
			b.RequiresDeposit != p.Slot || b.Smoke != p.Smoke {
			t.Errorf("%s: content %dx%d water %d slot %q smoke %v, planned %+v", p.ID, b.Width, b.Height, b.WaterTiles, b.RequiresDeposit, b.Smoke, p)
		}
	}
	for _, b := range c.Buildings {
		if b.Tier != "patricians" {
			continue
		}
		if !seen[b.ID] && b.ID != "grain_distillery" {
			t.Errorf("%s is not in the planned tier-4 models", b.ID)
		}
		m, ok := manifest.Models[b.ID]
		if !ok || m.Footprint.W != b.Width || m.Footprint.H != b.Height {
			t.Errorf("%s: model footprint %+v (built %v), content %dx%d", b.ID, m.Footprint, ok, b.Width, b.Height)
			continue
		}
		if b.Recipe == nil || b.Field != nil {
			continue
		}
		_, chimney := m.Anchors["chimney"]
		_, smoke := m.Anchors["smoke"]
		_, boat := m.Anchors["boat"]
		if chimney != b.Smoke || smoke != b.Smoke || boat != b.Boat {
			t.Errorf("%s: anchors %v, smoke %v boat %v", b.ID, m.Anchors, b.Smoke, b.Boat)
		}
	}
	if d, gd := c.BuildingByID["distillery"], c.BuildingByID["grain_distillery"]; d.Width != gd.Width || d.Height != gd.Height {
		t.Errorf("grain_distillery %dx%d, distillery %dx%d", gd.Width, gd.Height, d.Width, d.Height)
	}
}
