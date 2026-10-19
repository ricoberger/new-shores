package sim

import (
	"github.com/ricoberger/new-shores/server/internal/content"
)

// Population rules (refining MECHANICS §4 workforce and §6).
//
// Houses have whole-number residents R and a signed growth accumulator A
// (HouseState). Everything that depends on the population (house demand,
// taxes, workforce, unlock population) uses R, which only changes at
// "residents" boundaries, so all rates stay piecewise constant.
//
// Goods needs are evaluated per island and tier. For a category with goods
// g1..gn (file order) and N residents of the tier on the island, a good is
// supplied when it is not starved, or starved with a positive arrival rate;
// m is the number of supplied goods. Every supplied good has the nominal
// demand N x rate_i / m. A starved good gets its proportional share of the
// arrivals when its consumers demand more than arrives; otherwise it gets
// its demand and the excess arrivals are its slack. The shortfall of each
// good (demand - consumed, converted at the per-resident rates) is drawn in
// file order from the goods with slack: a non-starved good has unlimited
// slack (until its stock empties, which is a stock_empty boundary), a
// starved good its excess arrivals. Fulfilment is 1 when a supplied good is
// not starved, else sum(consumed_i / (N x rate_i)), at most 1; variety =
// min(m - 1, max_extra_goods).
//
// A starved good leaves the regime when the consumption it would have if it
// were not starved (the same allocation with unlimited slack for this good)
// plus its producer demand does not exceed its arrivals, so regime entry and
// exit agree with the allocation and nothing alternates within a settle.
//
// Building needs are per house: fulfilled when a non-paused, road-connected
// building of the type has a footprint tile within Euclidean distance radius
// of the house entrance (tile centres).

// Goods need reasons and building need reasons (display).
const (
	NeedOK           = "ok"
	NeedShortSupply  = "short_supply"
	NeedNoSupply     = "no_supply"
	NeedOutOfRange   = "out_of_range"
	NeedNotConnected = "not_connected"
	NeedPaused       = "paused"
)

// workforcePool is the workforce of one tier on one island (milli-residents).
type workforcePool struct {
	available Qty
	required  Qty
}

// factorPermille returns min(1, available / required) in per-mille.
func (p *workforcePool) factorPermille() int64 {
	if p.required <= p.available {
		return 1000
	}
	return p.available * 1000 / p.required
}

// islandPopulation returns the residents (milli) per tier on the island.
func islandPopulation(is *Island, c *content.Catalogue) map[string]Qty {
	pop := map[string]Qty{}
	for _, b := range is.Buildings {
		if t := houseTier(b, c); t != nil {
			pop[t.ID] += b.House.Residents
		}
	}
	return pop
}

// houseTier returns the tier of a house or nil for other buildings.
func houseTier(b *Building, c *content.Catalogue) *content.Tier {
	if b.House == nil {
		return nil
	}
	def := c.BuildingByID[b.Type]
	if def == nil || def.House == nil {
		return nil
	}
	return c.TierByID[def.House.Tier]
}

// workforcePools returns the workforce pool of every tier that has houses,
// a seed grant or demand on the island. Paused buildings require no workers;
// unconnected ones do.
func workforcePools(is *Island, c *content.Catalogue) map[string]*workforcePool {
	pools := map[string]*workforcePool{}
	get := func(tier string) *workforcePool {
		p := pools[tier]
		if p == nil {
			p = &workforcePool{}
			pools[tier] = p
		}
		return p
	}
	for tier, n := range islandPopulation(is, c) {
		get(tier).available += n
	}
	for tier, n := range is.WorkforceGrant {
		get(tier).available += n
	}
	for _, b := range is.Buildings {
		def := c.BuildingByID[b.Type]
		if def == nil || def.Workforce == nil || b.Paused {
			continue
		}
		get(def.Workforce.Tier).required += def.Workforce.Amount
	}
	return pools
}

