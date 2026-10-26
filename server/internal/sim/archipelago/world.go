package archipelago

import (
	"fmt"
	"time"

	"github.com/ricoberger/new-shores/server/internal/content"
	"github.com/ricoberger/new-shores/server/internal/sim"
)

// NewWorld builds a new world on the archipelago of seed (roll 0)
// evaluated at start (truncated to milliseconds): no island settled, the
// start ship (the content's first ship type) at the archipelago's spawn
// carrying the content starting goods, the starting gold on the balance
// (D-051, D-053).
func NewWorld(c *content.Catalogue, seed uint64, start time.Time) (*sim.World, error) {
	if seed == 0 || seed > MaxSeed {
		return nil, fmt.Errorf("archipelago: seed %d outside 1..%d", seed, MaxSeed)
	}
	a, err := Generate(seed, c)
	if err != nil {
		return nil, err
	}
	w := sim.NewWorld(start)
	w.Seed = seed
	w.Islands = a.Islands
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
