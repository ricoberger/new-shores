package content

import (
	"fmt"
	"maps"
	"slices"
)

// checkReferences validates reference integrity and semantic rules that JSON
// Schema cannot express. All problems are reported together.
func checkReferences(c *Catalogue) error {
	col := &collector{}
	good := func(file, ent, field, id string) {
		if _, ok := c.GoodByID[id]; !ok {
			col.add(file, ent, field, "unknown good %q", id)
		}
	}
	building := func(file, ent, field, id string) {
		if _, ok := c.BuildingByID[id]; !ok {
			col.add(file, ent, field, "unknown building %q", id)
		}
	}
	tier := func(file, ent, field, id string) {
		if _, ok := c.TierByID[id]; !ok {
			col.add(file, ent, field, "unknown tier %q", id)
		}
	}

	if c.Region.Rules.IterationCap < 1 {
		col.add(FileRegion, fmt.Sprintf("region %q", c.Region.ID), "rules.iteration_cap", "must be >= 1")
	}
	rules, rent := c.Region.Rules, fmt.Sprintf("region %q", c.Region.ID)
	if rules.CoarseStepMs <= 0 {
		col.add(FileRegion, rent, "rules.coarse_step_seconds", "must be > 0")
	}
	if rules.GrowthPerMin <= 0 {
		col.add(FileRegion, rent, "rules.growth_per_min", "must be > 0")
	}
	if rules.DeclinePerMin <= 0 {
		col.add(FileRegion, rent, "rules.decline_per_min", "must be > 0")
	}
	if rules.GrowthThreshold < 0 || rules.GrowthThreshold > WeightScale {
		col.add(FileRegion, rent, "rules.growth_satisfaction_threshold", "must be in [0, 1]")
	}
	// The reserve is the hysteresis between insolvency pauses and
	// auto-resumes; without it a building can be paused and resumed every
	// millisecond (MECHANICS §7).
	if rules.AutoResumeMs <= 0 {
		col.add(FileRegion, rent, "rules.auto_resume_upkeep_minutes", "must be > 0")
	}
	// The trial reserve lets an unpaid building run although the balance
	// stays negative; it must be strictly above the normal reserve so that
	// a trial only happens after the normal resume had its chance.
	if rules.TrialResumeMs <= rules.AutoResumeMs {
		col.add(FileRegion, rent, "rules.trial_resume_upkeep_minutes", "must be greater than auto_resume_upkeep_minutes")
	}
	if rules.ShipHandlingBaseMs < 0 {
		col.add(FileRegion, rent, "rules.ship_handling_base_seconds", "must be >= 0")
	}
	if rules.ShipHandlingMsPerUnit < 0 {
		col.add(FileRegion, rent, "rules.ship_handling_seconds_per_unit", "must be >= 0")
	}
	if rules.ShipSpeedMilliTilesPerMin <= 0 {
		col.add(FileRegion, rent, "rules.ship_speed_tiles_per_min", "must be > 0")
	}
	if rules.AwaySummaryMs <= 0 {
		col.add(FileRegion, rent, "rules.away_summary_minutes", "must be >= 1")
	}

	for _, t := range c.Tiers {
		ent := fmt.Sprintf("tier %q", t.ID)
		for _, id := range slices.Sorted(maps.Keys(t.Unlock.Population)) {
			// Population conditions refer to tiers earlier in progression order.
			switch pt, ok := c.TierByID[id]; {
			case !ok:
				col.add(FileTiers, ent, "unlock.population", "unknown tier %q", id)
			case pt.Index >= t.Index:
				col.add(FileTiers, ent, "unlock.population", "tier %q does not precede %q", id, t.ID)
			}
		}
		for i, id := range t.Unlock.Buildings {
			building(FileTiers, ent, fmt.Sprintf("unlock.buildings[%d]", i), id)
		}
		_, hasNeeds := c.NeedsByTier[t.ID]
		if t.House == "" {
			// Declared-only tier: no house and no needs yet.
			if hasNeeds {
				col.add(FileNeeds, ent, "", "declared-only tier (no house) must not have needs")
			}
			continue
		}
		h, ok := c.BuildingByID[t.House]
		switch {
		case !ok:
			col.add(FileTiers, ent, "house", "unknown building %q", t.House)
		case h.House == nil:
			col.add(FileTiers, ent, "house", "building %q has no house block", t.House)
		case h.House.Tier != t.ID:
			col.add(FileTiers, ent, "house", "building %q belongs to tier %q", t.House, h.House.Tier)
		}
		if !hasNeeds {
			col.add(FileNeeds, ent, "", "tier has no needs")
		}
	}

	tradingPosts := 0
	for _, b := range c.Buildings {
		ent := fmt.Sprintf("building %q", b.ID)
		if b.Region != c.Region.ID {
			col.add(FileBuildings, ent, "region", "must be %q, got %q", c.Region.ID, b.Region)
		}
		tier(FileBuildings, ent, "tier", b.Tier)
		// A building that is never auto-paused carries no upkeep: its
		// running cost is folded into its price, so a fully stalled city
		// (everything pausable paused) never has a negative balance and
		// recovers on its own (D-009).
		if b.PauseCategory == "never" && b.UpkeepPerMin != 0 {
			col.add(FileBuildings, ent, "upkeep_per_min", "must be 0 for pause_category never")
		}
		for _, m := range b.Cost.Materials {
			good(FileBuildings, ent, "cost."+m.Good, m.Good)
		}
		if r := b.Recipe; r != nil {
			for i, in := range r.Inputs {
				good(FileBuildings, ent, fmt.Sprintf("recipe.inputs[%d].good", i), in.Good)
			}
			for i, out := range r.Outputs {
				good(FileBuildings, ent, fmt.Sprintf("recipe.outputs[%d].good", i), out.Good)
			}
		}
		if h := b.House; h != nil {
			t, ok := c.TierByID[h.Tier]
			switch {
			case !ok:
				col.add(FileBuildings, ent, "house.tier", "unknown tier %q", h.Tier)
			case t.House == "":
				col.add(FileBuildings, ent, "house.tier", "tier %q is declared only (no house)", h.Tier)
			case t.House != b.ID:
				col.add(FileBuildings, ent, "house.tier", "tier %q uses house %q", h.Tier, t.House)
			}
		}
		if wf := b.Workforce; wf != nil {
			tier(FileBuildings, ent, "workforce.tier", wf.Tier)
			if b.Recipe == nil {
				col.add(FileBuildings, ent, "workforce", "only buildings with a recipe can have a workforce")
			}
			if wf.Amount <= 0 {
				col.add(FileBuildings, ent, "workforce.amount", "must be >= 1")
			}
		}
		if tp := b.TradingPost; tp != nil {
			tradingPosts++
			for i, l := range tp.Levels {
				if l.Capacity <= 0 || l.ThroughputPerMin <= 0 || l.Berths < 1 {
					col.add(FileBuildings, ent, fmt.Sprintf("trading_post.levels[%d]", i), "capacity and throughput must be > 0 and berths >= 1")
				}
				checkLevelCost(col, ent, fmt.Sprintf("trading_post.levels[%d].cost", i), i, l.Cost)
			}
			if b.WaterTiles < 1 {
				col.add(FileBuildings, ent, "water_tiles", "a trading post is a water-edge building (water_tiles >= 1)")
			}
			if b.Warehouse != nil {
				col.add(FileBuildings, ent, "warehouse", "a building cannot be a trading post and a warehouse")
			}
		}
		if w := b.Warehouse; w != nil {
			for i, l := range w.Levels {
				if l.ThroughputPerMin <= 0 {
					col.add(FileBuildings, ent, fmt.Sprintf("warehouse.levels[%d]", i), "throughput must be > 0")
				}
				checkLevelCost(col, ent, fmt.Sprintf("warehouse.levels[%d].cost", i), i, l.Cost)
			}
		}
		if s := b.Service; s != nil {
			for i, l := range s.Levels {
				field := fmt.Sprintf("service.levels[%d]", i)
				if l.Radius < 1 {
					col.add(FileBuildings, ent, field+".radius", "must be >= 1")
				}
				if i > 0 && l.Radius < s.Levels[i-1].Radius {
					col.add(FileBuildings, ent, field+".radius", "must not be below the previous level's")
				}
				checkLevelCost(col, ent, field+".cost", i, l.Cost)
				switch {
				case i == 0 && l.Tier != "":
					col.add(FileBuildings, ent, field+".tier", "the first level has no tier condition")
				case l.Tier != "":
					tier(FileBuildings, ent, field+".tier", l.Tier)
				}
			}
			if b.TradingPost != nil || b.Warehouse != nil {
				col.add(FileBuildings, ent, "service", "a collector cannot be a public building")
			}
		}
		if b.WaterTiles != 0 {
			switch {
			case b.WaterTiles < 0 || b.WaterTiles >= b.Height:
				col.add(FileBuildings, ent, "water_tiles", "must be in [1, %d] (at least one land row)", max(b.Height-1, 1))
			case b.Coastal:
				col.add(FileBuildings, ent, "water_tiles", "a water-edge building is not also coastal")
			case b.RequiresDeposit != "":
				col.add(FileBuildings, ent, "water_tiles", "a water-edge building cannot require a deposit")
			}
		}
		if sy := b.Shipyard; sy != nil {
			seen := map[string]bool{}
			for i, id := range sy.Ships {
				field := fmt.Sprintf("shipyard.ships[%d]", i)
				if _, ok := c.ShipByID[id]; !ok {
					col.add(FileBuildings, ent, field, "unknown ship %q", id)
				}
				if seen[id] {
					col.add(FileBuildings, ent, field, "duplicate ship %q", id)
				}
				seen[id] = true
			}
			if len(sy.Ships) == 0 {
				col.add(FileBuildings, ent, "shipyard.ships", "must not be empty")
			}
		}
		if b.RequiresDeposit != "" && b.Recipe == nil {
			col.add(FileBuildings, ent, "requires_deposit", "only buildings with a recipe can require a deposit")
		}
		// work_area.fertility can only occur inside a work_area block: the
		// schema has no other place for it.
		if b.Road != nil && (b.Width != 1 || b.Height != 1) {
			col.add(FileBuildings, ent, "footprint", "road buildings must be 1x1")
		}
		if b.Road != nil && b.Recipe != nil {
			col.add(FileBuildings, ent, "road", "a road cannot have a recipe")
		}
	}

	// Every world starts at sea and settles by founding a Trading Post
	// (MECHANICS §8), so the content needs one.
	if tradingPosts == 0 {
		col.add(FileBuildings, "", "trading_post", "no building with a trading_post block")
	}

	checkFields(c, col)
	checkIslands(c, col)

	for _, s := range c.Ships {
		ent := fmt.Sprintf("ship %q", s.ID)
		if s.Region != c.Region.ID {
			col.add(FileShips, ent, "region", "must be %q, got %q", c.Region.ID, s.Region)
		}
		tier(FileShips, ent, "tier", s.Tier)
		if s.Slots < 1 {
			col.add(FileShips, ent, "slots", "must be >= 1")
		}
		if s.SlotSize <= 0 {
			col.add(FileShips, ent, "slot_size", "must be > 0")
		}
		if s.SpeedPermille <= 0 {
			col.add(FileShips, ent, "speed", "must be > 0")
		}
		if s.BuildMs <= 0 {
			col.add(FileShips, ent, "build_seconds", "must be > 0")
		}
		if s.UpkeepPerMin < 0 {
			col.add(FileShips, ent, "upkeep_per_min", "must be >= 0")
		}
		if s.Cost.Gold < 0 {
			col.add(FileShips, ent, "cost.gold", "must be >= 0")
		}
	}

	for _, q := range c.Quests {
		ent := fmt.Sprintf("quest %q", q.ID)
		for i, o := range q.Objectives {
			field := fmt.Sprintf("objectives[%d]", i)
			switch o.Kind {
			case ObjectiveBuildingCount, ObjectiveConnected:
				building(FileQuests, ent, field+".type", o.Building)
			case ObjectiveStock:
				good(FileQuests, ent, field+".good", o.Good)
			case ObjectivePopulation, ObjectiveTierUnlocked, ObjectiveSatisfaction:
				tier(FileQuests, ent, field+".tier", o.Tier)
			case ObjectiveRouteExists, ObjectiveIslandSettled, ObjectiveShipCount:
			default:
				col.add(FileQuests, ent, field+".kind", "unknown kind %q", o.Kind)
			}
			if o.Kind == ObjectiveSatisfaction && (o.Min <= 0 || o.Min > WeightScale) {
				col.add(FileQuests, ent, field+".min", "must be in (0, 1]")
			}
		}
		if len(q.Objectives) == 0 {
			col.add(FileQuests, ent, "objectives", "must not be empty")
		}
		for i, id := range q.Prerequisites {
			field := fmt.Sprintf("prerequisites[%d]", i)
			switch p, ok := c.QuestByID[id]; {
			case !ok:
				col.add(FileQuests, ent, field, "unknown quest %q", id)
			case p.Index >= q.Index:
				col.add(FileQuests, ent, field, "quest %q does not precede %q", id, q.ID)
			}
		}
		for _, g := range q.Rewards.Goods {
			good(FileQuests, ent, "rewards.goods."+g.Good, g.Good)
		}
		if q.Rewards.Gold <= 0 && len(q.Rewards.Goods) == 0 {
			col.add(FileQuests, ent, "rewards", "must reward gold or goods")
		}
	}

	for _, tierID := range slices.Sorted(maps.Keys(c.NeedsByTier)) {
		needs := c.NeedsByTier[tierID]
		var required int64
		for _, n := range needs {
			ent := fmt.Sprintf("need %q", n.ID)
			tier(FileNeeds, ent, "tier", n.Tier)
			seen := map[string]bool{}
			for i, g := range n.Goods {
				field := fmt.Sprintf("goods[%d].good", i)
				good(FileNeeds, ent, field, g.Good)
				if seen[g.Good] {
					col.add(FileNeeds, ent, field, "duplicate good %q", g.Good)
				}
				seen[g.Good] = true
				if g.PerResidentPerMin <= 0 {
					col.add(FileNeeds, ent, fmt.Sprintf("goods[%d].per_resident_per_min", i), "must be > 0")
				}
			}
			seenB := map[string]bool{}
			for i, nb := range n.Buildings {
				field := fmt.Sprintf("buildings[%d]", i)
				checkNeedBuilding(c, col, ent, field, n, nb.Building)
				if seenB[nb.Building] {
					col.add(FileNeeds, ent, field+".building", "duplicate building %q", nb.Building)
				}
				seenB[nb.Building] = true
				if nb.Share <= 0 || nb.Share > WeightScale {
					col.add(FileNeeds, ent, field+".share", "must be in (0, 1]")
				}
			}
			if n.IsGoods() || n.Category != "" {
				if _, ok := c.NeedCategoryByID[n.Category]; !ok {
					col.add(FileNeeds, ent, "category", "unknown need category %q (need_categories.json)", n.Category)
				}
			}
			for i, g := range n.Goods {
				if g.Share <= 0 || g.Share > WeightScale {
					col.add(FileNeeds, ent, fmt.Sprintf("goods[%d].share", i), "must be in (0, 1]")
				}
			}
			if n.FromTier != "" {
				checkFromTier(c, col, ent, n)
			}
			switch n.Kind {
			case NeedRequired:
				if n.FromTier == "" {
					required += n.Weight
				}
			case NeedOptional:
				if n.Weight <= 0 || n.Weight > WeightScale {
					col.add(FileNeeds, ent, "weight", "optional weight must be in (0, 1]")
				}
			default:
				col.add(FileNeeds, ent, "kind", "unknown kind %q", n.Kind)
			}
		}
		// Weights are exact fixed-point integers (ppm), so the 1e-9 tolerance
		// of the spec is met by requiring exact equality.
		if _, ok := c.TierByID[tierID]; ok && required != WeightScale {
			col.add(FileNeeds, fmt.Sprintf("tier %q", tierID), "weight", "required need weights sum to %d ppm, want %d", required, WeightScale)
		}
	}
	return col.err()
}