// goodsNeedState is the island-wide evaluation of one goods need of a tier.
type goodsNeedState struct {
	need *content.Need
	// residents of the tier on the island (milli).
	residents Qty
	// full[i] is N x rate_i (sub-milli per ms): the consumption that alone
	// fulfils the need.
	full     []int64
	supplied []bool
	m        int
	demand   []int64
	cons     []int64
	// fulfilment in ppm.
	fulfilment int64
	variety    int
}

// needRate converts residents (milli) x per-resident rate
// (milli-units per minute) into sub-milli units per millisecond.
func needRate(residents, perResidentPerMin Qty) int64 {
	return residents * perResidentPerMin * (SubPerMilli / msPerMinute) / content.MilliPerUnit
}

// prepareHouseDemand computes the supplied goods and nominal demand of every
// goods need on the island.
func (r *rates) prepareHouseDemand(is *Island, c *content.Catalogue) {
	pop := islandPopulation(is, c)
	inv := &is.Inventory
	for _, t := range c.Tiers {
		n, ok := pop[t.ID]
		if !ok {
			continue // no house of the tier on the island
		}
		for _, need := range c.NeedsByTier[t.ID] {
			if !need.IsGoods() {
				continue
			}
			gs := &goodsNeedState{
				need: need, residents: n,
				full:     make([]int64, len(need.Goods)),
				supplied: make([]bool, len(need.Goods)),
				demand:   make([]int64, len(need.Goods)),
				cons:     make([]int64, len(need.Goods)),
			}
			for i, g := range need.Goods {
				gs.full[i] = needRate(n, g.PerResidentPerMin)
				gs.supplied[i] = !inv.Starved[g.Good] || r.inflow[g.Good] > 0
				if gs.supplied[i] {
					gs.m++
				}
			}
			for i, g := range need.Goods {
				if !gs.supplied[i] {
					// Demand the good would have if it were supplied (only
					// used for the exit test of the starved regime; with no
					// arrivals any positive demand keeps the good starved).
					r.houseExit[g.Good] += gs.full[i] / int64(gs.m+1)
					continue
				}
				gs.demand[i] = gs.full[i] / int64(gs.m)
				r.houseDemand[g.Good] += gs.demand[i]
			}
			if gs.m > 0 {
				gs.variety = min(gs.m-1, need.MaxExtraGoods)
			}
			r.goodsNeeds[t.ID] = append(r.goodsNeeds[t.ID], gs)
		}
	}
}

// consumeHouseNeeds sets the house consumption and the fulfilment of every
// goods need, and the exit demand of starved supplied goods.
func (r *rates) consumeHouseNeeds(is *Island, c *content.Catalogue) {
	r.houseCons = r.allocateHouses(is, c, "", true)
	for _, good := range sortedKeys(is.Inventory.Starved) {
		if r.inflow[good] > 0 && r.houseDemand[good] > 0 {
			r.houseExit[good] += r.allocateHouses(is, c, good, false)[good]
		}
	}
}

