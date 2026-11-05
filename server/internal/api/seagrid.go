package api

import (
	"sync"

	"github.com/ricoberger/new-shores/server/internal/sim"
)

// seaGridCap bounds the cached grids (one per archipelago in play).
const seaGridCap = 16

// seaGridCache holds the sea-route grid that every GET /world used to
// rebuild (D-058 §5). The key (sim.SeaGridKey) is the archipelago and the
// roads on water, so a quay built or demolished makes a new entry; the
// grid itself is read-only and shared. It lives here, not in internal/sim,
// which keeps no state between calls.
type seaGridCache struct {
	mu     sync.Mutex
	grids  map[string]*sim.SeaGrid
	order  []string
	builds int // grids built, for tests
}

// get returns the world's grid, built on first use; nil when the world
// is not cacheable (no seed).
func (c *seaGridCache) get(w *sim.World, generatorVersion int) *sim.SeaGrid {
	key := sim.SeaGridKey(w, generatorVersion)
	if key == "" {
		return nil
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if g, ok := c.grids[key]; ok {
		return g
	}
	g := sim.BuildSeaGrid(w.Islands)
	if c.grids == nil {
		c.grids = map[string]*sim.SeaGrid{}
	}
	c.grids[key] = g
	c.order = append(c.order, key)
	if len(c.order) > seaGridCap {
		delete(c.grids, c.order[0])
		c.order = c.order[1:]
	}
	c.builds++
	return g
}
