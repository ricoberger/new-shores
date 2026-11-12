package archipelago_test

import (
	"path/filepath"
	"runtime"
	"testing"
	"time"

	"github.com/ricoberger/new-shores/server/internal/content"
	"github.com/ricoberger/new-shores/server/internal/layout"
	"github.com/ricoberger/new-shores/server/internal/sim"
	"github.com/ricoberger/new-shores/server/internal/sim/archipelago"
)

// lineTiles calls f for every tile the segment between the centres of
// tiles p and q passes through (tile-exact: a crossing exactly through a
// tile corner touches both tiles beside it as well, a hull never squeezes
// between two diagonal land tiles).
func lineTiles(p, q sim.Pos, f func(x, y int)) {
	// Doubled coordinates: tile (x, y) is [2x, 2x+2) × [2y, 2y+2), its centre (2x+1, 2y+1).
	x, y := p.X, p.Y
	dx, dy := q.X-p.X, q.Y-p.Y
	sx, sy := 1, 1
	if dx < 0 {
		sx, dx = -1, -dx
	}
	if dy < 0 {
		sy, dy = -1, -dy
	}
	f(x, y)
	// err compares the next vertical and horizontal boundary crossings:
	// t_x = (2i+1)/(2dx), t_y = (2j+1)/(2dy) → compare (2i+1)·dy with (2j+1)·dx.
	i, j := 0, 0
	for i < dx || j < dy {
		a := (2*i + 1) * dy // ∝ t of the next x boundary
		b := (2*j + 1) * dx // ∝ t of the next y boundary
		switch {
		case j >= dy || (i < dx && a < b):
			x += sx
			i++
		case i >= dx || b < a:
			y += sy
			j++
		default: // through a corner
			f(x+sx, y)
			f(x, y+sy)
			x += sx
			y += sy
			i++
			j++
		}
		f(x, y)
	}
}

func landAt(islands []*sim.Island, x, y int) bool {
	for _, is := range islands {
		lx, ly := x-is.X, y-is.Y
		if lx >= 0 && ly >= 0 && lx < is.Width && ly < is.Height && is.Tile(lx, ly).Terrain != content.TerrainWater {
			return true
		}
	}
	return false
}

// crossing returns the first land tile on the polyline, ok false when it
// touches none.
func crossing(islands []*sim.Island, path []sim.Pos) (sim.Pos, bool) {
	var hit sim.Pos
	found := false
	for k := 1; k < len(path) && !found; k++ {
		lineTiles(path[k-1], path[k], func(x, y int) {
			if !found && landAt(islands, x, y) {
				hit, found = sim.Pos{X: x, Y: y}, true
			}
		})
	}
	return hit, found
}

// TestSeaRouteNeverCrossesLand (polish 8, D-058 §5): on the archipelagos
// of seeds 1–50, every leg between two islands (Ends, as a route or a
// manual shipment sails it) and the founding voyage from the start
// position to every island's best Trading Post site (layout) follow
// polylines whose segments touch no land tile. -short checks seeds 1–5.
func TestSeaRouteNeverCrossesLand(t *testing.T) {
	_, file, _, _ := runtime.Caller(0)
	c, err := content.Load(filepath.Join(filepath.Dir(file), "..", "..", "..", "..", "content", "old_coast"))
	if err != nil {
		t.Fatal(err)
	}
	tp := archipelago.TradingPost(c)
	last := uint64(50)
	if testing.Short() {
		last = 5
	}
	start := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	legs := 0
	for seed := uint64(1); seed <= last; seed++ {
		w, err := archipelago.NewWorld(c, seed, start)
		if err != nil {
			t.Fatal(err)
		}
		w.SetSeaGrid(sim.BuildSeaGrid(w.Islands()))
		var ports []*sim.Island
		for _, is := range w.Islands() {
			if sc := c.Islands.SizeClassByID[is.SizeClass]; sc == nil || !sc.Scenic {
				ports = append(ports, is)
			}
		}
		check := func(what string, a, b sim.Pos) {
			legs++
			path, _ := sim.Voyage(w, c, 1000, a, b)
			if p, bad := crossing(w.Islands(), path); bad {
				t.Errorf("seed %d %s: path %v crosses land at %v", seed, what, path, p)
			}
		}
		for i, from := range ports {
			for _, to := range ports[i+1:] {
				a, b := sim.Ends(c, from, to)
				check(from.ID+" → "+to.ID, a, b)
			}
		}
		spawn := *w.Ship(1).AtSea
		lp := &layout.Planner{C: c, W: w}
		for _, is := range ports {
			r, ok := lp.TradingPostSite(is.ID)
			if !ok {
				continue
			}
			check("founding "+is.ID, spawn, sim.HarbourAt(is, tp, r.X, r.Y, r.Rotation))
		}
	}
	t.Logf("%d legs", legs)
}
