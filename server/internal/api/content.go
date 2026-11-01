package api

import (
	"github.com/ricoberger/new-shores/server/internal/content"
	"github.com/ricoberger/new-shores/server/internal/sim"
)

// Build-menu categories derived from the capability blocks (no content
// field yet; see IMPLEMENTATION.md of M1b).
const (
	categoryHouses     = "houses"
	categoryProduction = "production"
	categoryPublic     = "public"
	categoryHarbour    = "harbour"
	categoryRoads      = "roads"
	categoryOther      = "other"
)

// The content payload (GET /api/v1/content) is the loaded catalogue in the
// fixed-point units of the Display payload: goods and residents in
// milli-units, gold in milli-gold, rates in milli-units per minute,
// durations in milliseconds, ratios in parts per million.

type contentPayload struct {
	Region    regionJSON     `json:"region"`
	Tiers     []tierJSON     `json:"tiers"`
	Goods     []goodJSON     `json:"goods"`
	Buildings []buildingJSON `json:"buildings"`
	Needs     []needJSON     `json:"needs"`
	// NeedCategories are the goods-need categories (display names and
	// HUD icons) in content order.
	NeedCategories []needCategoryJSON `json:"need_categories"`
	Ships          []shipJSONOut      `json:"ships"`
	Quests         []questJSON        `json:"quests"`
	// SizeClasses are the island size classes of the archipelago
	// generator (islands.json) in content order: the display names of
	// an island's size_class.
	SizeClasses []sizeClassJSON `json:"size_classes"`
	// Language is the language of the text fields (D-061); Languages
	// every shipped language, "en" first.
	Language  string   `json:"language"`
	Languages []string `json:"languages"`
	// IslandNames lists the generator's island names: Source is the
	// English name stored in a world, Name its text in Language. A
	// generated island keeps the English name in the world until the
	// player renames it; clients show Name for a matching Source.
	IslandNames []islandNameJSON `json:"island_names"`
}

type islandNameJSON struct {
	Source string `json:"source"`
	Name   string `json:"name"`
}

type sizeClassJSON struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Rock   bool   `json:"rock"`
	Scenic bool   `json:"scenic"`
	Size   int    `json:"size"`
	// Count is the number of islands of the class per archipelago;
	// Fertilities and Deposits the per-island ranges drawn from the
	// generator's pools.
	Count       rangeJSON `json:"count"`
	Fertilities rangeJSON `json:"fertilities"`
	Deposits    rangeJSON `json:"deposits"`
	Shape       shapeJSON `json:"shape"`
	// Home marks the size class of the home candidate (D-053).
	Home bool `json:"home"`
}

type rangeJSON struct {
	Min int `json:"min"`
	Max int `json:"max"`
}

// shapeJSON are the shape parameters of a size class (D-058).
type shapeJSON struct {
	Arms   rangeJSON `json:"arms"`
	Plain  int       `json:"plain"`
	Rivers rangeJSON `json:"rivers"`
	Levels int       `json:"levels"`
	Islets rangeJSON `json:"islets"`
}

func newRangeJSON(r content.Range) rangeJSON { return rangeJSON{Min: r.Min, Max: r.Max} }

// questJSON is a quest of quests.json in content order. Objective targets
// use the units of the display (Display.quests): counts, 1 for yes/no
// predicates, milli-residents, milli-units or per-mille.
type questJSON struct {
	ID            string          `json:"id"`
	Title         string          `json:"title"`
	Text          string          `json:"text"`
	Objectives    []objectiveJSON `json:"objectives"`
	Rewards       rewardsJSON     `json:"rewards"`
	Prerequisites []string        `json:"prerequisites"`
}

type objectiveJSON struct {
	Kind   string `json:"kind"`
	Type   string `json:"type,omitempty"`
	Good   string `json:"good,omitempty"`
	Tier   string `json:"tier,omitempty"`
	Island string `json:"island,omitempty"`
	Target int64  `json:"target"`
}

// rewardsJSON: gold in milli-gold, goods in milli-units.
type rewardsJSON struct {
	Gold  int64            `json:"gold"`
	Goods map[string]int64 `json:"goods"`
}

