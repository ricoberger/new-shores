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
	if c.Region.Rules.CoarseStepMs <= 0 {
		col.add(FileRegion, fmt.Sprintf("region %q", c.Region.ID), "rules.coarse_step_seconds", "must be > 0")
	}

	for _, t := range c.Tiers {
		ent := fmt.Sprintf("tier %q", t.ID)
		for _, id := range slices.Sorted(maps.Keys(t.Unlock.Population)) {
			tier(FileTiers, ent, "unlock.population", id)
		}
		for i, id := range t.Unlock.Buildings {
			building(FileTiers, ent, fmt.Sprintf("unlock.buildings[%d]", i), id)
		}
		for i, id := range t.Unlock.GoodsDelivered {
			good(FileTiers, ent, fmt.Sprintf("unlock.goods_delivered[%d]", i), id)
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
			case t.House != b.ID:
				col.add(FileBuildings, ent, "house.tier", "tier %q uses house %q", h.Tier, t.House)
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

	for _, t := range c.Tiers {
		if _, ok := c.NeedsByTier[t.ID]; !ok {
			col.add(FileNeeds, fmt.Sprintf("tier %q", t.ID), "", "tier has no needs")
		}
	}
	for _, tierID := range slices.Sorted(maps.Keys(c.NeedsByTier)) {
		needs := c.NeedsByTier[tierID]
		var basic int64
		for _, n := range needs {
			ent := fmt.Sprintf("need %q", n.ID)
			tier(FileNeeds, ent, "tier", n.Tier)
			if n.Good != "" {
				good(FileNeeds, ent, "good", n.Good)
			}
			if n.Building != "" {
				building(FileNeeds, ent, "building", n.Building)
			}
			if n.Category == "basic" {
				basic += n.Weight
			}
		}
		// Weights are exact fixed-point integers (ppm), so the 1e-9 tolerance
		// of the spec is met by requiring exact equality.
		if _, ok := c.TierByID[tierID]; ok && basic != WeightScale {
			col.add(FileNeeds, fmt.Sprintf("tier %q", tierID), "weight", "basic need weights sum to %d ppm, want %d", basic, WeightScale)
		}
	}
	return col.err()
}
