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

// TestLoadMerchantsChains checks the tier-3 goods and production chains
// (D-056 C3, CONTENT §5 and §7): one recipe per building with its inputs,
// cycle, workforce, slot or fertility, cost and upkeep.
func TestLoadMerchantsChains(t *testing.T) {
	c, err := Load(filepath.Join(repoRoot(t), "content", "old_coast"))
	if err != nil {
		t.Fatal(err)
	}
	types := map[string]string{
		"hops": "raw", "woad": "raw", "clay": "raw", "brine": "raw", "salt": "intermediate", "leather": "intermediate",
		"tallow": "intermediate", "dye": "intermediate", "paper": "intermediate", "bricks": "construction", "coal": "intermediate",
		"sausages": "food", "pies": "food", "beer": "drink", "brandy": "drink", "coats": "clothing", "dyed_garments": "clothing",
		"books": "comfort", "soap": "comfort",
	}
	for id, typ := range types {
		if g := c.GoodByID[id]; g == nil || g.Type != typ {
			t.Errorf("good %s = %+v, want type %s", id, g, typ)
		}
	}

	type chain struct {
		in, out   string
		cycleMs   int64
		wfTier    string
		wf        Qty
		fertility string
		deposit   string
		pause     string
		// cost as "gold/planks/stone/bricks" in units, upkeep in gold/min.
		cost   string
		upkeep int64
	}
	chains := map[string]chain{
		"butcher":         {"pigs,salt", "sausages", 60_000, "merchants", 8000, "", "", "need_goods", "270/6/6/3", 3},
		"pastry_kitchen":  {"flour,apples", "pies", 60_000, "merchants", 8000, "", "", "need_goods", "320/5/9/3", 4},
		"hop_farm":        {"", "hops", 60_000, "settlers", 6000, "hops", "", "intermediate", "120/6/3/0", 2},
		"brewery":         {"wheat,hops", "beer", 60_000, "merchants", 10_000, "", "", "need_goods", "330/6/9/3", 4},
		"distillery":      {"cider,charcoal|coal", "brandy", 90_000, "merchants", 8000, "", "", "need_goods", "420/6/9/6", 4},
		"leather_works":   {"pigs", "leather", 60_000, "citizens", 8000, "", "", "intermediate", "270/6/6/3", 2},
		"tailor":          {"wool_garments,leather", "coats", 90_000, "merchants", 10_000, "", "", "need_goods", "410/5/9/6", 5},
		"woad_farm":       {"", "woad", 90_000, "settlers", 6000, "woad", "", "intermediate", "120/6/3/0", 2},
		"dyer_works":      {"woad", "dye", 60_000, "citizens", 6000, "", "", "intermediate", "470/5/12/6", 3},
		"dyer":            {"linen_garments,dye", "dyed_garments", 60_000, "merchants", 8000, "", "", "need_goods", "410/5/9/6", 5},
		"paper_mill":      {"wood", "paper", 30_000, "citizens", 8000, "", "", "intermediate", "300/9/6/3", 2},
		"printing_press":  {"paper", "books", 60_000, "merchants", 10_000, "", "", "need_goods", "330/6/9/3", 6},
		"clay_pit":        {"", "clay", 45_000, "citizens", 8000, "", "clay", "intermediate", "60/6/0/0", 2},
		"rendering_house": {"pigs", "tallow", 60_000, "citizens", 6000, "", "", "intermediate", "170/5/6/0", 2},
		"soap_maker":      {"tallow", "soap", 60_000, "merchants", 8000, "", "", "need_goods", "120/6/3/0", 3},
		"salt_pans":       {"", "salt", 120_000, "settlers", 4000, "", "", "intermediate", "180/6/6/0", 2},
		"salt_mine":       {"", "brine", 30_000, "citizens", 10_000, "", "salt", "intermediate", "180/6/6/0", 2},
		"salt_works":      {"brine,charcoal|coal", "salt", 30_000, "citizens", 8000, "", "", "intermediate", "290/5/12/0", 2},
		"brickworks":      {"clay,charcoal|coal", "bricks", 45_000, "citizens", 8000, "", "", "intermediate", "90/9/0/0", 3},
		"coal_mine":       {"", "coal", 45_000, "citizens", 10_000, "", "coal", "intermediate", "180/6/6/0", 2},
	}
	var tier3 []string
	for _, b := range c.Buildings {
		if b.Tier == "merchants" && b.Recipe != nil {
			tier3 = append(tier3, b.ID)
		}
	}
	if len(tier3) != len(chains) {
		t.Errorf("tier-3 producers %v, want %d", tier3, len(chains))
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
			if in.Amount != 1000 {
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
		cost := fmt.Sprintf("%d/%d/%d/%d", b.Cost.Gold/1000, mat["planks"], mat["stone"], mat["bricks"])
		if b.Tier != "merchants" || !b.RequiresRoad || strings.Join(ins, ",") != w.in || len(b.Recipe.Outputs) != 1 || b.Recipe.Outputs[0].Good != w.out ||
			b.Recipe.Outputs[0].Amount != 1000 || b.Recipe.CycleMs != w.cycleMs || b.Workforce == nil || b.Workforce.Tier != w.wfTier || b.Workforce.Amount != w.wf ||
			fert != w.fertility || b.RequiresDeposit != w.deposit || b.PauseCategory != w.pause || cost != w.cost || b.UpkeepPerMin != w.upkeep*1000 {
			t.Errorf("%s = recipe %+v workforce %+v work area %+v deposit %q pause %q cost %s upkeep %d", id, b.Recipe, b.Workforce, b.WorkArea, b.RequiresDeposit, b.PauseCategory, cost, b.UpkeepPerMin)
		}
		// Every cycle divides 360 s so that rates are exact (MECHANICS §1.1).
		if 360_000%b.Recipe.CycleMs != 0 {
			t.Errorf("%s cycle %d ms does not divide 360 s", id, b.Recipe.CycleMs)
		}
	}
	// Salt pans: the harbour-slot alternative of the salt chain (3 water rows, no boat loop).
	if sp := c.BuildingByID["salt_pans"]; waterRange(sp).Max != 3 || sp.Boat || sp.Coastal {
		t.Errorf("salt_pans = %+v", sp)
	}
}

// TestLoadMerchantsNeeds checks the Merchants house, needs and services
// ladder (D-056 C3, CONTENT §2): four goods categories at 0.17 each with
// two alternatives, services 0.32 with church and playhouse, the lower
// tiers' categories at the cumulative rates, and the tier's buildings.
func TestLoadMerchantsNeeds(t *testing.T) {
	c, err := Load(filepath.Join(repoRoot(t), "content", "old_coast"))
	if err != nil {
		t.Fatal(err)
	}
	var got []string
	var weights int64
	for _, n := range c.NeedsByTier["merchants"] {
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
		// Own categories: 0.17 each (clothing 0.09) and services 0.16 of the own 0.6.
		"merchants_food:food:sausages=6000/pies=5000:102000", "merchants_drink:drink:beer=6000/brandy=4000:102000",
		"merchants_clothing:clothing:coats=4000/dyed_garments=4000:54000", "merchants_comfort:comfort:books=2000/soap=3000:102000",
		"merchants_services:services:market=600000/chapel=600000/tavern=600000/school=600000/church=600000/playhouse=600000:144000",
		// Civic services (D-060), 0.08 each: fire protection from services,
		// health from clothing, safety (the Citizens' category, cumulative
		// like services) from services.
		"merchants_safety:safety:city_guard=1000000:48000", "merchants_fire_protection:fire_protection:fire_station=1000000:48000",
		// Lower tiers: 0.2 each, split by their own weights (rounding to the last).
		"merchants_settlers_food:food:fish=2000:142857", "merchants_settlers_clothing:clothing:wool_garments=1000:57142",
		"merchants_citizens_food:food:bread=3800/cheese=2900:66666", "merchants_citizens_drink:drink:cider=2900/mead=2400:66666",
		"merchants_citizens_clothing:clothing:linen_garments=2400/leather_jerkins=1900:66669",
	}
	if !slices.Equal(got, want) || weights != WeightScale {
		t.Errorf("merchants needs = %v (weights %d), want %v", got, weights, want)
	}

	hm := c.BuildingByID["house_merchants"]
	if hm == nil || hm.House == nil || hm.House.Tier != "merchants" || hm.Width != 3 || hm.Height != 3 || hm.PauseCategory != "never" || hm.UpkeepPerMin != 0 ||
		fmt.Sprint(hm.Cost.Gold, hm.Cost.Materials) != "400000 [{bricks 3000} {planks 5000} {stone 3000}]" {
		t.Errorf("house_merchants = %+v", hm)
	}
	if tr := c.TierByID["merchants"]; tr.House != "house_merchants" {
		t.Errorf("merchants house %q", tr.House)
	}
	if tr := c.TierByID["patricians"]; !slices.Equal(tr.Unlock.Buildings, []string{"church"}) {
		t.Errorf("patricians unlock %v", tr.Unlock.Buildings)
	}
	// The services ladder (CONTENT §2): radius per public building, by tier.
	ladder := map[string]string{"market": "settlers:12", "chapel": "settlers:16", "tavern": "citizens:14", "school": "citizens:16", "church": "merchants:20", "playhouse": "merchants:24"}
	for id, w := range ladder {
		b := c.BuildingByID[id]
		if b == nil || b.Service == nil || fmt.Sprintf("%s:%d", b.Tier, b.Service.RadiusAt(1)) != w || !b.RequiresRoad {
			t.Errorf("%s service = %+v, want %s", id, b, w)
		}
	}
	for id, cost := range map[string]string{"church": "1500000 [{planks 30000} {stone 15000}]", "playhouse": "15000000 [{bricks 30000} {planks 30000} {stone 60000}]"} {
		b := c.BuildingByID[id]
		if b.Upgradable() || b.PauseCategory != "public" || fmt.Sprint(b.Cost.Gold, b.Cost.Materials) != cost {
			t.Errorf("%s = %+v", id, b)
		}
	}
	if up := map[string]Qty{"church": 6000, "playhouse": 15000}; c.BuildingByID["church"].UpkeepPerMin != up["church"] || c.BuildingByID["playhouse"].UpkeepPerMin != up["playhouse"] {
		t.Error("church/playhouse upkeep")
	}
	// The market's level 2 is the Merchants' (radius 16).
	if m := c.BuildingByID["market"]; m.Service.RadiusAt(2) != 16 || m.LevelTier(2) != "merchants" {
		t.Errorf("market level 2 = %d %s", m.Service.RadiusAt(2), m.LevelTier(2))
	}
	// The brig is the Merchants' ship, built at the shipyard.
	if b := c.ShipByID["brig"]; b == nil || b.Tier != "merchants" || !slices.Contains(c.BuildingByID["shipyard"].Shipyard.Ships, "brig") {
		t.Errorf("brig = %+v", b)
	}
}

// TestMerchantsQuests pins the tier-3 quest chain (D-056 C3): church,
// first Merchant house, both food and both drink alternatives, a brig
// (the third ship: there is no per-type ship predicate) and stored
// bricks, with modest gold rewards only.
func TestMerchantsQuests(t *testing.T) {
	c, err := Load(filepath.Join(repoRoot(t), "content", "old_coast"))
	if err != nil {
		t.Fatal(err)
	}
	want := map[string]string{
		"merchants_church": "tier_unlocked:merchants:0 connected:church:0",
		"merchants_house":  "building_count:house_merchants:1",
		"merchants_food":   "connected:butcher:0 connected:pastry_kitchen:0",
		"merchants_drink":  "connected:brewery:0 connected:distillery:0",
		"merchants_brig":   "ship_count::3",
		"merchants_bricks": "stock:bricks:30000",
	}
	n := 0
	for _, q := range c.Quests {
		if !strings.HasPrefix(q.ID, "merchants_") {
			continue
		}
		n++
		var objs []string
		for _, o := range q.Objectives {
			objs = append(objs, fmt.Sprintf("%s:%s:%d", o.Kind, o.Building+o.Good+o.Tier, o.Min))
		}
		if got := strings.Join(objs, " "); got != want[q.ID] || len(q.Rewards.Goods) != 0 || q.Rewards.Gold < 100_000 || q.Rewards.Gold > 200_000 {
			t.Errorf("%s = %s, rewards %+v", q.ID, got, q.Rewards)
		}
	}
	if n != len(want) {
		t.Errorf("%d merchants quests, want %d", n, len(want))
	}
}

// TestClosedChains: every good of the shipped content has a producer (or
// is in the starting stock) and a use: a recipe input, a need, or a
// building or ship cost. The charcoal | coal alternative is real: coal has
// its mine (D-056 C3).
func TestClosedChains(t *testing.T) {
	c, err := Load(filepath.Join(repoRoot(t), "content", "old_coast"))
	if err != nil {
		t.Fatal(err)
	}
	// playable: made by a building of a tier with a house; a good made only
	// by a declared-only tier's buildings waits for that tier's needs.
	produced, used, playable := map[string]bool{}, map[string]bool{}, map[string]bool{}
	for _, g := range c.Start.Goods {
		produced[g.Good] = true
	}
	for _, b := range c.Buildings {
		for _, m := range b.Cost.Materials {
			used[m.Good] = true
		}
		for lv := 2; lv <= b.LevelCount(); lv++ {
			if cost := b.LevelCost(lv); cost != nil {
				for _, m := range cost.Materials {
					used[m.Good] = true
				}
			}
		}
		if b.Recipe == nil {
			continue
		}
		for _, in := range b.Recipe.Inputs {
			for _, g := range in.Goods {
				used[g] = true
			}
		}
		for _, out := range b.Recipe.Outputs {
			produced[out.Good] = true
			if c.TierByID[b.Tier].House != "" {
				playable[out.Good] = true
			}
		}
	}
	for _, sh := range c.Ships {
		for _, m := range sh.Cost.Materials {
			used[m.Good] = true
		}
	}
	for _, needs := range c.NeedsByTier {
		for _, n := range needs {
			for _, g := range n.Goods {
				used[g.Good] = true
			}
		}
	}
	for _, g := range c.Goods {
		if !produced[g.ID] {
			t.Errorf("good %s has no producer", g.ID)
		}
		if !used[g.ID] && playable[g.ID] {
			t.Errorf("good %s has no use", g.ID)
		}
	}
	var coal []string
	for _, b := range c.Buildings {
		if b.Recipe != nil && b.Recipe.Outputs[0].Good == "coal" {
			coal = append(coal, b.ID)
		}
	}
	if !slices.Equal(coal, []string{"coal_mine"}) {
		t.Errorf("coal producers %v", coal)
	}
}

// plannedEntry is one entry of assets/voxel/planned/tier<N>.json.
type plannedEntry struct {
	ID         string `json:"id"`
	Kind       string `json:"kind"`
	Tier       int    `json:"tier"`
	Footprint  [2]int `json:"footprint"`
	WaterTiles int    `json:"water_tiles"`
	Slot       string `json:"slot"`
	Smoke      bool   `json:"smoke"`
}

// TestTierThreeMatchesPlannedModels: every tier-3 building of the content
// has the footprint, water rows, deposit slot and smoke flag of its
// planned model (assets/voxel/planned/tier3.json, PR #32), so the
// committed models fit; boats only where content says so (the fisher and,
// since tier 4, the oyster beds).
func TestTierThreeMatchesPlannedModels(t *testing.T) {
	c, err := Load(filepath.Join(repoRoot(t), "content", "old_coast"))
	if err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(filepath.Join(repoRoot(t), "assets", "voxel", "planned", "tier3.json"))
	if err != nil {
		t.Fatal(err)
	}
	var planned []plannedEntry
	if err := json.Unmarshal(data, &planned); err != nil {
		t.Fatal(err)
	}
	seen := map[string]bool{}
	for _, p := range planned {
		b := c.BuildingByID[p.ID]
		if b == nil {
			continue // authored in a later step (houses, services)
		}
		seen[p.ID] = true
		if b.Tier != "merchants" || b.Width != p.Footprint[0] || b.Height != p.Footprint[1] || waterRange(b).Max != p.WaterTiles ||
			b.RequiresDeposit != p.Slot || b.Smoke != p.Smoke {
			t.Errorf("%s: content %dx%d water %d slot %q smoke %v, planned %+v", p.ID, b.Width, b.Height, waterRange(b).Max, b.RequiresDeposit, b.Smoke, p)
		}
	}
	for _, b := range c.Buildings {
		// D-060's civic buildings are authored ahead of their models
		// (the models session plans and builds them).
		if b.Tier == "merchants" && !seen[b.ID] && b.ID != "fire_station" && b.ID != "playhouse" {
			t.Errorf("%s is not in the planned tier-3 models", b.ID)
		}
		if b.Boat != (b.ID == "fisher" || b.ID == "oyster_beds") {
			t.Errorf("%s boat = %v", b.ID, b.Boat)
		}
	}
}