type shipJSONOut struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	// SourceName is the English name where Name is another language's:
	// the server composes a ship's default name ("Sloop 2") from the
	// English type name, so clients match it to show the translation.
	SourceName    string   `json:"source_name,omitempty"`
	Tier          string   `json:"tier"`
	Slots         int      `json:"slots"`
	SlotSize      int64    `json:"slot_size"`
	SpeedPermille int64    `json:"speed_permille"`
	BuildMs       int64    `json:"build_ms"`
	Cost          costJSON `json:"cost"`
	UpkeepPerMin  int64    `json:"upkeep_per_min"`
	// LengthMilliTiles is the hull length (display only); absent when the
	// content gives none.
	LengthMilliTiles int64 `json:"length_milli_tiles,omitempty"`
}

type shipyardJSONOut struct {
	Ships []string `json:"ships"`
}

type regionJSON struct {
	ID      string     `json:"id"`
	Name    string     `json:"name"`
	Version string     `json:"version"`
	Rules   rulesJSON  `json:"rules"`
	Camera  cameraJSON `json:"camera"`
}

// cameraJSON are the region's client view constants (render only).
type cameraJSON struct {
	MaxHalfExtent int `json:"max_half_extent"`
}

type rulesJSON struct {
	TransferBaseMs             int64 `json:"transfer_base_ms"`
	UnconnectedBuffer          int64 `json:"unconnected_buffer"`
	IterationCap               int   `json:"iteration_cap"`
	CoarseStepMs               int64 `json:"coarse_step_ms"`
	GrowthPerMin               int64 `json:"growth_per_min"`
	DeclinePerMin              int64 `json:"decline_per_min"`
	GrowthThresholdPpm         int64 `json:"growth_satisfaction_threshold"`
	AutoResumeUpkeepDurationMs int64 `json:"auto_resume_upkeep_ms"`
	ShipHandlingBaseMs         int64 `json:"ship_handling_base_ms"`
	ShipHandlingMsPerUnit      int64 `json:"ship_handling_ms_per_unit"`
	ShipSpeedMilliTilesPerMin  int64 `json:"ship_speed_milli_tiles_per_min"`
	AwaySummaryMs              int64 `json:"away_summary_ms"`
	TrialResumeUpkeepMs        int64 `json:"trial_resume_upkeep_ms"`
}

type tierJSON struct {
	ID                   string     `json:"id"`
	Name                 string     `json:"name"`
	Index                int        `json:"index"`
	ResidentsFloor       int64      `json:"residents_floor"`
	ResidentsMax         int64      `json:"residents_max"`
	TaxPerResidentPerMin int64      `json:"tax_per_resident_per_min"`
	House                *string    `json:"house"`
	Unlock               unlockJSON `json:"unlock"`
}

type unlockJSON struct {
	Population map[string]int64 `json:"population"`
	Buildings  []string         `json:"buildings"`
}

type goodJSON struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Type string `json:"type"`
}

type costJSON struct {
	Gold      int64            `json:"gold"`
	Materials map[string]int64 `json:"materials"`
}

type goodAmountJSON struct {
	Good   string `json:"good"`
	Amount int64  `json:"amount"`
}

// recipeInputJSON is a recipe input: good is the preferred good, goods
// every accepted good in preference order (D-056 §7).
type recipeInputJSON struct {
	Good   string   `json:"good"`
	Goods  []string `json:"goods"`
	Amount int64    `json:"amount"`
}

type recipeJSON struct {
	Inputs  []recipeInputJSON `json:"inputs"`
	Outputs []goodAmountJSON  `json:"outputs"`
	CycleMs int64             `json:"cycle_ms"`
}

type houseJSON struct {
	Tier string `json:"tier"`
}

type tradingPostLevelJSON struct {
	Capacity         int64 `json:"capacity"`
	ThroughputPerMin int64 `json:"throughput_per_min"`
	Berths           int   `json:"berths"`
	// Cost is the upgrade cost into the level (absent on the first level).
	Cost *costJSON `json:"cost,omitempty"`
}

type tradingPostJSON struct {
	Levels []tradingPostLevelJSON `json:"levels"`
}

type warehouseLevelJSON struct {
	ThroughputPerMin int64 `json:"throughput_per_min"`
	// Tier must be unlocked to upgrade into the level (D-065).
	Tier string `json:"tier,omitempty"`
	// Cost is the upgrade cost into the level (absent on the first level).
	Cost *costJSON `json:"cost,omitempty"`
}

type warehouseJSON struct {
	Levels []warehouseLevelJSON `json:"levels"`
}

// pierJSON is a trading pier (D-060): the berths it adds.
type pierJSON struct {
	Berths int `json:"berths"`
}