// allocateHouses computes the house consumption per good (sub-milli per
// ms). The good treat is handled as if it were not starved (exit test).
// With commit set, the consumption and fulfilment are stored on the goods
// need states.
func (r *rates) allocateHouses(is *Island, c *content.Catalogue, treat string, commit bool) map[string]int64 {
	inv := &is.Inventory
	starved := func(g string) bool { return g != treat && inv.Starved[g] }
	// slack is the island-wide excess arrival rate of starved goods,
	// shared by all needs in tier and file order.
	slack := map[string]int64{}
	for g, share := range r.starvedShare {
		if g != treat {
			slack[g] = max(share[0]-share[1], 0)
		}
	}
	total := map[string]int64{}
	for _, t := range c.Tiers {
		for _, gs := range r.goodsNeeds[t.ID] {
			goods := gs.need.Goods
			use := make([]int64, len(goods))
			fulfilment := int64(ppm)
			if gs.residents > 0 {
				unlimited := false
				for i, g := range goods {
					if !gs.supplied[i] {
						continue
					}
					use[i] = gs.demand[i]
					if !starved(g.Good) {
						unlimited = true
					} else if share := r.starvedShare[g.Good]; share[1] > share[0] {
						use[i] = mulDiv(gs.demand[i], share[0], share[1])
					}
				}
				for j := range goods {
					short := gs.demand[j] - use[j]
					for k := 0; k < len(goods) && short > 0; k++ {
						if k == j || !gs.supplied[k] {
							continue
						}
						want := mulDivAny(short, gs.full[k], gs.full[j])
						if !starved(goods[k].Good) {
							use[k] += want
							short = 0
							continue
						}
						take := min(want, slack[goods[k].Good])
						if take <= 0 {
							continue
						}
						use[k] += take
						slack[goods[k].Good] -= take
						if take == want {
							short = 0
						} else {
							short -= mulDivAny(take, gs.full[j], gs.full[k])
						}
					}
				}
				if !unlimited {
					fulfilment = 0
					for i := range goods {
						fulfilment += mulDivAny(use[i], ppm, gs.full[i])
					}
					fulfilment = min(fulfilment, ppm)
				}
			}
			for i, g := range goods {
				total[g.Good] += use[i]
			}
			if commit {
				gs.cons, gs.fulfilment = use, fulfilment
			}
		}
	}
	return total
}

// needResult is the fulfilment of one need for one house.
type needResult struct {
	need *content.Need
	// fulfilment in ppm.
	fulfilment int64
	reason     string
	goods      *goodsNeedState
}

// houseCalc holds the derived values of one house.
type houseCalc struct {
	b    *Building
	tier *content.Tier
	// satisfaction, variety multiplier and optional fulfilment in ppm.
	satisfaction int64
	variety      int64
	optional     int64
	// tax in gold sub-units per ms (= milli-gold per minute).
	tax int64
	// growth is the accumulator rate in ResidentSub units per ms (signed).
	growth int64
	needs  []needResult
}

// computeHouses derives satisfaction, taxes and growth of every house and
// the island's tax and upkeep.
func (r *rates) computeHouses(is *Island, c *content.Catalogue) {
	rules := c.Region.Rules
	for _, b := range is.Buildings {
		def := c.BuildingByID[b.Type]
		if def != nil && !b.Paused {
			r.upkeep += def.UpkeepPerMin
		}
		tier := houseTier(b, c)
		if tier == nil {
			continue
		}
		h := &houseCalc{b: b, tier: tier, variety: ppm}
		var required, optional, optWeight int64
		gi := 0
		for _, need := range c.NeedsByTier[tier.ID] {
			res := needResult{need: need}
			if need.IsGoods() {
				gs := r.goodsNeeds[tier.ID][gi]
				gi++
				res.goods, res.fulfilment = gs, gs.fulfilment
				switch {
				case gs.fulfilment >= ppm:
					res.reason = NeedOK
				case gs.fulfilment == 0:
					res.reason = NeedNoSupply
				default:
					res.reason = NeedShortSupply
				}
				h.variety += int64(gs.variety) * need.VarietyBonus
			} else {
				res.reason = buildingNeed(is, c, def, b, need)
				if res.reason == NeedOK {
					res.fulfilment = ppm
				}
			}
			if need.Kind == content.NeedOptional {
				optional += need.Weight * res.fulfilment
				optWeight += need.Weight
			} else {
				required += need.Weight * res.fulfilment
			}
			h.needs = append(h.needs, res)
		}
		// Required weights sum to 1 (content validation), so the weighted
		// mean is the weighted sum; without required needs it is 1.
		h.satisfaction = ppm
		if hasRequired(h.needs) {
			h.satisfaction = required / ppm
		}
		if optWeight > 0 {
			h.optional = optional / optWeight
		}

		// Tax = rate x R x satisfaction x variety x (1 + bonus x optional).
		tax := tier.TaxPerResidentPerMin * b.House.Residents / content.MilliPerUnit
		tax = mulDivAny(tax, h.satisfaction, ppm)
		tax = mulDivAny(tax, h.variety, ppm)
		h.tax = mulDivAny(tax, ppm+rules.OptionalTaxBonus*h.optional/ppm, ppm)
		r.tax += h.tax

		h.growth = growthRate(rules, h.satisfaction, h.variety)
		hs := b.House
		switch {
		case h.growth > 0 && hs.Residents >= tier.ResidentsMax && hs.Growth >= 0:
			h.growth = 0
		case h.growth < 0 && hs.Residents <= tier.ResidentsFloor && hs.Growth <= 0:
			h.growth = 0
		}
		r.houses = append(r.houses, h)
	}
}

