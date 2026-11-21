package scenario

import (
	"sort"
	"testing"

	"github.com/ricoberger/new-shores/server/internal/content"
	"github.com/ricoberger/new-shores/server/internal/sim"
)

// referenceGames are the four reference games of CONTENT §12.
var referenceGames = []string{"bootstrap_citizens", "bootstrap_citizens_quests", "bootstrap_merchants", "bootstrap_patricians"}

// maxSurplusPermille bounds the producer capacity of a consumption good
// at the end of a reference game (CONTENT §12 balance checklist): the
// plans build to the game's peak demand × 1.25, so 60 % above the final
// demand is the most a plan may leave standing.
const maxSurplusPermille = 600

// TestReferenceGamesSurplus (CONTENT §12, D-080): at the end of every
// reference game, no consumption good (a good of any goods need) has more
// than 60 % surplus capacity across the archipelago, beyond the last
// producer: a good fails when its capacity without one producer still
// exceeds 1.6 × its demand, i.e. the plan builds a producer the game
// never needs. One producer of a good with a small demand (a slaughterhouse
// for four Patrician houses) is granularity, not surplus.
//
// Demand is the houses' consumption of the good (the display's island-wide
// rates per tier) plus the nominal input of the producers that use it
// (wool garments for the tailor); capacity is the nominal output of every
// producer of the good, wherever it stands (goods ship between islands).
func TestReferenceGamesSurplus(t *testing.T) {
	for _, name := range referenceGames {
		t.Run(name, func(t *testing.T) {
			if name == "bootstrap_patricians" && testing.Short() {
				t.Skip("slow: run without -short")
			}
			r := replay(t, name)
			for _, row := range referenceSurplus(r.c, &r.rep.Final) {
				t.Logf("%-16s demand %6d capacity %6d (%d × %d) milli/min: surplus %d ‰", row.good, row.demand, row.capacity, row.producers, row.rate, row.surplusPermille())
				if row.capacity-row.rate > row.demand*(1000+maxSurplusPermille)/1000 {
					t.Errorf("%s: %d producers of %s (%d milli/min each) for a demand of %d milli/min: surplus %d ‰ beyond the last producer, want at most %d ‰",
						name, row.producers, row.good, row.rate, row.demand, row.surplusPermille(), maxSurplusPermille)
				}
			}
		})
	}
}

type surplusRow struct {
	good                   string
	demand, capacity, rate int64
	producers              int64
}

func (r surplusRow) surplusPermille() int64 {
	if r.demand == 0 {
		return -1
	}
	return r.capacity*1000/r.demand - 1000
}

// referenceSurplus returns, for every consumption good with a producer or
// a demand, the archipelago-wide demand and producer capacity (milli-units
// per minute), sorted by good.
func referenceSurplus(c *content.Catalogue, d *sim.DisplayState) []surplusRow {
	needGoods := map[string]bool{}
	for _, needs := range c.NeedsByTier {
		for _, n := range needs {
			for _, g := range n.Goods {
				needGoods[g.Good] = true
			}
		}
	}
	houseTier := map[string]string{}
	for _, tr := range c.Tiers {
		if tr.House != "" {
			houseTier[tr.House] = tr.ID
		}
	}
	demand := map[string]int64{}
	capacity := map[string]int64{}
	producers := map[string]int64{}
	rate := map[string]int64{}
	for _, is := range d.Islands {
		seen := map[string]bool{}
		for _, b := range is.Buildings {
			if tier, ok := houseTier[b.Type]; ok {
				// The rates are island-wide per tier: one house each.
				if seen[tier] {
					continue
				}
				seen[tier] = true
				for _, n := range b.Needs {
					for g, q := range n.Goods {
						demand[g] += int64(q)
					}
				}
				continue
			}
			def := c.BuildingByID[b.Type]
			if def == nil || def.Recipe == nil {
				continue
			}
			for _, out := range def.Recipe.Outputs {
				if needGoods[out.Good] {
					r := int64(out.Amount) * 60_000 / def.Recipe.CycleMs
					capacity[out.Good] += r
					producers[out.Good]++
					rate[out.Good] = max(rate[out.Good], r)
				}
			}
			for _, in := range def.Recipe.Inputs {
				if needGoods[in.Good] {
					demand[in.Good] += int64(in.Amount) * 60_000 / def.Recipe.CycleMs
				}
			}
		}
	}
	var rows []surplusRow
	for g := range needGoods {
		if demand[g] == 0 && capacity[g] == 0 {
			continue
		}
		rows = append(rows, surplusRow{good: g, demand: demand[g], capacity: capacity[g], rate: rate[g], producers: producers[g]})
	}
	sort.Slice(rows, func(i, j int) bool { return rows[i].good < rows[j].good })
	return rows
}