// depotJSON is a depot (D-062): fixed capacity per good, no levels.
type depotJSON struct {
	Capacity int64 `json:"capacity"`
}

type roadJSON struct {
	MsPerTile int64 `json:"ms_per_tile"`
	Shallows  bool  `json:"shallows"`
}

// serviceJSON is a public building: radius is the first level's, levels
// lists every level (D-056, upgrade_building).
// Chain and Rank place a chain building (D-065).
type serviceJSON struct {
	Radius int                `json:"radius"`
	Chain  string             `json:"chain,omitempty"`
	Rank   int                `json:"rank,omitempty"`
	Levels []serviceLevelJSON `json:"levels"`
}

type serviceLevelJSON struct {
	Radius int    `json:"radius"`
	Tier   string `json:"tier,omitempty"`
	// Cost is the upgrade cost into the level (absent on the first level).
	Cost *costJSON `json:"cost,omitempty"`
}

// workAreaJSON is a work area: the fertility the building needs.
type workAreaJSON struct {
	Fertility string `json:"fertility,omitempty"`
}

type farmFieldsJSON struct {
	Type     string `json:"type"`
	Required int    `json:"required"`
	Max      int    `json:"max"`
}

type fieldJSON struct {
	Type      string   `json:"type"`
	Farm      string   `json:"farm"`
	Farms     []string `json:"farms"`
	Terrain   []string `json:"terrain"`
	Fertility string   `json:"fertility,omitempty"`
}

type workforceJSON struct {
	Tier   string `json:"tier"`
	Amount int64  `json:"amount"`
}

type buildingJSON struct {
	Description   string             `json:"description,omitempty"`
	ID            string             `json:"id"`
	Name          string             `json:"name"`
	Tier          string             `json:"tier"`
	Category      string             `json:"category"`
	Width         int                `json:"width"`
	Height        int                `json:"height"`
	Coastal       bool               `json:"coastal"`
	WaterRows     *content.WaterRows `json:"water_rows,omitempty"`
	RequiresRoad  bool               `json:"requires_road"`
	Cost          costJSON           `json:"cost"`
	UpkeepPerMin  int64              `json:"upkeep_per_min"`
	PauseCategory string             `json:"pause_category"`
	Recipe        *recipeJSON        `json:"recipe,omitempty"`
	House         *houseJSON         `json:"house,omitempty"`
	TradingPost   *tradingPostJSON   `json:"trading_post,omitempty"`
	Warehouse     *warehouseJSON     `json:"warehouse,omitempty"`
	Pier          *pierJSON          `json:"pier,omitempty"`
	Depot         *depotJSON         `json:"depot,omitempty"`
	Road          *roadJSON          `json:"road,omitempty"`
	Service       *serviceJSON       `json:"service,omitempty"`
	WorkArea      *workAreaJSON      `json:"work_area,omitempty"`
	Workforce     *workforceJSON     `json:"workforce,omitempty"`
	Shipyard      *shipyardJSONOut   `json:"shipyard,omitempty"`
	Fields        *farmFieldsJSON    `json:"fields,omitempty"`
	Field         *fieldJSON         `json:"field,omitempty"`
	// RequiresDeposit is the deposit kind the footprint must cover.
	RequiresDeposit string `json:"requires_deposit,omitempty"`
	// Smoke marks a producer that burns or cooks (display only).
	Smoke bool `json:"smoke,omitempty"`
	// Boat marks a water-edge producer with a boat (display only).
	Boat bool `json:"boat,omitempty"`
}

type needGoodJSON struct {
	Good              string `json:"good"`
	PerResidentPerMin int64  `json:"per_resident_per_min"` // micro-units
	SharePpm          int64  `json:"share"`
}

// needCategoryJSON is a goods-need category: display data only.
type needCategoryJSON struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	// Icon is a HUD icon key (assets/icons/icons.json), e.g. "need:food".
	Icon string `json:"icon"`
	// Group is the display group of the category ("goods", "public").
	Group string `json:"group,omitempty"`
}

