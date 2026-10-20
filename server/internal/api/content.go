package api

import (
	"github.com/ricoberger/new-shores/server/internal/content"
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
	Ships     []shipJSONOut  `json:"ships"`
}

type shipJSONOut struct {
	ID            string   `json:"id"`
	Name          string   `json:"name"`
	Tier          string   `json:"tier"`
	Slots         int      `json:"slots"`
	SlotSize      int64    `json:"slot_size"`
	SpeedPermille int64    `json:"speed_permille"`
	BuildMs       int64    `json:"build_ms"`
	Cost          costJSON `json:"cost"`
	UpkeepPerMin  int64    `json:"upkeep_per_min"`
}

type shipyardJSONOut struct {
	Ships []string `json:"ships"`
}

type regionJSON struct {
	ID      string    `json:"id"`
	Name    string    `json:"name"`
	Version string    `json:"version"`
	Rules   rulesJSON `json:"rules"`
}

type rulesJSON struct {
	TransferBaseMs             int64 `json:"transfer_base_ms"`
	UnconnectedBuffer          int64 `json:"unconnected_buffer"`
	IterationCap               int   `json:"iteration_cap"`
	CoarseStepMs               int64 `json:"coarse_step_ms"`
	GrowthPerMin               int64 `json:"growth_per_min"`
	DeclinePerMin              int64 `json:"decline_per_min"`
	GrowthThresholdPpm         int64 `json:"growth_satisfaction_threshold"`
	OptionalTaxBonusPpm        int64 `json:"optional_tax_bonus"`
	AutoResumeUpkeepDurationMs int64 `json:"auto_resume_upkeep_ms"`
	ShipHandlingMs             int64 `json:"ship_handling_ms"`
	ShipSpeedMilliTilesPerMin  int64 `json:"ship_speed_milli_tiles_per_min"`
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
	Population     map[string]int64 `json:"population"`
	Buildings      []string         `json:"buildings"`
	GoodsDelivered []string         `json:"goods_delivered"`
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

type recipeJSON struct {
	Inputs  []goodAmountJSON `json:"inputs"`
	Outputs []goodAmountJSON `json:"outputs"`
	CycleMs int64            `json:"cycle_ms"`
}

type houseJSON struct {
	Tier string `json:"tier"`
}

type warehouseLevelJSON struct {
	Capacity         int64 `json:"capacity"`
	ThroughputPerMin int64 `json:"throughput_per_min"`
	// Cost is the upgrade cost into the level (absent on the first level).
	Cost *costJSON `json:"cost,omitempty"`
}

type warehouseJSON struct {
	Levels []warehouseLevelJSON `json:"levels"`
}

type roadJSON struct {
	MsPerTile int64 `json:"ms_per_tile"`
}

type serviceJSON struct {
	Radius int `json:"radius"`
}

type workAreaJSON struct {
	Radius        int      `json:"radius"`
	Terrain       []string `json:"terrain"`
	RequiredTiles int      `json:"required_tiles"`
	Fertility     string   `json:"fertility,omitempty"`
}

type workforceJSON struct {
	Tier   string `json:"tier"`
	Amount int64  `json:"amount"`
}

type buildingJSON struct {
	ID            string           `json:"id"`
	Name          string           `json:"name"`
	Tier          string           `json:"tier"`
	Category      string           `json:"category"`
	Width         int              `json:"width"`
	Height        int              `json:"height"`
	Coastal       bool             `json:"coastal"`
	RequiresRoad  bool             `json:"requires_road"`
	Cost          costJSON         `json:"cost"`
	UpkeepPerMin  int64            `json:"upkeep_per_min"`
	PauseCategory string           `json:"pause_category"`
	Recipe        *recipeJSON      `json:"recipe,omitempty"`
	House         *houseJSON       `json:"house,omitempty"`
	Warehouse     *warehouseJSON   `json:"warehouse,omitempty"`
	Road          *roadJSON        `json:"road,omitempty"`
	Service       *serviceJSON     `json:"service,omitempty"`
	WorkArea      *workAreaJSON    `json:"work_area,omitempty"`
	Workforce     *workforceJSON   `json:"workforce,omitempty"`
	Shipyard      *shipyardJSONOut `json:"shipyard,omitempty"`
	// RequiresDeposit is the deposit kind the footprint must cover.
	RequiresDeposit string `json:"requires_deposit,omitempty"`
}

type needGoodJSON struct {
	Good              string `json:"good"`
	PerResidentPerMin int64  `json:"per_resident_per_min"`
}

type needJSON struct {
	ID              string         `json:"id"`
	Tier            string         `json:"tier"`
	Kind            string         `json:"kind"`
	WeightPpm       int64          `json:"weight"`
	Category        string         `json:"category,omitempty"`
	Goods           []needGoodJSON `json:"goods,omitempty"`
	VarietyBonusPpm *int64         `json:"variety_bonus,omitempty"`
	MaxExtraGoods   *int           `json:"max_extra_goods,omitempty"`
	Building        string         `json:"building,omitempty"`
	Radius          *int           `json:"radius,omitempty"`
}

// buildingCategory derives the build-menu group of a building from its
// capability blocks.
func buildingCategory(b *content.Building) string {
	switch {
	case b.House != nil:
		return categoryHouses
	case b.Recipe != nil:
		return categoryProduction
	case b.Service != nil:
		return categoryPublic
	case b.Warehouse != nil, b.Shipyard != nil:
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

func newContentPayload(c *content.Catalogue) contentPayload {
	r := c.Region.Rules
	p := contentPayload{
		Region: regionJSON{
			ID: c.Region.ID, Name: c.Region.Name, Version: c.Region.Version,
			Rules: rulesJSON{
				TransferBaseMs: r.TransferBaseMs, UnconnectedBuffer: r.UnconnectedBuffer,
				IterationCap: r.IterationCap, CoarseStepMs: r.CoarseStepMs,
				GrowthPerMin: r.GrowthPerMin, DeclinePerMin: r.DeclinePerMin,
				GrowthThresholdPpm: r.GrowthThreshold, OptionalTaxBonusPpm: r.OptionalTaxBonus,
				AutoResumeUpkeepDurationMs: r.AutoResumeMs,
				ShipHandlingMs:             r.ShipHandlingMs, ShipSpeedMilliTilesPerMin: r.ShipSpeedMilliTilesPerMin,
			},
		},
		Tiers: []tierJSON{}, Goods: []goodJSON{}, Buildings: []buildingJSON{}, Needs: []needJSON{}, Ships: []shipJSONOut{},
	}
	for _, sh := range c.Ships {
		sj := shipJSONOut{
			ID: sh.ID, Name: sh.Name, Tier: sh.Tier, Slots: sh.Slots, SlotSize: sh.SlotSize, SpeedPermille: sh.SpeedPermille,
			BuildMs: sh.BuildMs, Cost: costJSON{Gold: sh.Cost.Gold, Materials: map[string]int64{}}, UpkeepPerMin: sh.UpkeepPerMin,
		}
		for _, m := range sh.Cost.Materials {
			sj.Cost.Materials[m.Good] = m.Amount
		}
		p.Ships = append(p.Ships, sj)
	}
	for _, t := range c.Tiers {
		tj := tierJSON{
			ID: t.ID, Name: t.Name, Index: t.Index,
			ResidentsFloor: t.ResidentsFloor, ResidentsMax: t.ResidentsMax,
			TaxPerResidentPerMin: t.TaxPerResidentPerMin,
			Unlock: unlockJSON{
				Population:     map[string]int64{},
				Buildings:      append([]string{}, t.Unlock.Buildings...),
				GoodsDelivered: append([]string{}, t.Unlock.GoodsDelivered...),
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
		p.Goods = append(p.Goods, goodJSON{ID: g.ID, Name: g.Name, Type: g.Type})
	}
	for _, b := range c.Buildings {
		p.Buildings = append(p.Buildings, newBuildingJSON(b))
	}
	for _, t := range c.Tiers {
		for _, n := range c.NeedsByTier[t.ID] {
			p.Needs = append(p.Needs, newNeedJSON(n))
		}
	}
	return p
}

func newBuildingJSON(b *content.Building) buildingJSON {
	bj := buildingJSON{
		ID: b.ID, Name: b.Name, Tier: b.Tier, Category: buildingCategory(b),
		Width: b.Width, Height: b.Height, Coastal: b.Coastal, RequiresRoad: b.RequiresRoad,
		Cost:         newCostJSON(b.Cost),
		UpkeepPerMin: b.UpkeepPerMin, PauseCategory: b.PauseCategory, RequiresDeposit: b.RequiresDeposit,
	}
	if r := b.Recipe; r != nil {
		bj.Recipe = &recipeJSON{Inputs: goodAmounts(r.Inputs), Outputs: goodAmounts(r.Outputs), CycleMs: r.CycleMs}
	}
	if h := b.House; h != nil {
		bj.House = &houseJSON{Tier: h.Tier}
	}
	if wh := b.Warehouse; wh != nil {
		bj.Warehouse = &warehouseJSON{Levels: []warehouseLevelJSON{}}
		for _, l := range wh.Levels {
			lj := warehouseLevelJSON{Capacity: l.Capacity, ThroughputPerMin: l.ThroughputPerMin}
			if l.Cost != nil {
				cost := newCostJSON(*l.Cost)
				lj.Cost = &cost
			}
			bj.Warehouse.Levels = append(bj.Warehouse.Levels, lj)
		}
	}
	if rd := b.Road; rd != nil {
		bj.Road = &roadJSON{MsPerTile: rd.MsPerTile}
	}
	if s := b.Service; s != nil {
		bj.Service = &serviceJSON{Radius: s.Radius}
	}
	if wa := b.WorkArea; wa != nil {
		bj.WorkArea = &workAreaJSON{Radius: wa.Radius, Terrain: append([]string{}, wa.Terrain...), RequiredTiles: wa.RequiredTiles, Fertility: wa.Fertility}
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

func newNeedJSON(n *content.Need) needJSON {
	nj := needJSON{ID: n.ID, Tier: n.Tier, Kind: n.Kind, WeightPpm: n.Weight}
	if n.IsGoods() {
		nj.Category = n.Category
		nj.VarietyBonusPpm = &n.VarietyBonus
		nj.MaxExtraGoods = &n.MaxExtraGoods
		for _, g := range n.Goods {
			nj.Goods = append(nj.Goods, needGoodJSON{Good: g.Good, PerResidentPerMin: g.PerResidentPerMin})
		}
	} else {
		nj.Building = n.Building
		nj.Radius = &n.Radius
	}
	return nj
}
