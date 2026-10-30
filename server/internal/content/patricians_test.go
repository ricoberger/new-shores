package content

import (
	"encoding/json"
	"fmt"
	"math"
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
// planned model (assets/voxel/planned/tier4.json) and of its built model
// (client/public/models/manifest.json): chimney and smoke anchors exactly
// on smoking producers, a boat anchor exactly on boat producers (the
// oyster beds). grain_distillery is not planned: its model is the
// voxel build's placeholder at the distillery's 5x6 (D-057 V1).
func TestTierFourMatchesPlannedModels(t *testing.T) {
	c, err := Load(filepath.Join(repoRoot(t), "content", "old_coast"))
	if err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(filepath.Join(repoRoot(t), "assets", "voxel", "planned", "tier4.json"))
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

// TestLoadPatriciansNeeds checks the Patricians house, needs and services
// ladder (D-056 C4, CONTENT §2): five goods categories at 0.14 each with
// two alternatives, services 0.3 with university and cathedral, the three
// lower tiers' categories at the cumulative rates, and the tier's
// infrastructure (market level 3, trading post level 4, galleon).
func TestLoadPatriciansNeeds(t *testing.T) {
	c, err := Load(filepath.Join(repoRoot(t), "content", "old_coast"))
	if err != nil {
		t.Fatal(err)
	}
	var got []string
	var weights int64
	for _, n := range c.NeedsByTier["patricians"] {
		weights += n.Weight
		if n.Kind != NeedRequired {
			t.Errorf("%s kind %s", n.ID, n.Kind)
		}
		if !n.IsGoods() {
			got = append(got, fmt.Sprintf("%s:%s:%s:%d", n.ID, n.Category, needBuildings(n), n.Weight))
			continue
		}
		var goods []string
		for _, g := range n.Goods {
			goods = append(goods, fmt.Sprintf("%s=%d", g.Good, g.PerResidentPerMin))
			if want := map[bool]int64{true: ShareLone, false: ShareAlternative}[len(n.Goods) == 1]; g.Share != want {
				t.Errorf("%s %s share %d, want %d", n.ID, g.Good, g.Share, want)
			}
		}
		got = append(got, fmt.Sprintf("%s:%s:%s:%d", n.ID, n.Category, strings.Join(goods, "/"), n.Weight))
	}
	want := []string{
		// Own categories: 0.14 each and services 0.3 of the own 0.6.
		"patricians_food:food:roast_beef=5000/oysters=4000:84000", "patricians_drink:drink:wine=4000/grain_spirit=3000:84000",
		"patricians_clothing:clothing:fine_garments=3000/lace=3000:84000", "patricians_comfort:comfort:candles=4000/spectacles=2000:84000",
		"patricians_luxury:luxury:jewellery=1000/instruments=1000:84000",
		"patricians_services:services:market=600000/chapel=600000/tavern=600000/school=600000/church=600000/theatre=600000/university=600000/cathedral=600000:72000",
		// Civic services (D-060), cumulative like services: 0.06 each from services.
		"patricians_safety:safety:city_guard=1000000:36000", "patricians_fire_protection:fire_protection:fire_station=1000000:36000",
		"patricians_health:health:surgery=1000000:36000",
		// Lower tiers: 0.4/3 each, split by their own weights (rounding to the last);
		// rates × (own max / 40) × 0.5^(distance/3), 4 decimals.
		"patricians_settlers_food:food:fish=1000:95237", "patricians_settlers_clothing:clothing:wool_garments=500:38095",
		"patricians_citizens_food:food:bread=1900/cheese=1400:44444", "patricians_citizens_drink:drink:cider=1400/mead=1200:44444",
		"patricians_citizens_clothing:clothing:linen_garments=1200/leather_jerkins=900:44444",
		"patricians_merchants_food:food:sausages=3000/pies=2500:33333", "patricians_merchants_drink:drink:beer=3000/brandy=2000:33333",
		"patricians_merchants_clothing:clothing:coats=2000/dyed_garments=2000:33333",
		"patricians_merchants_comfort:comfort:books=1000/soap=1500:33337",
	}
	if !slices.Equal(got, want) || weights != WeightScale {
		t.Errorf("patricians needs = %v (weights %d), want %v", got, weights, want)
	}

	// Every carried rate follows the formula of CONTENT §2 from the lower
	// tier's own rate: rate × (lower max / 40) × 0.5^(distance/3), rounded
	// to 0.0001 per resident and minute.
	index := map[string]int{}
	for i, tr := range c.Tiers {
		index[tr.ID] = i
	}
	carried := 0
	for _, n := range c.NeedsByTier["patricians"] {
		if n.FromTier == "" {
			continue
		}
		low := c.TierByID[n.FromTier]
		factor := float64(low.ResidentsMax) / 40_000 * math.Pow(0.5, float64(index["patricians"]-index[n.FromTier])/3)
		for _, own := range c.NeedsByTier[n.FromTier] {
			if own.FromTier != "" || own.Category != n.Category {
				continue
			}
			for i, g := range own.Goods {
				want := int64(math.Round(float64(g.PerResidentPerMin)*factor/100)) * 100
				if i >= len(n.Goods) || n.Goods[i].Good != g.Good || n.Goods[i].PerResidentPerMin != want {
					t.Errorf("%s %s: carried %+v, want %d", n.ID, g.Good, n.Goods, want)
				}
				carried++
			}
		}
	}
	if carried != 16 {
		t.Errorf("%d carried goods, want 16", carried)
	}

	hp := c.BuildingByID["house_patricians"]
	if hp == nil || hp.House == nil || hp.House.Tier != "patricians" || hp.Width != 3 || hp.Height != 3 || hp.PauseCategory != "never" || hp.UpkeepPerMin != 0 ||
		fmt.Sprint(hp.Cost.Gold, hp.Cost.Materials) != "1000000 [{bricks 3000} {glass 3000} {planks 5000} {stone 3000}]" {
		t.Errorf("house_patricians = %+v", hp)
	}
	if tr := c.TierByID["patricians"]; tr.House != "house_patricians" {
		t.Errorf("patricians house %q", tr.House)
	}
	// The full services ladder (CONTENT §2): radius per public building, by tier.
	ladder := map[string]string{
		"market": "settlers:12", "chapel": "settlers:16", "tavern": "citizens:14", "school": "citizens:16",
		"church": "merchants:20", "theatre": "merchants:24", "university": "patricians:24", "cathedral": "patricians:28",
	}
	for id, w := range ladder {
		b := c.BuildingByID[id]
		if b == nil || b.Service == nil || fmt.Sprintf("%s:%d", b.Tier, b.Service.RadiusAt(1)) != w || !b.RequiresRoad {
			t.Errorf("%s service = %+v, want %s", id, b, w)
		}
	}
	for id, w := range map[string]string{
		"university": "50000000 [{bricks 60000} {planks 45000} {stone 45000}] 45000",
		"cathedral":  "60000000 [{bricks 60000} {glass 30000} {planks 15000} {stone 60000}] 30000",
	} {
		b := c.BuildingByID[id]
		if b.Upgradable() || b.PauseCategory != "public" || fmt.Sprint(b.Cost.Gold, b.Cost.Materials, b.UpkeepPerMin) != w {
			t.Errorf("%s = %+v", id, b)
		}
	}
	// The market's level 3 is the Patricians' (radius 20); the trading post's
	// level 4 holds 1200 with 4 berths (CONTENT §7).
	if m := c.BuildingByID["market"]; m.LevelCount() != 3 || m.Service.RadiusAt(3) != 20 || m.LevelTier(3) != "patricians" {
		t.Errorf("market level 3 = %d %s", m.Service.RadiusAt(3), m.LevelTier(3))
	}
	if tp := c.BuildingByID["trading_post"]; tp.LevelCount() != 4 || fmt.Sprint(tp.LevelCost(4).Gold, tp.LevelCost(4).Materials) != "1200000 [{planks 40000} {stone 30000} {tools 10000}]" {
		t.Errorf("trading_post level 4 = %+v", tp.LevelCost(4))
	}
	// The galleon is the Patricians' ship, built at the shipyard.
	if g := c.ShipByID["galleon"]; g == nil || g.Tier != "patricians" || g.Slots != 6 || g.SlotSize != 60_000 || g.LengthMilliTiles != 3200 ||
		!slices.Contains(c.BuildingByID["shipyard"].Shipyard.Ships, "galleon") {
		t.Errorf("galleon = %+v", g)
	}
}

// TestPatriciansQuests pins the tier-4 quest chain (D-056 C4): cathedral
// at the Patricians' unlock, first Patrician house, both food and both
// drink alternatives, stored glass and a galleon (a per-type ship_count),
// with modest gold rewards only (D-022).
func TestPatriciansQuests(t *testing.T) {
	c, err := Load(filepath.Join(repoRoot(t), "content", "old_coast"))
	if err != nil {
		t.Fatal(err)
	}
	want := map[string]string{
		"patricians_cathedral": "tier_unlocked:patricians:0 connected:cathedral:0",
		"patricians_house":     "building_count:house_patricians:1",
		"patricians_food":      "connected:slaughterhouse:0 connected:oyster_house:0",
		"patricians_drink":     "connected:winepress:0 connected:grain_distillery:0",
		"patricians_glass":     "stock:glass:30000",
		"patricians_galleon":   "ship_count:galleon:1",
	}
	n := 0
	for _, q := range c.Quests {
		if !strings.HasPrefix(q.ID, "patricians_") {
			continue
		}
		n++
		var objs []string
		for _, o := range q.Objectives {
			objs = append(objs, fmt.Sprintf("%s:%s:%d", o.Kind, o.Building+o.Good+o.Tier+o.Ship, o.Min))
			if o.Kind == ObjectiveShipCount && o.Building != "" {
				t.Errorf("%s: ship_count with building %q", q.ID, o.Building)
			}
		}
		if got := strings.Join(objs, " "); got != want[q.ID] || len(q.Rewards.Goods) != 0 || q.Rewards.Gold < 100_000 || q.Rewards.Gold > 250_000 {
			t.Errorf("%s = %s, rewards %+v", q.ID, got, q.Rewards)
		}
	}
	if n != len(want) {
		t.Errorf("%d patricians quests, want %d", n, len(want))
	}
	// The earlier chains keep counting every ship.
	for _, id := range []string{"citizens_sloop", "merchants_brig"} {
		if q := c.QuestByID[id]; q == nil || q.Objectives[0].Kind != ObjectiveShipCount || q.Objectives[0].Ship != "" {
			t.Errorf("%s = %+v", id, q)
		}
	}
}