func hasRequired(needs []needResult) bool {
	for _, n := range needs {
		if n.need.Kind != content.NeedOptional {
			return true
		}
	}
	return false
}

// growthRate returns the accumulator rate in ResidentSub units per ms:
// growth_per_min x satisfaction x variety when satisfaction >= threshold,
// else -decline_per_min x (threshold - satisfaction). Magnitudes round down.
func growthRate(rules content.Rules, satisfaction, variety int64) int64 {
	// 1 milli-resident per minute = ResidentSub / 1000 / msPerMinute = 1000
	// units per ms.
	const unitsPerMilliPerMin = ResidentSub / content.MilliPerUnit / msPerMinute
	if satisfaction >= rules.GrowthThreshold {
		g := mulDivAny(rules.GrowthPerMin*unitsPerMilliPerMin, satisfaction, ppm)
		return mulDivAny(g, variety, ppm)
	}
	return -mulDivAny(rules.DeclinePerMin*unitsPerMilliPerMin, rules.GrowthThreshold-satisfaction, ppm)
}

// buildingNeed evaluates a building need for one house and returns its
// reason (NeedOK when fulfilled). Among buildings of the type within range,
// a usable one wins; otherwise an unconnected one reports not_connected and
// a paused one paused.
func buildingNeed(is *Island, c *content.Catalogue, houseDef *content.Building, house *Building, need *content.Need) string {
	e := entrance(houseDef, house.X, house.Y, house.Rotation)
	reason := NeedOutOfRange
	for _, b := range is.Buildings {
		if b.Type != need.Building {
			continue
		}
		def := c.BuildingByID[b.Type]
		if def == nil || !withinRadius(def, b, e, need.Radius) {
			continue
		}
		switch {
		case b.Paused:
			if reason == NeedOutOfRange {
				reason = NeedPaused
			}
		case b.AssignedWarehouseID == 0:
			reason = NeedNotConnected
		default:
			return NeedOK
		}
	}
	return reason
}

// withinRadius reports whether the footprint tile of b nearest to p lies
// within the Euclidean distance radius of p (tile centres, exact integers).
func withinRadius(def *content.Building, b *Building, p Pos, radius int) bool {
	w, h := footprint(def, b.Rotation)
	dx := max(b.X-p.X, 0, p.X-(b.X+w-1))
	dy := max(b.Y-p.Y, 0, p.Y-(b.Y+h-1))
	return dx*dx+dy*dy <= radius*radius
}

// normalizeHouses applies the discrete effect of residents boundaries: an
// accumulator at +1 resident adds a resident, at -1 removes one; at a
// residents bound the accumulator stops at 0.
func normalizeHouses(is *Island, c *content.Catalogue) {
	for _, b := range is.Buildings {
		tier := houseTier(b, c)
		if tier == nil {
			continue
		}
		h := b.House
		switch {
		case h.Growth >= ResidentSub:
			if h.Residents < tier.ResidentsMax {
				h.Residents += content.MilliPerUnit
			}
			h.Growth = 0
		case h.Growth <= -ResidentSub:
			if h.Residents > tier.ResidentsFloor {
				h.Residents -= content.MilliPerUnit
			}
			h.Growth = 0
		}
		if (h.Residents >= tier.ResidentsMax && h.Growth > 0) || (h.Residents <= tier.ResidentsFloor && h.Growth < 0) {
			h.Growth = 0
		}
	}
}