// checkFromTier validates a lower-tier category carried by a higher tier
// (D-056): from_tier is a lower tier that has a required goods need of the
// same category with the same goods, and the carried need is required.
// The content test checks the reduced rates.
func checkFromTier(c *Catalogue, col *collector, ent string, n *Need) {
	from, own := c.TierByID[n.FromTier], c.TierByID[n.Tier]
	if from == nil || own == nil || from.Index >= own.Index {
		col.add(FileNeeds, ent, "from_tier", "must be a lower tier than %q", n.Tier)
		return
	}
	if n.Kind != NeedRequired {
		col.add(FileNeeds, ent, "kind", "a lower-tier category must be required")
	}
	for _, src := range c.NeedsByTier[n.FromTier] {
		if src.Category != n.Category || src.FromTier != "" || src.Kind != NeedRequired {
			continue
		}
		if len(src.Goods) != len(n.Goods) {
			break
		}
		for i := range src.Goods {
			if src.Goods[i].Good != n.Goods[i].Good {
				col.add(FileNeeds, ent, "goods", "must list the goods of %q in its order", src.ID)
				return
			}
		}
		return
	}
	col.add(FileNeeds, ent, "category", "tier %q has no required goods need of category %q with the same goods", n.FromTier, n.Category)
}

// checkNeedBuilding validates an alternative of a building need: a public
// building (service block) of the need's tier or a lower one (services
// are cumulative, D-056).
func checkNeedBuilding(c *Catalogue, col *collector, ent, field string, n *Need, id string) {
	b, ok := c.BuildingByID[id]
	switch {
	case !ok:
		col.add(FileNeeds, ent, field+".building", "unknown building %q", id)
	case b.Service == nil:
		col.add(FileNeeds, ent, field+".building", "%q is not a public building (no service block)", id)
	default:
		bt, nt := c.TierByID[b.Tier], c.TierByID[n.Tier]
		if bt != nil && nt != nil && bt.Index > nt.Index {
			col.add(FileNeeds, ent, field+".building", "%q is of tier %q, above the need's tier %q", id, b.Tier, n.Tier)
		}
	}
}

