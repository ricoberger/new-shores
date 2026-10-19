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
	if rules.AutoResumeMs < 0 {
		col.add(FileRegion, rent, "rules.auto_resume_upkeep_minutes", "must be >= 0")
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
			}
		}
		if b.Road != nil && (b.Width != 1 || b.Height != 1) {
			col.add(FileBuildings, ent, "footprint", "road buildings must be 1x1")
		}
		if b.Road != nil && b.Recipe != nil {
			col.add(FileBuildings, ent, "road", "a road cannot have a recipe")
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