type needJSON struct {
	ID        string         `json:"id"`
	Name      string         `json:"name"`
	Tier      string         `json:"tier"`
	FromTier  string         `json:"from_tier,omitempty"`
	Kind      string         `json:"kind"`
	WeightPpm int64          `json:"weight"`
	Category  string         `json:"category,omitempty"`
	Goods     []needGoodJSON `json:"goods,omitempty"`
	// Buildings are the alternatives of a building (services) need.
	Buildings []needBuildingJSON `json:"buildings,omitempty"`
	// Chain and MinRank make a chain need (D-065): served by any building
	// of the chain with rank >= MinRank within its own radius.
	Chain   string `json:"chain,omitempty"`
	MinRank int    `json:"min_rank,omitempty"`
}

type needBuildingJSON struct {
	Building string `json:"building"`
	SharePpm int64  `json:"share"`
}

// buildingCategory derives the build-menu group of a building from its
// capability blocks.
func buildingCategory(b *content.Building) string {
	switch {
	case b.House != nil:
		return categoryHouses
	case b.Recipe != nil, b.Field != nil, b.Warehouse != nil:
		// Fields sit next to the farms that accept them (D-049); the
		// inland Warehouse next to the producers it collects from (D-051).
		return categoryProduction
	case b.Service != nil:
		return categoryPublic
	case b.TradingPost != nil, b.Shipyard != nil, b.Pier != nil, b.Depot != nil:
		return categoryHarbour
	case b.Road != nil:
		return categoryRoads
	}
	return categoryOther
}

func goodAmounts(in []content.GoodAmount) []goodAmountJSON {
	out := make([]goodAmountJSON, 0, len(in))
	for _, g := range in {
		out = append(out, goodAmountJSON{Good: g.Good, Amount: g.Amount})
	}
	return out
}

// texts resolves content texts in one language.
type texts struct {
	c    *content.Catalogue
	lang string
}

func (t texts) name(file, id, english string) string {
	return t.c.Translate(t.lang, content.TextKey(file, id, "name"), english)
}

// sourceIfDifferent is the English name when the language's differs, else "".
func (t texts) sourceIfDifferent(file, id, english string) string {
	if t.name(file, id, english) == english {
		return ""
	}
	return english
}

