package archipelago_test

import (
	"errors"
	"math/rand/v2"
	"path/filepath"
	"runtime"
	"testing"
	"time"

	"github.com/ricoberger/new-shores/server/internal/content"
	"github.com/ricoberger/new-shores/server/internal/layout"
	"github.com/ricoberger/new-shores/server/internal/sim"
	"github.com/ricoberger/new-shores/server/internal/sim/archipelago"
)

// openToSea reports whether ships reach p (archipelago tiles) from the
// edge of the island's grid over water tiles without a road (an
// independent check of the sim's harbour rule: no shore building stands
// on the island in this test).
func openToSea(is *sim.Island, p sim.Pos) bool {
	x, y := p.X-is.X, p.Y-is.Y
	if x < 0 || y < 0 || x >= is.Width || y >= is.Height {
		return true
	}
	blocked := func(x, y int) bool {
		return is.Tile(x, y).Terrain != content.TerrainWater || is.RoadAt(x, y) != ""
	}
	if blocked(x, y) {
		return false
	}
	seen := map[sim.Pos]bool{{X: x, Y: y}: true}
	queue := []sim.Pos{{X: x, Y: y}}
	for len(queue) > 0 {
		q := queue[0]
		queue = queue[1:]
		for _, d := range []sim.Pos{{X: 1}, {X: -1}, {Y: 1}, {Y: -1}} {
			n := sim.Pos{X: q.X + d.X, Y: q.Y + d.Y}
			if n.X < 0 || n.Y < 0 || n.X >= is.Width || n.Y >= is.Height {
				return true
			}
			if !seen[n] && !blocked(n.X, n.Y) {
				seen[n] = true
				queue = append(queue, n)
			}
		}
	}
	return false
}

// TestQuayGrowthNeverBlocksHarbour (D-077 §8): on the archipelagos of
// seeds 1–50, the home island founded at its best Trading Post site,
// random quay growth (single tiles and short runs on the shallows near
// the harbour point, many of them on the Trading Post's way out) never
// leaves the harbour point (HarbourAt after the change) without a way to
// the open sea, and every
// accepted quay tile is connected to the land. -short checks seeds 1–5.
func TestQuayGrowthNeverBlocksHarbour(t *testing.T) {
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
	accepted, blocked := 0, 0
	for seed := uint64(1); seed <= last; seed++ {
		w, err := archipelago.NewWorld(c, seed, start)
		if err != nil {
			t.Fatal(err)
		}
		is := w.Islands()[0]
		r, ok := (&layout.Planner{C: c, W: w}).TradingPostSite(is.ID)
		if !ok {
			t.Fatalf("seed %d: no Trading Post site", seed)
		}
		if err := sim.PlaceFree(w, c, sim.PlaceBuilding{IslandID: is.ID, Type: tp.ID, X: r.X, Y: r.Y, Rotation: r.Rotation}, nil); err != nil {
			t.Fatalf("seed %d: %v", seed, err)
		}
		w.Gold = 1_000_000_000
		w.UnlockedTiers = append(w.UnlockedTiers, "citizens")
		if err := sim.AddStock(w, c, is.ID, "stone", 290_000, nil); err != nil {
			t.Fatal(err)
		}
		harbour := sim.HarbourAt(c, is, tp, r.X, r.Y, r.Rotation)
		hx, hy := harbour.X-is.X, harbour.Y-is.Y
		rng := rand.New(rand.NewPCG(seed, 77)) // #nosec G404 -- deterministic test data
		for range 400 {
			// A tile within 12 of the harbour point, a run of 1–6 in a
			// random direction.
			x, y := hx+rng.IntN(25)-12, hy+rng.IntN(25)-12
			d := []sim.Pos{{X: 1}, {X: -1}, {Y: 1}, {Y: -1}}[rng.IntN(4)]
			var tiles []sim.Pos
			for k := range 1 + rng.IntN(6) {
				p := sim.Pos{X: x + k*d.X, Y: y + k*d.Y}
				if p.X < 0 || p.Y < 0 || p.X >= is.Width || p.Y >= is.Height || !sim.Shallow(is, p.X, p.Y) || is.RoadAt(p.X, p.Y) != "" {
					break
				}
				tiles = append(tiles, p)
			}
			if len(tiles) == 0 {
				continue
			}
			err := sim.Apply(w, c, sim.PlaceRoad{IslandID: is.ID, Type: "quay", Tiles: tiles})
			switch {
			case err == nil:
				accepted += len(tiles)
			case errors.Is(err, sim.ErrHarbourBlocked):
				blocked++
			}
			// The harbour point follows the coast (HarbourAt: the nearest
			// water a ship reaches) as quays cover it.
			if now := sim.HarbourAt(c, is, tp, r.X, r.Y, r.Rotation); !openToSea(is, now) {
				harbour = now
				t.Fatalf("seed %d: quay %v (err %v) closed the harbour point %v (island at %d,%d, %dx%d)", seed, tiles, err, harbour, is.X, is.Y, is.Width, is.Height)
			}
		}
		// Every quay tile reaches the land over quay tiles.
		if p, ok := floatingQuay(is, is.Occupancy(c)); ok {
			t.Fatalf("seed %d: floating quay at %v", seed, p)
		}
	}
	if accepted == 0 || blocked == 0 {
		t.Fatalf("property not exercised: %d quay tiles accepted, %d placements blocked", accepted, blocked)
	}
	t.Logf("%d quay tiles accepted, %d placements refused as harbour_blocked", accepted, blocked)
}

// floatingQuay returns a road tile of the island (only quays here) that
// does not reach own land or a building (occ) over road tiles.
func floatingQuay(is *sim.Island, occ []int64) (sim.Pos, bool) {
	land := func(x, y int) bool {
		t := is.Tile(x, y).Terrain
		return (t != content.TerrainWater && t != content.TerrainRiver && t != content.TerrainIslet) || occ[y*is.Width+x] != 0
	}
	reached := map[sim.Pos]bool{}
	var queue []sim.Pos
	var all []sim.Pos
	for y := range is.Height {
		for x := range is.Width {
			if is.RoadAt(x, y) == "" {
				continue
			}
			all = append(all, sim.Pos{X: x, Y: y})
			for _, d := range []sim.Pos{{X: 1}, {X: -1}, {Y: 1}, {Y: -1}} {
				nx, ny := x+d.X, y+d.Y
				if nx >= 0 && ny >= 0 && nx < is.Width && ny < is.Height && land(nx, ny) {
					reached[sim.Pos{X: x, Y: y}] = true
					queue = append(queue, sim.Pos{X: x, Y: y})
					break
				}
			}
		}
	}
	for len(queue) > 0 {
		q := queue[0]
		queue = queue[1:]
		for _, d := range []sim.Pos{{X: 1}, {X: -1}, {Y: 1}, {Y: -1}} {
			n := sim.Pos{X: q.X + d.X, Y: q.Y + d.Y}
			if n.X >= 0 && n.Y >= 0 && n.X < is.Width && n.Y < is.Height && !reached[n] && is.RoadAt(n.X, n.Y) != "" {
				reached[n] = true
				queue = append(queue, n)
			}
		}
	}
	for _, p := range all {
		if !reached[p] {
			return p, true
		}
	}
	return sim.Pos{}, false
}