// checkFields validates the fields of farms (D-049, D-051 part 4): every
// fields.type names a field type declared by exactly one field building,
// that field building names the farm (field.farm) and a farm has exactly
// one field type, no work radius and no terrain rule; a field is a
// building without a recipe or a work area (any footprint: crop tiles are
// 1x1, pasture modules 3x3 and larger, D-054).
// The schema enforces the other shape rules of both blocks.
func checkFields(c *Catalogue, col *collector) {
	declared := map[string]string{}
	farmField := map[string]string{}
	for _, b := range c.Buildings {
		ent := fmt.Sprintf("building %q", b.ID)
		if f := b.Fields; f != nil {
			fb := c.FieldByType[f.Type]
			switch {
			case fb == nil || fb.Field == nil || fb.Field.Type != f.Type:
				col.add(FileBuildings, ent, "fields.type", "no building with a field block of type %q", f.Type)
			case fb.Field.Farm != b.ID:
				col.add(FileBuildings, ent, "fields.type", "field type %q belongs to farm %q", f.Type, fb.Field.Farm)
			}
			if b.WorkArea != nil && b.WorkArea.Radius != 0 {
				col.add(FileBuildings, ent, "work_area.radius", "a farm with fields has no work radius")
			}
			if b.Field != nil {
				col.add(FileBuildings, ent, "field", "a farm cannot be a field")
			}
		}
		f := b.Field
		if f == nil {
			continue
		}
		if other, dup := declared[f.Type]; dup {
			col.add(FileBuildings, ent, "field.type", "field type %q already declared by building %q", f.Type, other)
		} else {
			declared[f.Type] = b.ID
		}
		farm := c.BuildingByID[f.Farm]
		switch {
		case farm == nil || farm.Fields == nil:
			col.add(FileBuildings, ent, "field.farm", "%q is not a farm with a fields block", f.Farm)
		case farm.Fields.Type != f.Type:
			col.add(FileBuildings, ent, "field.farm", "farm %q accepts field type %q, not %q", f.Farm, farm.Fields.Type, f.Type)
		}
		if other, dup := farmField[f.Farm]; dup {
			col.add(FileBuildings, ent, "field.farm", "farm %q already has the field building %q", f.Farm, other)
		} else {
			farmField[f.Farm] = b.ID
		}
		if b.Recipe != nil || b.WorkArea != nil {
			col.add(FileBuildings, ent, "field", "a field cannot have a recipe or a work area")
		}
	}
}

// checkLevelCost checks the cost of the i-th (0-based) level of a Trading
// Post or Warehouse: the first level is placed with the building cost;
// every later level is reached by an upgrade with its own cost.
func checkLevelCost(col *collector, ent, field string, i int, cost *Cost) {
	switch {
	case i == 0 && cost != nil:
		col.add(FileBuildings, ent, field, "the first level has no cost (the building cost places it)")
	case i > 0 && cost == nil:
		col.add(FileBuildings, ent, field, "an upgrade level needs a cost")
	case cost != nil && cost.Gold < 0:
		col.add(FileBuildings, ent, field+".gold", "must be >= 0")
	}
}
