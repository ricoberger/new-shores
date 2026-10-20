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
	if rules.OptionalTaxBonus < 0 {
		col.add(FileRegion, rent, "rules.optional_tax_bonus", "must be >= 0")
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
	if rules.ShipHandlingMs < 0 {
		col.add(FileRegion, rent, "rules.ship_handling_seconds", "must be >= 0")
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
		for i, id := range t.Unlock.GoodsDelivered {
			good(FileTiers, ent, fmt.Sprintf("unlock.goods_delivered[%d]", i), id)
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
		if w := b.Warehouse; w != nil {
			for i, l := range w.Levels {
				if l.Capacity <= 0 || l.ThroughputPerMin <= 0 {
					col.add(FileBuildings, ent, fmt.Sprintf("warehouse.levels[%d]", i), "capacity and throughput must be > 0")
				}
				// The first level is placed with the building cost; every
				// later level is reached by an upgrade with its own cost.
				field := fmt.Sprintf("warehouse.levels[%d].cost", i)
				switch {
				case i == 0 && l.Cost != nil:
					col.add(FileBuildings, ent, field, "the first level has no cost (the building cost places it)")
				case i > 0 && l.Cost == nil:
					col.add(FileBuildings, ent, field, "an upgrade level needs a cost")
				case l.Cost != nil && l.Cost.Gold < 0:
					col.add(FileBuildings, ent, field+".gold", "must be >= 0")
				}
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
			if n.Building != "" {
				building(FileNeeds, ent, "building", n.Building)
			}
			if n.VarietyBonus < 0 {
				col.add(FileNeeds, ent, "variety_bonus", "must be >= 0")
			}
			switch n.Kind {
			case NeedRequired:
				required += n.Weight
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