func newContentPayload(c *content.Catalogue, lang string) contentPayload {
	tx := texts{c, lang}
	r := c.Region.Rules
	p := contentPayload{
		Region: regionJSON{
			ID: c.Region.ID, Name: tx.name("region", c.Region.ID, c.Region.Name), Version: c.Region.Version,
			Camera: cameraJSON{MaxHalfExtent: c.Region.Camera.MaxHalfExtent},
			Rules: rulesJSON{
				TransferBaseMs: r.TransferBaseMs, UnconnectedBuffer: r.UnconnectedBuffer,
				IterationCap: r.IterationCap, CoarseStepMs: r.CoarseStepMs,
				GrowthPerMin: r.GrowthPerMin, DeclinePerMin: r.DeclinePerMin,
				GrowthThresholdPpm:         r.GrowthThreshold,
				AutoResumeUpkeepDurationMs: r.AutoResumeMs,
				ShipHandlingBaseMs:         r.ShipHandlingBaseMs, ShipHandlingMsPerUnit: r.ShipHandlingMsPerUnit,
				ShipSpeedMilliTilesPerMin: r.ShipSpeedMilliTilesPerMin,
				AwaySummaryMs:             r.AwaySummaryMs, TrialResumeUpkeepMs: r.TrialResumeMs,
			},
		},
		Tiers: []tierJSON{}, Goods: []goodJSON{}, Buildings: []buildingJSON{}, Needs: []needJSON{}, NeedCategories: []needCategoryJSON{}, Ships: []shipJSONOut{},
		Quests: []questJSON{}, SizeClasses: []sizeClassJSON{},
		Language: lang, Languages: c.Languages(), IslandNames: []islandNameJSON{},
	}
	for _, sc := range c.Islands.SizeClasses {
		p.SizeClasses = append(p.SizeClasses, sizeClassJSON{
			ID: sc.ID, Name: tx.name("islands", sc.ID, sc.Name), Rock: sc.Rock, Scenic: sc.Scenic, Size: sc.Size,
			Count: newRangeJSON(sc.Count), Fertilities: newRangeJSON(sc.Fertilities), Deposits: newRangeJSON(sc.Deposits),
			Shape: shapeJSON{
				Arms: newRangeJSON(sc.Shape.Arms), Plain: sc.Shape.Plain, Rivers: newRangeJSON(sc.Shape.Rivers),
				Levels: sc.Shape.Levels, Islets: newRangeJSON(sc.Shape.Islets),
			},
			Home: sc.ID == c.Islands.Home.SizeClass,
		})
	}
	for _, q := range c.Quests {
		qj := questJSON{
			ID: q.ID, Title: c.Translate(lang, content.TextKey("quests", q.ID, "title"), q.Title), Text: c.Translate(lang, content.TextKey("quests", q.ID, "text"), q.Text), Objectives: []objectiveJSON{},
			Rewards:       rewardsJSON{Gold: q.Rewards.Gold, Goods: map[string]int64{}},
			Prerequisites: append([]string{}, q.Prerequisites...),
		}
		for _, o := range q.Objectives {
			qj.Objectives = append(qj.Objectives, objectiveJSON{
				Kind: o.Kind, Type: o.Building + o.Ship, Good: o.Good, Tier: o.Tier, Island: o.Island, Target: sim.ObjectiveTarget(o),
			})
		}
		for _, g := range q.Rewards.Goods {
			qj.Rewards.Goods[g.Good] = g.Amount
		}
		p.Quests = append(p.Quests, qj)
	}
	for _, sh := range c.Ships {
		sj := shipJSONOut{
			ID: sh.ID, Name: tx.name("ships", sh.ID, sh.Name), SourceName: tx.sourceIfDifferent("ships", sh.ID, sh.Name), Tier: sh.Tier, Slots: sh.Slots, SlotSize: sh.SlotSize, SpeedPermille: sh.SpeedPermille, LengthMilliTiles: sh.LengthMilliTiles,
			BuildMs: sh.BuildMs, Cost: costJSON{Gold: sh.Cost.Gold, Materials: map[string]int64{}}, UpkeepPerMin: sh.UpkeepPerMin,
		}
		for _, m := range sh.Cost.Materials {
			sj.Cost.Materials[m.Good] = m.Amount
		}
		p.Ships = append(p.Ships, sj)
	}
	for _, t := range c.Tiers {
		tj := tierJSON{
			ID: t.ID, Name: tx.name("tiers", t.ID, t.Name), Index: t.Index,
			ResidentsFloor: t.ResidentsFloor, ResidentsMax: t.ResidentsMax,
			TaxPerResidentPerMin: t.TaxPerResidentPerMin,
			Unlock: unlockJSON{
				Population: map[string]int64{},
				Buildings:  append([]string{}, t.Unlock.Buildings...),
			},
		}
		if t.House != "" {
			tj.House = &t.House
		}
		for tier, n := range t.Unlock.Population {
			tj.Unlock.Population[tier] = n * content.MilliPerUnit
		}
		p.Tiers = append(p.Tiers, tj)
	}
	for _, g := range c.Goods {
		p.Goods = append(p.Goods, goodJSON{ID: g.ID, Name: tx.name("goods", g.ID, g.Name), Type: g.Type})
	}
	for _, b := range c.Buildings {
		p.Buildings = append(p.Buildings, newBuildingJSON(b, tx))
	}
	for _, t := range c.Tiers {
		for _, n := range c.NeedsByTier[t.ID] {
			p.Needs = append(p.Needs, newNeedJSON(n, tx))
		}
	}
	for _, nc := range c.NeedCategories {
		p.NeedCategories = append(p.NeedCategories, needCategoryJSON{ID: nc.ID, Name: tx.name("need_categories", nc.ID, nc.Name), Icon: nc.Icon, Group: nc.Group})
	}
	for i, n := range c.IslandNames {
		p.IslandNames = append(p.IslandNames, islandNameJSON{Source: n, Name: c.Translate(lang, content.IslandNameKey(i), n)})
	}
	return p
}

