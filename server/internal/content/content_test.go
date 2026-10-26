package content

import (
	"encoding/json"
	"fmt"
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
	if rules.GrowthPerMin != 1_000 || rules.DeclinePerMin != 500 || rules.GrowthThreshold != 500_000 || rules.OptionalTaxBonus != 250_000 || rules.AutoResumeMs != 300_000 {
		t.Errorf("rules = %+v", rules)
	}
	if rules.ShipHandlingBaseMs != 10_000 || rules.ShipHandlingMsPerUnit != 200 || rules.ShipSpeedMilliTilesPerMin != 60_000 || rules.AwaySummaryMs != 900_000 ||
		rules.TrialResumeMs != 1_800_000 || c.Region.Version != "old_coast-0.10.0" {
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
		"wheat", "flour", "bread", "apples", "cider", "hemp", "linen_garments", "stone", "iron_ore", "charcoal", "iron", "tools")
	ids = nil
	for _, b := range c.Buildings {
		ids = append(ids, b.ID)
	}
	wantIDs("buildings", ids, "house_settlers", "road_dirt", "trading_post", "warehouse", "market_small", "chapel",
		"lumberjack", "sawmill", "fisher", "sheep_farm", "pasture", "weaver_wool", "shipyard",
		"house_citizens", "road_paved", "tavern", "wheat_farm", "wheat_field", "mill", "bakery", "orchard", "orchard_plot",
		"cidery", "hemp_farm", "hemp_field", "weaver_linen", "sailmaker", "quarry", "iron_mine", "charcoal_burner", "smelter", "toolmaker")
	ids = nil
	for _, tr := range c.Tiers {
		ids = append(ids, tr.ID)
	}
	wantIDs("tiers", ids, "settlers", "citizens")
	if _, ok := c.TierByID["merchants"]; ok {
		t.Error("merchants must not be in content yet")
	}

	settlers := c.TierByID["settlers"]
	if settlers.ResidentsFloor != 2000 || settlers.ResidentsMax != 8000 || settlers.TaxPerResidentPerMin != 200 || settlers.House != "house_settlers" {
		t.Errorf("settlers = %+v", settlers)
	}
	citizens := c.TierByID["citizens"]
	if citizens.Index != 1 || citizens.ResidentsFloor != 5000 || citizens.ResidentsMax != 15000 || citizens.TaxPerResidentPerMin != 480 || citizens.House != "house_citizens" ||
		citizens.Unlock.Population["settlers"] != 120 || strings.Join(citizens.Unlock.Buildings, ",") != "market_small,chapel" || len(citizens.Unlock.GoodsDelivered) != 0 {
		t.Errorf("citizens = %+v", citizens)
	}

	// Balance (CONTENT §12): at 120 Settlers with the balanced tier-1 set,
	// taxes cover upkeep with at least 20 % margin (D-054 upkeep: fisher 2,
	// lumberjack 1, sawmill 2, sheep farm 1, weaver 2; the never-pausable
	// Trading Post, market and chapel carry none, D-046).
	var upkeep int64
	for _, id := range []string{"trading_post", "fisher", "lumberjack", "sawmill", "sheep_farm", "weaver_wool", "market_small", "chapel"} {
		upkeep += c.BuildingByID[id].UpkeepPerMin
	}
	if tax := 120 * settlers.TaxPerResidentPerMin; upkeep != 8_000 || tax*10 < upkeep*12 {
		t.Errorf("tax %d vs upkeep %d milli-gold/min: margin below 20 %%", tax, upkeep)
	}

	// Intro quests (quests.json): a linear chain, rewards in fixed point.
	if len(c.Quests) < 10 || c.Quests[0].ID != "intro_home_island" || len(c.Quests[0].Prerequisites) != 0 ||
		c.Quests[0].Objectives[0] != (Objective{Kind: ObjectiveIslandSettled, Min: 1}) || c.Quests[1].ID != "intro_first_road" {
		t.Fatalf("quests = %+v", c.Quests)
	}
	for i, q := range c.Quests[1:] {
		if len(q.Prerequisites) != 1 || q.Prerequisites[0] != c.Quests[i].ID || c.QuestByID[q.ID] != q || q.Index != i+1 {
			t.Errorf("quest %s: prerequisites %v, index %d", q.ID, q.Prerequisites, q.Index)
		}
		if len(q.Rewards.Goods) > 0 && !strings.Contains(q.Text, "capacity") {
			t.Errorf("quest %s rewards goods but does not mention the capacity", q.ID)
		}
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
		"road_dirt":      {2_000, 0, 0, 1, 1, "never"},
		"trading_post":   {200_000, 15_000, 0, 6, 9, "never"},
		"warehouse":      {50_000, 6_000, 0, 6, 6, "never"},
		"market_small":   {250_000, 15_000, 0, 5, 6, "never"},
		"chapel":         {100_000, 6_000, 0, 3, 3, "never"},
		"lumberjack":     {100_000, 6_000, 1_000, 3, 3, "intermediate"},
		"sawmill":        {250_000, 9_000, 2_000, 4, 6, "intermediate"},
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

	// Ships (CONTENT §7, §8; R-1, R-3).
	if len(c.Ships) != 1 {
		t.Fatalf("ships = %+v", c.Ships)
	}
	sloop := c.ShipByID["sloop"]
	wantCost := Cost{Gold: 100_000, Materials: []GoodAmount{{"planks", 20_000}, {"sails", 10_000}}}
	if sloop == nil || sloop.Tier != "settlers" || sloop.Slots != 4 || sloop.SlotSize != 50_000 || sloop.SpeedPermille != 1000 ||
		sloop.BuildMs != 120_000 || sloop.UpkeepPerMin != 1_000 || sloop.Cost.Gold != wantCost.Gold ||
		len(sloop.Cost.Materials) != 2 || sloop.Cost.Materials[0] != wantCost.Materials[0] || sloop.Cost.Materials[1] != wantCost.Materials[1] {
		t.Errorf("sloop = %+v", sloop)
	}
	sy := c.BuildingByID["shipyard"]
	if sy.Shipyard == nil || strings.Join(sy.Shipyard.Ships, ",") != "sloop" || sy.Width != 8 || sy.Height != 12 || sy.WaterTiles != 4 || sy.Coastal || !sy.RequiresRoad ||
		sy.Cost.Gold != 1_000_000 || len(sy.Cost.Materials) != 1 || sy.Cost.Materials[0] != (GoodAmount{"planks", 45_000}) ||
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
	if lj.WorkArea == nil || lj.WorkArea.Radius != 4 || lj.WorkArea.RequiredTiles != 24 || !lj.WorkArea.MatchesTerrain("forest") {
		t.Errorf("lumberjack work area = %+v", lj.WorkArea)
	}
	if f := c.BuildingByID["fisher"]; f.Recipe.CycleMs != 40_000 || f.WaterTiles != 3 || f.Coastal {
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
	if c.BuildingByID["market_small"].Service.Radius != 12 || c.BuildingByID["chapel"].Service.Radius != 16 {
		t.Error("service radii")
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
	food, clothing, market := needs[0], needs[1], needs[2]
	if food.ID != "settlers_food" || food.Kind != NeedRequired || food.Category != "food" || food.Weight != 500_000 ||
		len(food.Goods) != 1 || food.Goods[0] != (NeedGood{"fish", 10}) || food.VarietyBonus != 100_000 || food.MaxExtraGoods != 2 || !food.IsGoods() {
		t.Errorf("food = %+v", food)
	}
	if clothing.ID != "settlers_clothing" || clothing.Category != "clothing" || clothing.Weight != 200_000 ||
		len(clothing.Goods) != 1 || clothing.Goods[0] != (NeedGood{"wool_garments", 5}) || clothing.VarietyBonus != 100_000 || clothing.MaxExtraGoods != 2 {
		t.Errorf("clothing = %+v", clothing)
	}
	if market.ID != "settlers_market_small" || market.Kind != NeedRequired || market.Building != "market_small" || market.Radius != 12 || market.Weight != 300_000 || market.IsGoods() {
		t.Errorf("market = %+v", market)
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
    "goods": [{ "good": "fish", "per_resident_per_min": 0.010 }],
    "variety_bonus": 0.10,
    "max_extra_goods": 2`, `"weight": 0.5, "category": "basic", "good": "fish", "per_resident_per_min": 0.010`},
			[]string{FileNeeds, `need "settlers_food"`, "schema violation"},
		},
		{
			"mixed shape", FileNeeds,
			[]string{`"radius": 12`, `"radius": 12, "variety_bonus": 0.1`},
			[]string{FileNeeds, `need "settlers_market_small"`, "schema violation"},
		},
		{
			"duplicate good in category", FileNeeds,
			[]string{`"goods": [{ "good": "fish", "per_resident_per_min": 0.010 }]`, `"goods": [{ "good": "fish", "per_resident_per_min": 0.010 }, { "good": "fish", "per_resident_per_min": 0.02 }]`},
			[]string{FileNeeds, `need "settlers_food"`, "goods[1].good", `duplicate good "fish"`},
		},
		{
			"unknown good in category", FileNeeds,
			[]string{`{ "good": "fish",`, `{ "good": "cheese",`},
			[]string{FileNeeds, `need "settlers_food"`, "goods[0].good", `unknown good "cheese"`},
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
			[]string{`"service": { "radius": 12 }`, `"service": { "radius": 12 },
    "workforce": { "tier": "settlers", "amount": 2 }`},
			[]string{FileBuildings, `building "market_small"`, "workforce", "recipe"},
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
			[]string{`"sails": 10`, `"sails": 10, "cheese": 5`},
			[]string{FileStart, "goods.cheese", `unknown good "cheese"`},
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
			[]string{`"tier": "settlers"`, `"tier": "nobles"`},
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
			[]string{`"slots": 4`, `"slots": 0`},
			[]string{FileShips, `ship "sloop"`, "schema violation"},
		},
		{
			"ship unknown field", FileShips,
			[]string{`"slots": 4`, `"slots": 4, "cannons": 4`},
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
			[]string{`"ships": ["sloop"]`, `"ships": ["galleon"]`},
			[]string{FileBuildings, `building "shipyard"`, "shipyard.ships[0]", `unknown ship "galleon"`},
		},
		{
			"shipyard without ships", FileBuildings,
			[]string{`"ships": ["sloop"]`, `"ships": []`},
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
			[]string{FileBuildings, `building "market_small"`, "upkeep_per_min", "must be 0 for pause_category never"},
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
	want := "food=Food/need:food,drink=Drink/need:drink,clothing=Clothing/need:clothing,comfort=Comfort/need:_fallback,luxury=Luxury/need:_fallback"
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
		"settlers_food": "Food", "settlers_clothing": "Clothing", "settlers_market_small": "Market",
		"citizens_food": "Food", "citizens_drink": "Drink", "citizens_clothing": "Clothing",
		"citizens_market_small": "Market", "citizens_chapel": "Chapel", "citizens_tavern": "Tavern",
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
			[]string{`"name": "Market",`, ""},
			[]string{FileNeeds, `need "settlers_market_small"`, "schema violation"},
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
