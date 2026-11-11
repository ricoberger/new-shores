package archipelago

import (
	"fmt"
	"time"

	"github.com/ricoberger/new-shores/server/internal/content"
	"github.com/ricoberger/new-shores/server/internal/sim"
)

// RegionSeed returns the archipelago seed of the region with the given
// index (regions.json order) of a world seed (D-076): the world seed plus
// the index, wrapped into 1..MaxSeed; the home region's (index 0) is the
// world seed itself.
func RegionSeed(seed uint64, index int) uint64 {
	return (seed-1+uint64(index))%MaxSeed + 1 // #nosec G115 -- index >= 0
}

// GenerateRegion builds the archipelago of the region with the given
// index of the content's region list for the world seed: Generate on
// RegionSeed with the region's own catalogue (its generator rules and
// island ID prefix).
func GenerateRegion(seed uint64, index int, c *content.Catalogue) (*Archipelago, error) {
	if index < 0 || index >= len(c.Regions) {
		return nil, fmt.Errorf("archipelago: no region %d", index)
	}
	return Generate(RegionSeed(seed, index), c.Regions[index].Catalogue)
}

// NewWorld builds a new world on the archipelago of seed (roll 0)
// evaluated at start (truncated to milliseconds): no island settled, the
// start ship (the content's first ship type) at the archipelago's spawn
// carrying the content starting goods, the starting gold on the balance
// (D-051, D-053). Every content region gets its entry (D-076); only the
// home region is generated and unlocked (its passage point is the start
// position), the others are generated when they are opened.
func NewWorld(c *content.Catalogue, seed uint64, start time.Time) (*sim.World, error) {
	if seed == 0 || seed > MaxSeed {
		return nil, fmt.Errorf("archipelago: seed %d outside 1..%d", seed, MaxSeed)
	}
	a, err := GenerateRegion(seed, 0, c)
	if err != nil {
		return nil, err
	}
	w := sim.NewWorld(start)
	w.Seed = seed
	for i, r := range c.Regions {
		w.Regions = append(w.Regions, &sim.Region{ID: r.ID, Seed: RegionSeed(seed, i)})
	}
	home := w.HomeRegion()
	home.Unlocked = true
	home.PassagePoint = &a.Ship
	home.SetIslands(a.Islands)
	w.Gold = c.Start.Gold
	if len(c.Ships) == 0 {
		return nil, fmt.Errorf("archipelago: the content has no ship type")
	}
	cargo := map[string]sim.Qty{}
	for _, g := range c.Start.Goods {
		cargo[g.Good] += g.Amount
	}
	if _, err := sim.LaunchShipAtSea(w, c, c.Ships[0].ID, a.Ship, cargo); err != nil {
		return nil, fmt.Errorf("archipelago: start ship: %w", err)
	}
	return w, nil
}

// Reroll builds the command that replaces the archipelago of w by its
// next roll (reroll_archipelago, D-053): the archipelago of
// RollSeed(w.Seed, roll+1), every ship back at its spawn. It fails with
// sim.ErrRerollNotAllowed when the world can no longer be rerolled.
func Reroll(w *sim.World, c *content.Catalogue) (sim.RerollArchipelago, error) {
	if err := sim.CanReroll(w, c); err != nil {
		return sim.RerollArchipelago{}, err
	}
	roll := w.ArchipelagoRoll + 1
	a, err := Generate(RollSeed(w.Seed, roll), c)
	if err != nil {
		return sim.RerollArchipelago{}, err
	}
	return sim.RerollArchipelago{Roll: roll, Islands: a.Islands, Spawn: a.Ship}, nil
}