func newBuildingJSON(b *content.Building, tx texts) buildingJSON {
	bj := buildingJSON{
		Description: tx.c.Translate(tx.lang, content.TextKey("buildings", b.ID, "description"), b.Description),
		ID:          b.ID, Name: tx.name("buildings", b.ID, b.Name), Tier: b.Tier, Category: buildingCategory(b),
		Width: b.Width, Height: b.Height, Coastal: b.Coastal, WaterRows: b.WaterRows, RequiresRoad: b.RequiresRoad,
		Cost:         newCostJSON(b.Cost),
		UpkeepPerMin: b.UpkeepPerMin, PauseCategory: b.PauseCategory, RequiresDeposit: b.RequiresDeposit, Smoke: b.Smoke, Boat: b.Boat,
	}
	if r := b.Recipe; r != nil {
		ins := make([]recipeInputJSON, 0, len(r.Inputs))
		for _, in := range r.Inputs {
			ins = append(ins, recipeInputJSON{Good: in.Good, Goods: in.Goods, Amount: in.Amount})
		}
		bj.Recipe = &recipeJSON{Inputs: ins, Outputs: goodAmounts(r.Outputs), CycleMs: r.CycleMs}
	}
	if h := b.House; h != nil {
		bj.House = &houseJSON{Tier: h.Tier}
	}
	if tp := b.TradingPost; tp != nil {
		bj.TradingPost = &tradingPostJSON{Levels: []tradingPostLevelJSON{}}
		for _, l := range tp.Levels {
			lj := tradingPostLevelJSON{Capacity: l.Capacity, ThroughputPerMin: l.ThroughputPerMin, Berths: l.Berths}
			if l.Cost != nil {
				cost := newCostJSON(*l.Cost)
				lj.Cost = &cost
			}
			bj.TradingPost.Levels = append(bj.TradingPost.Levels, lj)
		}
	}
	if wh := b.Warehouse; wh != nil {
		bj.Warehouse = &warehouseJSON{Levels: []warehouseLevelJSON{}}
		for _, l := range wh.Levels {
			lj := warehouseLevelJSON{ThroughputPerMin: l.ThroughputPerMin, Tier: l.Tier}
			if l.Cost != nil {
				cost := newCostJSON(*l.Cost)
				lj.Cost = &cost
			}
			bj.Warehouse.Levels = append(bj.Warehouse.Levels, lj)
		}
	}
	if pr := b.Pier; pr != nil {
		bj.Pier = &pierJSON{Berths: pr.Berths}
	}
	if d := b.Depot; d != nil {
		bj.Depot = &depotJSON{Capacity: d.Capacity}
	}
	if rd := b.Road; rd != nil {
		bj.Road = &roadJSON{MsPerTile: rd.MsPerTile, Shallows: rd.Shallows}
	}
	if s := b.Service; s != nil {
		bj.Service = &serviceJSON{Radius: s.RadiusAt(1), Chain: s.Chain, Rank: s.Rank, Levels: []serviceLevelJSON{}}
		for _, l := range s.Levels {
			lj := serviceLevelJSON{Radius: l.Radius, Tier: l.Tier}
			if l.Cost != nil {
				cost := newCostJSON(*l.Cost)
				lj.Cost = &cost
			}
			bj.Service.Levels = append(bj.Service.Levels, lj)
		}
	}
	if wa := b.WorkArea; wa != nil {
		bj.WorkArea = &workAreaJSON{Fertility: wa.Fertility}
	}
	if f := b.Fields; f != nil {
		bj.Fields = &farmFieldsJSON{Type: f.Type, Required: f.Required, Max: f.Max}
	}
	if f := b.Field; f != nil {
		bj.Field = &fieldJSON{Type: f.Type, Farm: f.Farm, Farms: append([]string{}, f.Farms...), Terrain: append([]string{}, f.Terrain...), Fertility: f.Fertility}
	}
	if wf := b.Workforce; wf != nil {
		bj.Workforce = &workforceJSON{Tier: wf.Tier, Amount: wf.Amount}
	}
	if sy := b.Shipyard; sy != nil {
		bj.Shipyard = &shipyardJSONOut{Ships: append([]string{}, sy.Ships...)}
	}
	return bj
}

func newCostJSON(c content.Cost) costJSON {
	out := costJSON{Gold: c.Gold, Materials: map[string]int64{}}
	for _, m := range c.Materials {
		out.Materials[m.Good] = m.Amount
	}
	return out
}

func newNeedJSON(n *content.Need, tx texts) needJSON {
	nj := needJSON{ID: n.ID, Name: tx.name("needs", n.ID, n.Name), Tier: n.Tier, FromTier: n.FromTier, Kind: n.Kind, WeightPpm: n.Weight, Category: n.Category, Chain: n.Chain, MinRank: n.MinRank}
	if n.IsGoods() {
		for _, g := range n.Goods {
			nj.Goods = append(nj.Goods, needGoodJSON{Good: g.Good, PerResidentPerMin: g.PerResidentPerMin, SharePpm: g.Share})
		}
	}
	for _, nb := range n.Buildings {
		nj.Buildings = append(nj.Buildings, needBuildingJSON{Building: nb.Building, SharePpm: nb.Share})
	}
	return nj
}
