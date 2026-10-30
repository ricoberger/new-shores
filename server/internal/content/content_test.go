package content

import (
	"encoding/json"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

// repoRoot returns the repository root independent of the working directory.
func repoRoot(t *testing.T) string {
	t.Helper()
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller failed")
	}
	// file = <root>/server/internal/content/content_test.go
	return filepath.Join(filepath.Dir(file), "..", "..", "..")
}

func TestLoadOldCoast(t *testing.T) {
	c, err := Load(filepath.Join(repoRoot(t), "content", "old_coast"))
	if err != nil {
		t.Fatalf("Load: %v", err)
	}

	if c.Region.ID != "old_coast" || c.Region.Version == "" {
		t.Errorf("region = %+v", c.Region)
	}
	rules := c.Region.Rules
	if rules.TransferBaseMs != 10_000 || rules.UnconnectedBuffer != 5_000 || rules.IterationCap != 10_000 || rules.CoarseStepMs != 60_000 {
		t.Errorf("rules = %+v", rules)
	}
	if rules.GrowthPerMin != 1_000 || rules.DeclinePerMin != 500 || rules.GrowthThreshold != 500_000 || rules.AutoResumeMs != 300_000 {
		t.Errorf("rules = %+v", rules)
	}
	if rules.ShipHandlingBaseMs != 10_000 || rules.ShipHandlingMsPerUnit != 200 || rules.ShipSpeedMilliTilesPerMin != 60_000 || rules.AwaySummaryMs != 900_000 ||
		rules.TrialResumeMs != 1_800_000 || c.Region.Version != "old_coast-0.15.0" {
		t.Errorf("ship rules = %+v, version %s", rules, c.Region.Version)
	}
	if c.Region.Camera.MaxHalfExtent != 120 {
		t.Errorf("camera = %+v", c.Region.Camera)
	}

	wantIDs := func(kind string, got []string, want ...string) {
		t.Helper()
		if strings.Join(got, ",") != strings.Join(want, ",") {
			t.Errorf("%s IDs = %v, want %v", kind, got, want)
		}
	}
	var ids []string
	for _, g := range c.Goods {
		ids = append(ids, g.ID)
	}
	wantIDs("goods", ids, "wood", "planks", "fish", "wool", "wool_garments", "sails",
		"wheat", "flour", "bread", "apples", "cider", "hemp", "linen_garments", "stone", "iron_ore", "charcoal", "coal", "iron", "tools",
		"milk", "cheese", "honey", "mead", "pigs", "leather_jerkins",
		// Tier 3 (D-056 C3).
		"hops", "woad", "clay", "brine", "salt", "leather", "tallow", "dye", "paper", "bricks",
		"sausages", "pies", "beer", "brandy", "coats", "dyed_garments", "books", "soap",
		// Tier 4 (D-056 C4).
		"cattle", "raw_oysters", "grapes", "quartz", "copper_ore", "gold_ore", "barrels", "malt", "thread", "brass", "gold_bars", "glass",
		"roast_beef", "oysters", "wine", "grain_spirit", "fine_garments", "lace", "candles", "spectacles", "jewellery", "instruments")
	ids = nil
	for _, b := range c.Buildings {
		ids = append(ids, b.ID)
	}
	wantIDs("buildings", ids, "house_settlers", "road_dirt", "trading_post", "warehouse", "market", "chapel",
		"lumberjack", "tree_plot", "sawmill", "fisher", "sheep_farm", "pasture", "weaver_wool", "shipyard",
		"house_citizens", "road_paved", "quay", "tavern", "school", "city_guard", "wheat_farm", "wheat_field", "mill", "bakery",
		"dairy_farm", "cattle_pasture", "cheese_dairy", "orchard", "orchard_plot", "cidery", "apiary", "meadow", "meadery",
		"hemp_farm", "hemp_field", "weaver_linen", "pig_farm", "pig_pen", "tannery", "sailmaker", "quarry", "iron_mine",
		"charcoal_burner", "smelter", "toolmaker",
		// Tier 3 (D-056 C3).
		"house_merchants", "church", "theatre", "fire_station", "surgery", "butcher", "pastry_kitchen", "hop_farm", "hop_field", "brewery", "distillery", "leather_works", "tailor",
		"woad_farm", "woad_field", "dyer_works", "dyer", "paper_mill", "printing_press", "clay_pit", "rendering_house",
		"soap_maker", "salt_pans", "salt_mine", "salt_works", "brickworks", "coal_mine",
		// Tier 4 (D-056 C4).
		"house_patricians", "university", "cathedral", "cattle_farm", "slaughterhouse", "oyster_beds", "oyster_house", "vineyard", "vine_row", "cooperage", "winepress", "malt_house",
		"grain_distillery", "fashion_house", "thread_spinner", "lace_maker", "candle_foundry", "quartz_quarry", "glass_smelter",
		"copper_mine", "copper_smelter", "optician", "gold_mine", "gold_smelter", "goldsmith", "luthier")
	ids = nil
	for _, tr := range c.Tiers {
		ids = append(ids, tr.ID)
	}
	wantIDs("tiers", ids, "settlers", "citizens", "merchants", "patricians")
	// Merchants have their house and needs (D-056 C3); Patricians unlock
	// with the church and are still declared without a house or needs.
	for id, want := range map[string]string{"merchants": "8000-25000 1500 citizens=360 tavern", "patricians": "12000-40000 2700 merchants=1200 church"} {
		tr := c.TierByID[id]
		var pop []string
		for k, v := range tr.Unlock.Population {
			pop = append(pop, fmt.Sprintf("%s=%d", k, v))
		}
		got := fmt.Sprintf("%d-%d %d %s %s", tr.ResidentsFloor, tr.ResidentsMax, tr.TaxPerResidentPerMin, strings.Join(pop, ","), strings.Join(tr.Unlock.Buildings, ","))
		wantHouse, wantNeeds := "", 0
		switch id {
		case "merchants":
			wantHouse, wantNeeds = "house_merchants", 13
		case "patricians":
			wantHouse, wantNeeds = "house_patricians", 18
		}
		if got != want || tr.House != wantHouse || len(c.NeedsByTier[id]) != wantNeeds {
			t.Errorf("%s = %q (house %q), want %q", id, got, tr.House, want)
		}
	}

	settlers := c.TierByID["settlers"]
	if settlers.ResidentsFloor != 2000 || settlers.ResidentsMax != 8000 || settlers.TaxPerResidentPerMin != 200 || settlers.House != "house_settlers" {
		t.Errorf("settlers = %+v", settlers)
	}
	citizens := c.TierByID["citizens"]
	if citizens.Index != 1 || citizens.ResidentsFloor != 5000 || citizens.ResidentsMax != 15000 || citizens.TaxPerResidentPerMin != 800 || citizens.House != "house_citizens" ||
		citizens.Unlock.Population["settlers"] != 120 || strings.Join(citizens.Unlock.Buildings, ",") != "market,chapel" {
		t.Errorf("citizens = %+v", citizens)
	}

	// Balance (CONTENT §12): at 120 Settlers with the balanced tier-1 set,
	// taxes cover upkeep with at least 20 % margin (D-054 upkeep: fisher 2,
	// lumberjack 1, sawmill 2, sheep farm 1, weaver 2; the never-pausable
	// Trading Post, market and chapel carry none, D-046).
	var upkeep int64
	for _, id := range []string{"trading_post", "fisher", "lumberjack", "sawmill", "sheep_farm", "weaver_wool", "market", "chapel"} {
		upkeep += c.BuildingByID[id].UpkeepPerMin
	}
	if tax := 120 * settlers.TaxPerResidentPerMin; upkeep != 8_000 || tax*10 < upkeep*12 {
		t.Errorf("tax %d vs upkeep %d milli-gold/min: margin below 20 %%", tax, upkeep)
	}

	// Quests (quests.json): the intro chain, the tier-2 chain (D-056 §10)
	// the tier-3 chain (C3) and the tier-4 chain (C4), each linear; the
	// tier-2 chain branches off at intro_settlers_120, the tier-3 chain
	// follows citizens_cheese, the tier-4 chain merchants_bricks. Rewards in fixed point; only the shipyard quest
	// gives sails (for the first built sloop, CONTENT §8).
	if len(c.Quests) < 10 || c.Quests[0].ID != "intro_home_island" || len(c.Quests[0].Prerequisites) != 0 ||
		c.Quests[0].Objectives[0] != (Objective{Kind: ObjectiveIslandSettled, Min: 1}) || c.Quests[1].ID != "intro_first_road" {
		t.Fatalf("quests = %+v", c.Quests)
	}
	prev := map[string]string{"intro": c.Quests[0].ID}
	for i, q := range c.Quests[1:] {
		chain, _, _ := strings.Cut(q.ID, "_")
		want, ok := prev[chain]
		if !ok && chain == "citizens" {
			want = "intro_settlers_120"
		}
		if !ok && chain == "merchants" {
			want = "citizens_cheese"
		}
		if !ok && chain == "patricians" {
			want = "merchants_bricks"
		}
		prev[chain] = q.ID
		if (chain != "intro" && chain != "citizens" && chain != "merchants" && chain != "patricians") || len(q.Prerequisites) != 1 || q.Prerequisites[0] != want || c.QuestByID[q.ID] != q || q.Index != i+1 {
			t.Errorf("quest %s: prerequisites %v (want %s), index %d", q.ID, q.Prerequisites, want, q.Index)
		}
		if len(q.Rewards.Goods) > 0 && !strings.Contains(q.Text, "capacity") {
			t.Errorf("quest %s rewards goods but does not mention the capacity", q.ID)
		}
		for _, g := range q.Rewards.Goods {
			if g.Good != "planks" && (q.ID != "citizens_shipyard" || g != (GoodAmount{"sails", 10_000})) {
				t.Errorf("quest %s rewards %+v", q.ID, g)
			}
		}
	}
	if prev["intro"] != "intro_citizen_house" || prev["citizens"] != "citizens_cheese" || prev["merchants"] != "merchants_bricks" {
		t.Errorf("chains end at %v", prev)
	}
	if q := c.QuestByID["intro_planks"]; q.Rewards.Gold != 0 || len(q.Rewards.Goods) != 1 || q.Rewards.Goods[0] != (GoodAmount{"planks", 45_000}) {
		t.Errorf("intro_planks rewards %+v", q.Rewards)
	}
	if q := c.QuestByID["intro_tools"]; q.Objectives[1] != (Objective{Kind: ObjectiveStock, Good: "tools", Min: 10_000}) {
		t.Errorf("intro_tools objectives %+v", q.Objectives)
	}
	if q := c.QuestByID["intro_settlers_120"]; q.Objectives[0] != (Objective{Kind: ObjectivePopulation, Tier: "settlers", Min: 120_000}) {
		t.Errorf("intro_settlers_120 objectives %+v", q.Objectives)
	}

	// The start ship carries the starting stock (D-051): planks and sails
	// fit its slots; gold and planks cover the Trading Post plus the old
	// 800 gold / 130 planks of the first settlement.
	if c.Start.Gold != 1_000_000 || len(c.Start.Goods) != 2 || c.Start.Goods[0] != (GoodAmount{"planks", 150_000}) || c.Start.Goods[1] != (GoodAmount{"sails", 10_000}) {
		t.Errorf("start = %+v", c.Start)
	}
	if g := c.GoodByID["sails"]; g == nil || g.Type != "construction" {
		t.Errorf("sails = %+v", g)
	}

	// Spot-check numbers copied from CONTENT.md (converted to fixed point).
	type costs struct {
		gold, planks, upkeep int64
		w, h                 int
		pause                string
	}
	want := map[string]costs{
		"house_settlers": {0, 5_000, 0, 3, 3, "never"},
		"road_dirt":      {1_000, 0, 0, 1, 1, "never"},
		"trading_post":   {200_000, 15_000, 0, 6, 9, "never"},
		"warehouse":      {50_000, 6_000, 0, 6, 6, "never"},
		"market":         {250_000, 15_000, 0, 5, 6, "never"},
		"chapel":         {100_000, 6_000, 0, 3, 3, "never"},
		"lumberjack":     {60_000, 6_000, 1_000, 3, 3, "intermediate"},
		"sawmill":        {120_000, 9_000, 2_000, 4, 6, "intermediate"},
		"fisher":         {60_000, 6_000, 2_000, 3, 8, "food_basic"},
		"sheep_farm":     {60_000, 6_000, 1_000, 3, 3, "intermediate"},
		"weaver_wool":    {60_000, 6_000, 2_000, 3, 4, "need_goods"},
	}
	for id, w := range want {
		b := c.BuildingByID[id]
		var planks int64
		for _, m := range b.Cost.Materials {
			if m.Good != "planks" {
				t.Errorf("%s: unexpected material %s", id, m.Good)
			}
			planks = m.Amount
		}
		if b.Cost.Gold != w.gold || planks != w.planks || b.UpkeepPerMin != w.upkeep || b.Width != w.w || b.Height != w.h || b.PauseCategory != w.pause {
			t.Errorf("%s = gold %d planks %d upkeep %d %dx%d %s, want %+v", id, b.Cost.Gold, planks, b.UpkeepPerMin, b.Width, b.Height, b.PauseCategory, w)
		}
	}

	// Ships (CONTENT §7, §8; R-1, R-3; D-056 §9: 2/4/6 slots, the start
	// sloop first, the others of tiers 3 and 4).
	if len(c.Ships) != 3 || c.Ships[0].ID != "sloop" {
		t.Fatalf("ships = %+v", c.Ships)
	}
	sloop := c.ShipByID["sloop"]
	wantCost := Cost{Gold: 100_000, Materials: []GoodAmount{{"planks", 20_000}, {"sails", 10_000}}}
	if sloop == nil || sloop.Tier != "citizens" || sloop.Slots != 2 || sloop.SlotSize != 50_000 || sloop.SpeedPermille != 1200 ||
		sloop.BuildMs != 120_000 || sloop.UpkeepPerMin != 1_000 || sloop.Cost.Gold != wantCost.Gold ||
		len(sloop.Cost.Materials) != 2 || sloop.Cost.Materials[0] != wantCost.Materials[0] || sloop.Cost.Materials[1] != wantCost.Materials[1] {
		t.Errorf("sloop = %+v", sloop)
	}
	// Hull lengths (display only, CONTENT §11) match the models (assets/voxel/recipes/_ships.py ship length_tiles).
	for id, want := range map[string]int64{"sloop": 2_000, "brig": 2_600, "galleon": 3_200} {
		if sh := c.ShipByID[id]; sh == nil || sh.LengthMilliTiles != want {
			t.Errorf("%s length = %+v, want %d", id, sh, want)
		}
	}
	for _, w := range []struct {
		id, tier       string
		slots          int
		size, gold     Qty
		buildMs, upkep int64
		tools          Qty
		speed          int64
	}{
		// D-060: the sloop is fast and light, the galleon slow and heavy.
		{"brig", "merchants", 4, 50_000, 1_500_000, 300_000, 4_000, 10_000, 1000},
		{"galleon", "patricians", 6, 60_000, 6_000_000, 600_000, 8_000, 30_000, 850},
	} {
		s := c.ShipByID[w.id]
		if s == nil || s.Tier != w.tier || s.Slots != w.slots || s.SlotSize != w.size || s.Cost.Gold != w.gold || s.BuildMs != w.buildMs ||
			s.UpkeepPerMin != w.upkep || s.SpeedPermille != w.speed || len(s.Cost.Materials) != 3 || s.Cost.Materials[2] != (GoodAmount{"tools", w.tools}) {
			t.Errorf("%s = %+v", w.id, s)
		}
	}
	sy := c.BuildingByID["shipyard"]
	if sy.Shipyard == nil || sy.Tier != "citizens" || strings.Join(sy.Shipyard.Ships, ",") != "sloop,brig,galleon" || sy.Width != 8 || sy.Height != 12 || sy.WaterTiles != 4 || sy.Coastal || !sy.RequiresRoad ||
		sy.Cost.Gold != 300_000 || len(sy.Cost.Materials) != 1 || sy.Cost.Materials[0] != (GoodAmount{"planks", 45_000}) ||
		sy.UpkeepPerMin != 0 || sy.PauseCategory != "never" || sy.Recipe != nil || sy.Warehouse != nil {
		t.Errorf("shipyard = %+v", sy)
	}
	for _, b := range c.Buildings {
		if b.Shipyard != nil && b.ID != "shipyard" {
			t.Errorf("%s orders ships", b.ID)
		}
	}

	lj := c.BuildingByID["lumberjack"]
	if lj.Recipe.CycleMs != 30_000 || lj.Recipe.Outputs[0] != (GoodAmount{"wood", 1000}) || len(lj.Recipe.Inputs) != 0 {
		t.Errorf("lumberjack recipe = %+v", lj.Recipe)
	}
	// D-059: the lumberjack plants tree plots like a farm (no work area).
	if lj.WorkArea != nil || lj.Fields == nil || lj.Fields.Type != "tree_plot" || lj.Fields.Required != 24 || lj.Fields.Max != 24 {
		t.Errorf("lumberjack work area = %+v, fields = %+v", lj.WorkArea, lj.Fields)
	}
	if f := c.BuildingByID["fisher"]; f.Recipe.CycleMs != 40_000 || f.WaterTiles != 3 || f.Coastal || !f.Boat || !f.Smoke {
		t.Error("fisher recipe/water-edge mismatch")
	}
	tp := c.BuildingByID["trading_post"]
	if tp.TradingPost == nil || tp.WaterTiles != 3 || tp.TradingPost.Levels[0] != (TradingPostLevel{Capacity: 300_000, ThroughputPerMin: 30_000, Berths: 1}) {
		t.Errorf("trading post = %+v", tp.TradingPost)
	}
	var berths []int
	for _, l := range tp.TradingPost.Levels {
		berths = append(berths, l.Berths)
	}
	if fmt.Sprint(berths) != "[1 2 3 4]" {
		t.Errorf("trading post berths = %v", berths)
	}
	wh := c.BuildingByID["warehouse"]
	if wh.Warehouse == nil || wh.WaterTiles != 0 || wh.Coastal || wh.Tier != "settlers" || wh.Warehouse.Levels[0] != (WarehouseLevel{ThroughputPerMin: 30_000}) ||
		len(wh.Warehouse.Levels) != 3 || wh.Warehouse.Levels[2].ThroughputPerMin != 80_000 {
		t.Errorf("warehouse = %+v", wh.Warehouse)
	}
	if c.BuildingByID["road_dirt"].Road.MsPerTile != 1000 {
		t.Error("road_dirt seconds_per_tile")
	}
	if c.BuildingByID["chapel"].Service.RadiusAt(1) != 16 || c.BuildingByID["chapel"].Upgradable() {
		t.Error("chapel service")
	}
	// Market levels (D-056): radius 12 / 16 / 20; levels 2 and 3 need
	// Merchants and Patricians; level 3 costs bricks (C3).
	market := c.BuildingByID["market"]
	var levels []string
	for i, l := range market.Service.Levels {
		cost := "-"
		if lc := market.LevelCost(i + 1); lc != nil {
			cost = fmt.Sprint(lc.Gold, lc.Materials)
		}
		levels = append(levels, fmt.Sprintf("%d:%s:%s", l.Radius, market.LevelTier(i+1), cost))
	}
	if got := strings.Join(levels, " "); market.Name != "Market" || got != "12::- 16:merchants:1000000 [{planks 15000} {stone 30000}] 20:patricians:5000000 [{bricks 15000} {planks 15000} {stone 45000}]" {
		t.Errorf("market %q levels = %s", market.Name, got)
	}
	for id, amount := range map[string]Qty{"lumberjack": 4000, "sawmill": 4000, "fisher": 4000, "sheep_farm": 4000, "weaver_wool": 6000} {
		if wf := c.BuildingByID[id].Workforce; wf == nil || wf.Tier != "settlers" || wf.Amount != amount {
			t.Errorf("%s workforce = %+v", id, wf)
		}
	}
	for _, b := range c.Buildings {
		if b.Recipe == nil && b.Workforce != nil {
			t.Errorf("%s has a workforce without recipe", b.ID)
		}
	}

	needs := c.NeedsByTier["settlers"]
	if len(needs) != 3 {
		t.Fatalf("needs = %+v", needs)
	}
	food, clothing, services := needs[0], needs[1], needs[2]
	if food.ID != "settlers_food" || food.Kind != NeedRequired || food.Category != "food" || food.Weight != 500_000 ||
		len(food.Goods) != 1 || food.Goods[0] != (NeedGood{"fish", 10_000, ShareLone}) || !food.IsGoods() {
		t.Errorf("food = %+v", food)
	}
	if clothing.ID != "settlers_clothing" || clothing.Category != "clothing" || clothing.Weight != 200_000 ||
		len(clothing.Goods) != 1 || clothing.Goods[0] != (NeedGood{"wool_garments", 5_000, ShareLone}) {
		t.Errorf("clothing = %+v", clothing)
	}
	if services.ID != "settlers_services" || services.Kind != NeedRequired || services.Category != "services" || needBuildings(services) != "market=600000/chapel=600000" ||
		services.Weight != 300_000 || services.IsGoods() || !services.IsBuilding() {
		t.Errorf("services = %+v", services)
	}
}

// copyContent copies the shipped old_coast content into a temporary
// directory and applies replace (old -> new pairs, each must match) to file;
// a single replace value replaces the whole file.
func copyContent(t *testing.T, file string, replace ...string) string {
	t.Helper()
	src := filepath.Join(repoRoot(t), "content", "old_coast")
	dst := t.TempDir()
	entries, err := os.ReadDir(src)
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range entries {
		data, err := os.ReadFile(filepath.Join(src, e.Name())) // #nosec G304 -- test fixture path.
		if err != nil {
			t.Fatal(err)
		}
		if e.Name() == file && len(replace) == 1 {
			data = []byte(replace[0])
		} else if e.Name() == file {
			s := string(data)
			for i := 0; i+1 < len(replace); i += 2 {
				if !strings.Contains(s, replace[i]) {
					t.Fatalf("%s does not contain %q", file, replace[i])
				}
				s = strings.Replace(s, replace[i], replace[i+1], 1)
			}
			data = []byte(s)
		}
		if err := os.WriteFile(filepath.Join(dst, e.Name()), data, 0o600); err != nil { // #nosec G703 -- test temp dir and fixture names.
			t.Fatal(err)
		}
	}
	return dst
}

// TestLoadRejectsInvalidNeedsTiersAndStart covers the content rules of the
// needs/workforce/tier/start format (schema and loader).
func TestLoadRejectsInvalidNeedsTiersAndStart(t *testing.T) {
	schemaDir := filepath.Join(repoRoot(t), "content", "schema")
	const settlersHouse = `"house": "house_settlers",`
	tests := []struct {
		name    string
		file    string
		replace []string
		want    []string
	}{
		{
			"old category shape", FileNeeds,
			[]string{`"kind": "required",
    "weight": 0.5,
    "category": "food",
    "goods": [{ "good": "fish", "per_resident_per_min": 0.010 }]`, `"weight": 0.5, "category": "basic", "good": "fish", "per_resident_per_min": 0.010`},
			[]string{FileNeeds, `need "settlers_food"`, "schema violation"},
		},
		{
			"mixed shape", FileNeeds,
			[]string{`"category": "services",`, `"category": "services", "goods": [{ "good": "fish", "per_resident_per_min": 0.01 }],`},
			[]string{FileNeeds, `need "settlers_services"`, "schema violation"},
		},
		{
			"duplicate good in category", FileNeeds,
			[]string{`"goods": [{ "good": "fish", "per_resident_per_min": 0.010 }]`, `"goods": [{ "good": "fish", "per_resident_per_min": 0.010 }, { "good": "fish", "per_resident_per_min": 0.02 }]`},
			[]string{FileNeeds, `need "settlers_food"`, "goods[1].good", `duplicate good "fish"`},
		},
		{
			"unknown good in category", FileNeeds,
			[]string{`{ "good": "fish",`, `{ "good": "caviar",`},
			[]string{FileNeeds, `need "settlers_food"`, "goods[0].good", `unknown good "caviar"`},
		},
		{
			"required weights", FileNeeds,
			[]string{`"weight": 0.2,`, `"weight": 0.25,`},
			[]string{FileNeeds, `tier "settlers"`, "weight", "required need weights sum to 1050000"},
		},
		{
			"optional weight does not count as required", FileNeeds,
			[]string{`"kind": "required",
    "weight": 0.2,`, `"kind": "optional",
    "weight": 0.2,`},
			[]string{FileNeeds, `tier "settlers"`, "required need weights sum to 800000"},
		},
		{
			"workforce on non-producer", FileBuildings,
			[]string{`"service": { "radius": 16 }`, `"service": { "radius": 16 },
    "workforce": { "tier": "settlers", "amount": 2 }`},
			[]string{FileBuildings, `building "chapel"`, "workforce", "recipe"},
		},
		{
			"workforce unknown tier", FileBuildings,
			[]string{`"workforce": { "tier": "settlers", "amount": 4 }`, `"workforce": { "tier": "peasants", "amount": 4 }`},
			[]string{FileBuildings, `building "lumberjack"`, "workforce.tier", `unknown tier "peasants"`},
		},
		{
			"workforce zero amount", FileBuildings,
			[]string{`"workforce": { "tier": "settlers", "amount": 4 }`, `"workforce": { "tier": "settlers", "amount": 0 }`},
			[]string{FileBuildings, `building "lumberjack"`, "schema violation"},
		},
		{
			"tier with house but no needs", FileNeeds,
			[]string{"[]"},
			[]string{FileNeeds, `tier "settlers"`, "tier has no needs"},
		},
		{
			"declared-only tier with needs", FileTiers,
			[]string{settlersHouse, ""},
			[]string{FileNeeds, `tier "settlers"`, "declared-only tier"},
		},
		{
			"population of a later tier", FileTiers,
			[]string{`"population": {}`, `"population": { "citizens": 5 }`},
			[]string{FileTiers, `tier "settlers"`, "unlock.population", `tier "citizens" does not precede "settlers"`},
		},
		{
			"unknown good in start", FileStart,
			[]string{`"sails": 10`, `"sails": 10, "caviar": 5`},
			[]string{FileStart, "goods.caviar", `unknown good "caviar"`},
		},
		{
			"negative start gold", FileStart,
			[]string{`"gold": 1000`, `"gold": -1`},
			[]string{FileStart, "schema violation"},
		},
		{
			"region threshold above 1", FileRegion,
			[]string{`"growth_satisfaction_threshold": 0.5`, `"growth_satisfaction_threshold": 1.5`},
			[]string{FileRegion, "schema violation"},
		},
		{
			"region missing growth", FileRegion,
			[]string{`"growth_per_min": 1,`, ""},
			[]string{FileRegion, "schema violation"},
		},
		{
			"zero resume reserve", FileRegion,
			[]string{`"auto_resume_upkeep_minutes": 5`, `"auto_resume_upkeep_minutes": 0`},
			[]string{FileRegion, `region "old_coast"`, "rules.auto_resume_upkeep_minutes", "schema violation"},
		},
		{
			"negative resume reserve", FileRegion,
			[]string{`"auto_resume_upkeep_minutes": 5`, `"auto_resume_upkeep_minutes": -1`},
			[]string{FileRegion, `region "old_coast"`, "rules.auto_resume_upkeep_minutes", "schema violation"},
		},
		{
			"ship unknown tier", FileShips,
			[]string{`"tier": "citizens"`, `"tier": "nobles"`},
			[]string{FileShips, `ship "sloop"`, "tier", `unknown tier "nobles"`},
		},
		{
			"ship unknown cost good", FileShips,
			[]string{`"sails": 10`, `"silk": 10`},
			[]string{FileShips, `ship "sloop"`, "cost.silk", `unknown good "silk"`},
		},
		{
			"ship wrong region", FileShips,
			[]string{`"region": "old_coast"`, `"region": "new_world"`},
			[]string{FileShips, `ship "sloop"`, "region", `must be "old_coast"`},
		},
		{
			"ship zero slots", FileShips,
			[]string{`"slots": 2`, `"slots": 0`},
			[]string{FileShips, `ship "sloop"`, "schema violation"},
		},
		{
			"ship unknown field", FileShips,
			[]string{`"slots": 2`, `"slots": 2, "cannons": 4`},
			[]string{FileShips, `ship "sloop"`, "schema violation"},
		},
		{
			"ship duplicate", FileShips,
			[]string{`[
  {`, `[
  { "id": "sloop", "name": "Sloop", "region": "old_coast", "tier": "settlers", "slots": 1, "slot_size": 1, "speed": 1, "build_seconds": 1, "cost": {}, "upkeep_per_min": 0 },
  {`},
			[]string{FileShips, `ship "sloop"`, "duplicate ID"},
		},
		{
			"shipyard unknown ship", FileBuildings,
			[]string{`"ships": ["sloop", "brig", "galleon"]`, `"ships": ["frigate"]`},
			[]string{FileBuildings, `building "shipyard"`, "shipyard.ships[0]", `unknown ship "frigate"`},
		},
		{
			"shipyard without ships", FileBuildings,
			[]string{`"ships": ["sloop", "brig", "galleon"]`, `"ships": []`},
			[]string{FileBuildings, `building "shipyard"`, "schema violation"},
		},
		{
			"region missing ship speed", FileRegion,
			[]string{`,
    "ship_speed_tiles_per_min": 60`, ""},
			[]string{FileRegion, "schema violation"},
		},
		{
			"region zero ship speed", FileRegion,
			[]string{`"ship_speed_tiles_per_min": 60`, `"ship_speed_tiles_per_min": 0`},
			[]string{FileRegion, "schema violation"},
		},
		{
			"never-pausable building with upkeep", FileBuildings,
			[]string{`"cost": { "gold": 250, "planks": 15 },
    "upkeep_per_min": 0,`, `"cost": { "gold": 250, "planks": 15 },
    "upkeep_per_min": 3,`},
			[]string{FileBuildings, `building "market"`, "upkeep_per_min", "must be 0 for pause_category never"},
		},
		{
			"smoke on a public building", FileBuildings,
			[]string{`"cost": { "gold": 100, "planks": 6 },`, `"cost": { "gold": 100, "planks": 6 },
    "smoke": true,`},
			[]string{FileBuildings, `building "chapel"`, "smoke", "only producers"},
		},
		{
			"boat on a land producer", FileBuildings,
			[]string{`"cost": { "gold": 120, "planks": 9 },
    "upkeep_per_min": 2,`, `"cost": { "gold": 120, "planks": 9 },
    "boat": true,
    "upkeep_per_min": 2,`},
			[]string{FileBuildings, `building "sawmill"`, "boat", "only water-edge producers"},
		},
		{
			"water rows cover the whole footprint", FileBuildings,
			[]string{`"water_tiles": 3,
    "coastal": false,
    "requires_road": true,
    "cost": { "gold": 60, "planks": 6 },`, `"water_tiles": 8,
    "coastal": false,
    "requires_road": true,
    "cost": { "gold": 60, "planks": 6 },`},
			[]string{FileBuildings, `building "fisher"`, "water_tiles", "at least one land row"},
		},
		{
			"water-edge building also coastal", FileBuildings,
			[]string{`"water_tiles": 3,
    "coastal": false,
    "requires_road": true,
    "cost": { "gold": 60, "planks": 6 },`, `"water_tiles": 3,
    "coastal": true,
    "requires_road": true,
    "cost": { "gold": 60, "planks": 6 },`},
			[]string{FileBuildings, `building "fisher"`, "water_tiles", "not also coastal"},
		},
		{
			"trading post without water rows", FileBuildings,
			[]string{`"water_tiles": 3,
    "coastal": false,
    "requires_road": false,
    "cost": { "gold": 200, "planks": 15 },`, `"coastal": false,
    "requires_road": false,
    "cost": { "gold": 200, "planks": 15 },`},
			[]string{FileBuildings, `building "trading_post"`, "water_tiles", "water-edge building"},
		},
		{
			"quest unknown building", FileQuests,
			[]string{`{ "kind": "connected", "type": "lumberjack" }`, `{ "kind": "connected", "type": "lumber_camp" }`},
			[]string{FileQuests, `quest "intro_planks"`, "objectives[0].type", `unknown building "lumber_camp"`},
		},
		{
			"quest unknown good", FileQuests,
			[]string{`"good": "tools", "min": 10`, `"good": "spades", "min": 10`},
			[]string{FileQuests, `quest "intro_tools"`, "objectives[1].good", `unknown good "spades"`},
		},
		{
			"quest unknown ship type", FileQuests,
			[]string{`{ "kind": "ship_count", "type": "galleon", "min": 1 }`, `{ "kind": "ship_count", "type": "frigate", "min": 1 }`},
			[]string{FileQuests, `quest "patricians_galleon"`, "objectives[0].type", `unknown ship type "frigate"`},
		},
		{
			"quest unknown tier", FileQuests,
			[]string{`"tier": "settlers", "min": 120`, `"tier": "peasants", "min": 120`},
			[]string{FileQuests, `quest "intro_settlers_120"`, "objectives[0].tier", `unknown tier "peasants"`},
		},
		{
			"quest unknown reward good", FileQuests,
			[]string{`"rewards": { "goods": { "planks": 45 } }`, `"rewards": { "goods": { "timber": 45 } }`},
			[]string{FileQuests, `quest "intro_planks"`, "rewards.goods.timber", `unknown good "timber"`},
		},
		{
			"quest duplicate ID", FileQuests,
			[]string{`"id": "intro_houses"`, `"id": "intro_planks"`},
			[]string{FileQuests, `quest "intro_planks"`, "duplicate ID"},
		},
		{
			"quest forward prerequisite", FileQuests,
			[]string{`"prerequisites": ["intro_first_road"]`, `"prerequisites": ["intro_houses"]`},
			[]string{FileQuests, `quest "intro_planks"`, "prerequisites[0]", `quest "intro_houses" does not precede "intro_planks"`},
		},
		{
			"quest self prerequisite", FileQuests,
			[]string{`"prerequisites": ["intro_first_road"]`, `"prerequisites": ["intro_planks"]`},
			[]string{FileQuests, `quest "intro_planks"`, "prerequisites[0]", "does not precede"},
		},
		{
			"quest unknown prerequisite", FileQuests,
			[]string{`"prerequisites": ["intro_first_road"]`, `"prerequisites": ["intro_nowhere"]`},
			[]string{FileQuests, `quest "intro_planks"`, "prerequisites[0]", `unknown quest "intro_nowhere"`},
		},
		{
			"quest zero minimum", FileQuests,
			[]string{`"type": "road_dirt", "min": 10`, `"type": "road_dirt", "min": 0`},
			[]string{FileQuests, `quest "intro_first_road"`, "schema violation"},
		},
		{
			"quest unknown objective kind", FileQuests,
			[]string{`{ "kind": "route_exists" }`, `{ "kind": "trade_done" }`},
			[]string{FileQuests, `quest "intro_tools"`, "schema violation"},
		},
		{
			"quest without rewards", FileQuests,
			[]string{`"rewards": { "gold": 25 },
    "prerequisites": []`, `"rewards": {},
    "prerequisites": []`},
			[]string{FileQuests, `quest "intro_home_island"`, "schema violation"},
		},
		{
			"quest decoration reward", FileQuests,
			[]string{`"rewards": { "gold": 25 },
    "prerequisites": []`, `"rewards": { "gold": 25, "decorations": ["statue"] },
    "prerequisites": []`},
			[]string{FileQuests, `quest "intro_home_island"`, "schema violation"},
		},
		{
			"quest satisfaction decimals", FileQuests,
			[]string{`{ "kind": "route_exists" }`, `{ "kind": "satisfaction", "tier": "settlers", "min": 0.8125 }`},
			[]string{FileQuests, `quest "intro_tools"`, "objectives[0].min", "more than 3 decimal places"},
		},
		{
			"trial reserve equal to the reserve", FileRegion,
			[]string{`"trial_resume_upkeep_minutes": 30`, `"trial_resume_upkeep_minutes": 5`},
			[]string{FileRegion, `region "old_coast"`, "rules.trial_resume_upkeep_minutes", "must be greater than auto_resume_upkeep_minutes"},
		},
		{
			"trial reserve below the reserve", FileRegion,
			[]string{`"trial_resume_upkeep_minutes": 30`, `"trial_resume_upkeep_minutes": 4.5`},
			[]string{FileRegion, "rules.trial_resume_upkeep_minutes", "must be greater than auto_resume_upkeep_minutes"},
		},
		{
			"region missing trial reserve", FileRegion,
			[]string{`,
    "trial_resume_upkeep_minutes": 30`, ""},
			[]string{FileRegion, "schema violation"},
		},
		{
			"region missing camera", FileRegion,
			[]string{`,
  "camera": {
    "max_half_extent": 120
  }`, ""},
			[]string{FileRegion, "schema violation"},
		},
		{
			"region zero camera extent", FileRegion,
			[]string{`"max_half_extent": 120`, `"max_half_extent": 0`},
			[]string{FileRegion, "schema violation"},
		},
		{
			"region zero away summary", FileRegion,
			[]string{`"away_summary_minutes": 15`, `"away_summary_minutes": 0`},
			[]string{FileRegion, "schema violation"},
		},
		{
			"from_tier not lower", FileNeeds,
			[]string{`"from_tier": "settlers",
    "kind": "required",
    "weight": 0.5,`, `"from_tier": "citizens",
    "kind": "required",
    "weight": 0.5,`},
			[]string{FileNeeds, `need "citizens_settlers_food"`, "from_tier", "must be a lower tier"},
		},
		{
			"from_tier other goods", FileNeeds,
			[]string{`{ "good": "fish", "per_resident_per_min": 0.0042 }`, `{ "good": "bread", "per_resident_per_min": 0.0042 }`},
			[]string{FileNeeds, `need "citizens_settlers_food"`, "goods", "must list the goods"},
		},
		{
			"from_tier on a building need", FileNeeds,
			[]string{`{ "building": "school" }
    ]`, `{ "building": "school" }
    ], "from_tier": "settlers"`},
			[]string{FileNeeds, `need "citizens_services"`, "schema violation"},
		},
		{
			"services alternative without a service block", FileNeeds,
			[]string{`{ "building": "school" }
    ]`, `{ "building": "school" }, { "building": "fisher" }
    ]`},
			[]string{FileNeeds, `need "citizens_services"`, "buildings[4].building", "not a public building"},
		},
		{
			"services alternative of a higher tier", FileNeeds,
			[]string{`[{ "building": "market" }, { "building": "chapel" }]`, `[{ "building": "market" }, { "building": "tavern" }]`},
			[]string{FileNeeds, `need "settlers_services"`, "buildings[1].building", "above the need's tier"},
		},
		{
			"duplicate services alternative", FileNeeds,
			[]string{`[{ "building": "market" }, { "building": "chapel" }]`, `[{ "building": "market" }, { "building": "market" }]`},
			[]string{FileNeeds, `need "settlers_services"`, "buildings[1].building", "duplicate building"},
		},
		{
			"service level of an unknown tier", FileBuildings,
			[]string{`"tier": "merchants", "cost"`, `"tier": "nobles", "cost"`},
			[]string{FileBuildings, `building "market"`, "service.levels[1].tier", `unknown tier "nobles"`},
		},
		{
			"service level radius shrinks", FileBuildings,
			[]string{`{ "radius": 16, "tier"`, `{ "radius": 10, "tier"`},
			[]string{FileBuildings, `building "market"`, "service.levels[1].radius", "previous level"},
		},
		{
			"service upgrade level without cost", FileBuildings,
			[]string{`{ "radius": 16, "tier": "merchants", "cost": { "gold": 1000, "planks": 15, "stone": 30 } }`, `{ "radius": 16, "tier": "merchants" }`},
			[]string{FileBuildings, `building "market"`, "schema violation"},
		},
		{
			"input alternative of an unknown good", FileBuildings,
			[]string{`{ "good": ["charcoal", "coal"], "amount": 1 }`, `{ "good": ["charcoal", "peat"], "amount": 1 }`},
			[]string{FileBuildings, `building "smelter"`, "recipe.inputs[1].good[1]", `unknown good "peat"`},
		},
		{
			"input alternative accepted twice", FileBuildings,
			[]string{`{ "good": ["charcoal", "coal"], "amount": 1 }`, `{ "good": ["charcoal", "iron_ore"], "amount": 1 }`},
			[]string{FileBuildings, `building "smelter"`, "recipe.inputs[1].good[1]", "more than one input"},
		},
		{
			"input alternatives with one good", FileBuildings,
			[]string{`{ "good": ["charcoal", "coal"], "amount": 1 }`, `{ "good": ["charcoal"], "amount": 1 }`},
			[]string{FileBuildings, `building "smelter"`, "schema violation"},
		},
		{
			"service with radius and levels", FileBuildings,
			[]string{`"service": {
      "levels"`, `"service": {
      "radius": 12,
      "levels"`},
			[]string{FileBuildings, `building "market"`, "schema violation"},
		},
		{
			"region decimals", FileRegion,
			[]string{`"decline_per_min": 0.5`, `"decline_per_min": 0.5001`},
			[]string{FileRegion, "rules.decline_per_min", "more than 3 decimal places"},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			dir := copyContent(t, tt.file, tt.replace...)
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

func TestLoadBrokenFixtures(t *testing.T) {
	schemaDir := filepath.Join(repoRoot(t), "content", "schema")
	tests := []struct {
		dir  string
		want []string
	}{
		{"broken_dangling_good", []string{"buildings.json", `building "sawmill"`, "recipe.inputs[0].good", `unknown good "woood"`}},
		{"broken_dangling_building_need", []string{"needs.json", `need "settlers_market_small"`, "building", `unknown building "market_grand"`}},
		{"broken_negative_cycle", []string{"buildings.json", `building "lumberjack"`, "recipe.cycle_seconds", "schema violation"}},
		{"broken_duplicate_id", []string{"goods.json", `good "wood"`, "duplicate ID"}},
		{"broken_zero_cost_reference", []string{"buildings.json", `building "sawmill"`, "cost.missing_good", `unknown good "missing_good"`}},
		{"broken_weights_sum", []string{"needs.json", `tier "settlers"`, "weight"}},
	}
	for _, tt := range tests {
		t.Run(tt.dir, func(t *testing.T) {
			_, err := LoadWithSchemas(filepath.Join(repoRoot(t), "server", "internal", "content", "testdata", tt.dir), schemaDir)
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

func TestParseFixed(t *testing.T) {
	tests := []struct {
		in      string
		places  int
		want    int64
		wantErr bool
	}{
		{"0.05", 3, 50, false},
		{"0.010", 3, 10, false},
		{"1.0", 3, 1000, false},
		{"300", 3, 300_000, false},
		{"-30", 3, -30_000, false},
		{"0.3", 6, 300_000, false},
		{"0.0001", 3, 0, true},
		{"1e3", 3, 0, true},
	}
	for _, tt := range tests {
		got, err := ParseFixed(json.Number(tt.in), tt.places)
		if (err != nil) != tt.wantErr || got != tt.want {
			t.Errorf("ParseFixed(%q, %d) = %d, %v; want %d, err %v", tt.in, tt.places, got, err, tt.want, tt.wantErr)
		}
	}
}

// TestLoadTestContent validates the test-only content used by the
// simulation tests against the shipped schemas (R32).
func TestLoadTestContent(t *testing.T) {
	schemaDir := filepath.Join(repoRoot(t), "content", "schema")
	for _, dir := range []string{"old_coast_variety", "old_coast_dairy"} {
		if _, err := LoadWithSchemas(filepath.Join(repoRoot(t), "server", "testdata", "content", dir), schemaDir); err != nil {
			t.Fatalf("%s: %v", dir, err)
		}
	}
}

// TestCheckRejectsZeroResumeReserve covers the loader check behind the
// schema: a catalogue whose resume reserve is not positive (e.g. built by
// code, bypassing the schema) is rejected naming file, entity and field.
func TestCheckRejectsZeroResumeReserve(t *testing.T) {
	for _, ms := range []int64{0, -60_000} {
		c, err := Load(filepath.Join(repoRoot(t), "content", "old_coast"))
		if err != nil {
			t.Fatal(err)
		}
		c.Region.Rules.AutoResumeMs = ms
		err = checkReferences(c)
		for _, want := range []string{FileRegion, `region "old_coast"`, "rules.auto_resume_upkeep_minutes", "must be > 0"} {
			if err == nil || !strings.Contains(err.Error(), want) {
				t.Errorf("reserve %d ms: error %v does not contain %q", ms, err, want)
			}
		}
	}
}

// TestLoadNeedDisplayNames covers the display data of needs: every need
// has a name, goods-need categories come from need_categories.json with a
// name and a HUD icon of assets/icons/icons.json.
func TestLoadNeedDisplayNames(t *testing.T) {
	c, err := Load(filepath.Join(repoRoot(t), "content", "old_coast"))
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	var cats []string
	for _, nc := range c.NeedCategories {
		cats = append(cats, nc.ID+"="+nc.Name+"/"+nc.Icon)
		if c.NeedCategoryByID[nc.ID] != nc {
			t.Errorf("NeedCategoryByID[%q] = %+v", nc.ID, c.NeedCategoryByID[nc.ID])
		}
	}
	want := "food=Food/need:food,drink=Drink/need:drink,clothing=Clothing/need:clothing,comfort=Comfort/need:comfort,luxury=Luxury/need:luxury,services=Services/need:services," +
		// D-060 civic services: the HUD set has no icons of their own yet.
		"safety=Safety/need:safety,fire_protection=Fire protection/need:fire_protection,health=Health/need:health"
	if got := strings.Join(cats, ","); got != want {
		t.Errorf("need categories = %s, want %s", got, want)
	}
	names := map[string]string{}
	for _, tr := range c.Tiers {
		for _, n := range c.NeedsByTier[tr.ID] {
			names[n.ID] = n.Name
		}
	}
	wantNames := map[string]string{
		"settlers_food": "Food", "settlers_clothing": "Clothing", "settlers_services": "Services",
		"citizens_food": "Food", "citizens_drink": "Drink", "citizens_clothing": "Clothing", "citizens_services": "Services",
		"citizens_safety": "Safety", "merchants_safety": "Safety", "patricians_safety": "Safety",
		"merchants_fire_protection": "Fire protection", "merchants_health": "Health",
		"patricians_fire_protection": "Fire protection", "patricians_health": "Health",
		"citizens_settlers_food": "Food", "citizens_settlers_clothing": "Clothing",
		"merchants_food": "Food", "merchants_drink": "Drink", "merchants_clothing": "Clothing", "merchants_comfort": "Comfort",
		"merchants_services": "Services", "merchants_settlers_food": "Food", "merchants_settlers_clothing": "Clothing",
		"merchants_citizens_food": "Food", "merchants_citizens_drink": "Drink", "merchants_citizens_clothing": "Clothing",
		"patricians_food": "Food", "patricians_drink": "Drink", "patricians_clothing": "Clothing", "patricians_comfort": "Comfort",
		"patricians_luxury": "Luxury", "patricians_services": "Services", "patricians_settlers_food": "Food", "patricians_settlers_clothing": "Clothing",
		"patricians_citizens_food": "Food", "patricians_citizens_drink": "Drink", "patricians_citizens_clothing": "Clothing",
		"patricians_merchants_food": "Food", "patricians_merchants_drink": "Drink", "patricians_merchants_clothing": "Clothing",
		"patricians_merchants_comfort": "Comfort",
	}
	if len(names) != len(wantNames) {
		t.Errorf("need names = %v, want %v", names, wantNames)
	}
	for id, w := range wantNames {
		if names[id] != w {
			t.Errorf("need %s name = %q, want %q", id, names[id], w)
		}
	}
}

func TestLoadRejectsInvalidNeedDisplayData(t *testing.T) {
	schemaDir := filepath.Join(repoRoot(t), "content", "schema")
	tests := []struct {
		name    string
		file    string
		replace []string
		want    []string
	}{
		{
			"missing category", FileNeedCategories,
			[]string{`  { "id": "clothing", "name": "Clothing", "icon": "need:clothing" },
`, ""},
			[]string{FileNeeds, `need "settlers_clothing"`, "category", `unknown need category "clothing"`},
		},
		{
			"duplicate category", FileNeedCategories,
			[]string{`{ "id": "luxury",`, `{ "id": "food",`},
			[]string{FileNeedCategories, `need category "food"`, "id", "duplicate ID"},
		},
		{
			"category without icon", FileNeedCategories,
			[]string{`"name": "Food", "icon": "need:food"`, `"name": "Food"`},
			[]string{FileNeedCategories, `need category "food"`, "schema violation"},
		},
		{
			"category name too long", FileNeedCategories,
			[]string{`"name": "Food"`, `"name": "` + strings.Repeat("F", 33) + `"`},
			[]string{FileNeedCategories, `need category "food"`, "schema violation"},
		},
		{
			"category name not printable", FileNeedCategories,
			[]string{`"name": "Food"`, `"name": "Fo\u0007od"`},
			[]string{FileNeedCategories, `need category "food"`, "name", "printable"},
		},
		{
			"need without name", FileNeeds,
			[]string{`"name": "Services",`, ""},
			[]string{FileNeeds, `need "settlers_services"`, "schema violation"},
		},
		{
			"need empty name", FileNeeds,
			[]string{`"name": "Food",`, `"name": "",`},
			[]string{FileNeeds, `need "settlers_food"`, "schema violation"},
		},
		{
			"need name not printable", FileNeeds,
			[]string{`"name": "Clothing",`, `"name": "Clo\tthing",`},
			[]string{FileNeeds, `need "settlers_clothing"`, "name", "printable"},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			dir := copyContent(t, tt.file, tt.replace...)
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

// unknownHUDIcons returns the need categories whose icon is not a key of
// the HUD icon set manifest (assets/icons/icons.json). The check lives in
// the tests, not the loader: the server must not depend on a client asset
// at startup.
func unknownHUDIcons(t *testing.T, c *Catalogue, manifest string) []string {
	t.Helper()
	data, err := os.ReadFile(manifest) // #nosec G304 -- test fixture path.
	if err != nil {
		t.Fatal(err)
	}
	var m struct {
		Icons map[string]json.RawMessage `json:"icons"`
	}
	if err := json.Unmarshal(data, &m); err != nil {
		t.Fatal(err)
	}
	var bad []string
	for _, nc := range c.NeedCategories {
		if _, ok := m.Icons[nc.Icon]; !ok {
			bad = append(bad, nc.ID+"="+nc.Icon)
		}
	}
	return bad
}

// TestNeedCategoryIconsInHUDSet: every need category of the shipped and the
// test-only content names an icon of the HUD icon set.
func TestNeedCategoryIconsInHUDSet(t *testing.T) {
	root := repoRoot(t)
	manifest := filepath.Join(root, "assets", "icons", "icons.json")
	schemaDir := filepath.Join(root, "content", "schema")
	for _, dir := range []string{
		filepath.Join(root, "content", "old_coast"),
		filepath.Join(root, "server", "testdata", "content", "old_coast_variety"),
		filepath.Join(root, "server", "testdata", "content", "old_coast_dairy"),
	} {
		c, err := LoadWithSchemas(dir, schemaDir)
		if err != nil {
			t.Fatalf("%s: %v", dir, err)
		}
		if len(c.NeedCategories) == 0 {
			t.Errorf("%s: no need categories", dir)
		}
		if bad := unknownHUDIcons(t, c, manifest); len(bad) > 0 {
			t.Errorf("%s: need categories with an icon outside assets/icons/icons.json: %v", dir, bad)
		}
	}

	// The check catches an unknown icon (the loader accepts it).
	dir := copyContent(t, FileNeedCategories, `"icon": "need:drink"`, `"icon": "need:grog"`)
	c, err := LoadWithSchemas(dir, schemaDir)
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if bad := unknownHUDIcons(t, c, manifest); strings.Join(bad, ",") != "drink=need:grog" {
		t.Errorf("unknown icons = %v, want [drink=need:grog]", bad)
	}
}

// TestCheckRequiresTradingPost: every world settles by founding a Trading
// Post (D-051), so content without one is rejected.
func TestCheckRequiresTradingPost(t *testing.T) {
	c, err := Load(filepath.Join(repoRoot(t), "content", "old_coast"))
	if err != nil {
		t.Fatal(err)
	}
	c.BuildingByID["trading_post"].TradingPost = nil
	if err := checkReferences(c); err == nil || !strings.Contains(err.Error(), "no building with a trading_post block") {
		t.Errorf("err = %v", err)
	}
}

// TestNeedShareDefaults (D-056 as amended): without an authored share a
// lone alternative covers its category (1.0) and each of two or more
// alternatives 0.6; an authored share wins.
func TestNeedShareDefaults(t *testing.T) {
	root := repoRoot(t)
	schemaDir := filepath.Join(root, "content", "schema")
	for _, dir := range []string{
		filepath.Join(root, "content", "old_coast"),
		filepath.Join(root, "server", "testdata", "content", "old_coast_variety"),
	} {
		c, err := LoadWithSchemas(dir, schemaDir)
		if err != nil {
			t.Fatal(err)
		}
		multi := 0
		for _, needs := range c.NeedsByTier {
			for _, n := range needs {
				want := ShareLone
				if len(n.Goods) > 1 || len(n.Buildings) > 1 {
					want, multi = ShareAlternative, multi+1
				}
				for _, g := range n.Goods {
					if g.Share != want {
						t.Errorf("%s: %s %s share %d, want %d", dir, n.ID, g.Good, g.Share, want)
					}
				}
				for _, nb := range n.Buildings {
					if nb.Share != want {
						t.Errorf("%s: %s %s share %d, want %d", dir, n.ID, nb.Building, nb.Share, want)
					}
				}
			}
		}
		if strings.HasSuffix(dir, "old_coast_variety") && multi == 0 {
			t.Errorf("%s: no category with alternatives", dir)
		}
	}

	dir := copyContent(t, FileNeeds,
		`"goods": [{ "good": "fish", "per_resident_per_min": 0.010 }]`, `"goods": [{ "good": "fish", "per_resident_per_min": 0.010, "share": 0.5 }]`,
		`{ "building": "market" }`, `{ "building": "market", "share": 0.75 }`)
	c, err := LoadWithSchemas(dir, schemaDir)
	if err != nil {
		t.Fatal(err)
	}
	needs := c.NeedsByTier["settlers"]
	if needs[0].Goods[0].Share != 500_000 || needBuildings(needs[2]) != "market=750000/chapel=600000" || needs[1].Goods[0].Share != ShareLone {
		t.Errorf("authored shares = %+v %+v %+v", needs[0].Goods, needs[1].Goods, needs[2].Buildings)
	}
	dir = copyContent(t, FileNeeds, `{ "building": "market" }`, `{ "building": "market", "share": 1.5 }`)
	if _, err := LoadWithSchemas(dir, schemaDir); err == nil || !strings.Contains(err.Error(), "schema violation") {
		t.Errorf("share 1.5: err %v", err)
	}
}

// TestCumulativeTierRates (D-056 §2): every tier carries the required goods
// categories of every lower tier (same goods, from_tier set) at the rate
// own rate x (lower max / higher max residents) x 0.5^(distance / 3),
// rounded in content to four decimal places; the normalised weights give
// the own tier 0.6 and the lower tiers 0.4 together.
func TestCumulativeTierRates(t *testing.T) {
	c, err := Load(filepath.Join(repoRoot(t), "content", "old_coast"))
	if err != nil {
		t.Fatal(err)
	}
	for _, hi := range c.Tiers {
		needs := c.NeedsByTier[hi.ID]
		if len(needs) == 0 {
			continue
		}
		var own, lower int64
		for _, n := range needs {
			if n.Kind != NeedRequired {
				continue
			}
			if n.FromTier == "" {
				own += n.Weight
			} else {
				lower += n.Weight
			}
		}
		if hi.Index > 0 && (own != OwnTierWeight || lower != WeightScale-OwnTierWeight) {
			t.Errorf("%s: own weight %d, lower %d", hi.ID, own, lower)
		}
		for _, lo := range c.Tiers[:hi.Index] {
			for _, src := range c.NeedsByTier[lo.ID] {
				if !src.IsGoods() || src.FromTier != "" || src.Kind != NeedRequired {
					continue
				}
				var carried *Need
				for _, n := range needs {
					if n.FromTier == lo.ID && n.Category == src.Category {
						carried = n
					}
				}
				if carried == nil {
					t.Errorf("%s does not carry %s", hi.ID, src.ID)
					continue
				}
				dist := float64(hi.Index - lo.Index)
				for i, g := range src.Goods {
					want := float64(g.PerResidentPerMin) * float64(lo.ResidentsMax) / float64(hi.ResidentsMax) * math.Pow(0.5, dist/3)
					// Content rounds to four decimals (100 micro-units).
					if got := float64(carried.Goods[i].PerResidentPerMin); math.Abs(got-want) > 50 {
						t.Errorf("%s: %s rate %.0f micro, want %.0f (rule)", carried.ID, g.Good, got, want)
					}
				}
			}
		}
	}
}

// TestRetiredIDsAreNotReused: content IDs are never reused (CONTENT §1).
// Retired IDs stay out of every entity of the shipped content: market_small
// became market with the tier-3 content (D-056 C3).
func TestRetiredIDsAreNotReused(t *testing.T) {
	c, err := Load(filepath.Join(repoRoot(t), "content", "old_coast"))
	if err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"market_small"} {
		_, b := c.BuildingByID[id]
		_, g := c.GoodByID[id]
		_, s := c.ShipByID[id]
		if b || g || s {
			t.Errorf("retired ID %q is in use", id)
		}
	}
	if m := c.BuildingByID["market"]; m == nil || m.Name != "Market" || m.Service == nil || len(m.Service.Levels) != 3 {
		t.Errorf("market = %+v", m)
	}
}
