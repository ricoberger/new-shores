package scenario

import (
	"fmt"
	"math"
	"testing"

	"github.com/ricoberger/new-shores/server/internal/content"
	"github.com/ricoberger/new-shores/server/internal/sim"
)

// landTile reports whether an archipelago tile is land on any island.
func landTile(islands []*sim.Island, x, y int) bool {
	for _, is := range islands {
		lx, ly := x-is.X, y-is.Y
		if lx >= 0 && ly >= 0 && lx < is.Width && ly < is.Height && is.Tile(lx, ly).Terrain != content.TerrainWater {
			return true
		}
	}
	return false
}

// seaOnly returns an error for a ship of w whose position the server sends
// lies on land: a sea position (AtSea), the offshore position of an idle
// ship at an island (Offshore) or a point of a leg's path, sampled
// every 1/8 tile along the ship's centre line (tile centres).
func seaOnly(w *sim.World, seen map[string]bool) error {
	for _, s := range w.Ships {
		if p := s.AtSea; p != nil && landTile(w.Islands, p.X, p.Y) {
			return fmt.Errorf("ship %d at sea on land at %v", s.ID, *p)
		}
		if p := s.Offshore; p != nil && landTile(w.Islands, p.X, p.Y) {
			return fmt.Errorf("ship %d idle at island %s on land at %v", s.ID, s.IslandID, *p)
		}
		if s.Leg == nil || len(s.Leg.Path) == 0 {
			continue
		}
		path := s.Leg.Path
		key := fmt.Sprint(s.ID, path)
		if seen[key] {
			continue
		}
		seen[key] = true
		for i := 1; i < len(path); i++ {
			p, q := path[i-1], path[i]
			n := 8 * max(abs(q.X-p.X), abs(q.Y-p.Y), 1)
			for k := 0; k <= n; k++ {
				fx := float64(p.X) + 0.5 + float64(q.X-p.X)*float64(k)/float64(n)
				fy := float64(p.Y) + 0.5 + float64(q.Y-p.Y)*float64(k)/float64(n)
				if landTile(w.Islands, int(math.Floor(fx)), int(math.Floor(fy))) {
					return fmt.Errorf("ship %d leg %s→%s path %v on land at (%.2f,%.2f)", s.ID, s.Leg.FromIsland, s.Leg.ToIsland, path, fx, fy)
				}
			}
		}
	}
	return nil
}

func abs(v int) int {
	if v < 0 {
		return -v
	}
	return v
}

// TestSeaOnly (D-058 round 4): over the reference games, every ship
// position the server sends — sea positions and every leg's routed path —
// stays off land tiles.
func TestSeaOnly(t *testing.T) {
	for _, name := range []string{"bootstrap_citizens", "bootstrap_citizens_quests", "bootstrap_merchants", "bootstrap_patricians"} {
		t.Run(name, func(t *testing.T) {
			if name == "bootstrap_patricians" && testing.Short() {
				t.Skip("long reference game")
			}
			t.Parallel()
			s := loadScenario(t, name)
			c, err := s.LoadContent(repoRoot(t))
			if err != nil {
				t.Fatal(err)
			}
			l := sim.NewLedger()
			w, err := BuildWorld(s, c, l)
			if err != nil {
				t.Fatal(err)
			}
			r := &runner{s: s, c: c, w: w, l: l, report: &Report{Name: s.Name}}
			r.initSnapshots()
			seen := map[string]bool{}
			legs := 0
			for i, st := range s.Steps {
				if st.ExpectError != "" {
					err = r.expectError(i, st)
				} else {
					err = r.step(i, st)
				}
				if err != nil {
					t.Fatalf("step %d: %v", i, err)
				}
				n := len(seen)
				if err := seaOnly(r.w, seen); err != nil {
					t.Fatalf("after step %d: %v", i, err)
				}
				legs += len(seen) - n
			}
			// Every leg between the islands with a Trading Post at the end.
			var ports []*sim.Island
			for _, is := range r.w.Islands {
				for _, b := range is.Buildings {
					if b.Berths > 0 {
						ports = append(ports, is)
						break
					}
				}
			}
			probe := &sim.World{Islands: r.w.Islands}
			for _, from := range ports {
				for _, to := range ports {
					if from == to {
						continue
					}
					a, b := sim.Ends(c, from, to)
					path, _ := sim.Voyage(r.w, c, 1000, a, b)
					probe.Ships = []*sim.Ship{{ID: 0, Leg: &sim.Leg{FromIsland: from.ID, ToIsland: to.ID, Path: path}}}
					if err := seaOnly(probe, seen); err != nil {
						t.Error(err)
					}
				}
			}
			// A ship left idle at each port whose Trading Post is demolished
			// (the island stripped to it first): its harbour point is sea.
			moored := 0
			for _, is := range ports {
				var tp *sim.Building
				for _, b := range is.Buildings {
					if def := c.BuildingByID[b.Type]; def != nil && def.TradingPost != nil {
						tp = b
						break
					}
				}
				if tp == nil {
					continue
				}
				is.Buildings = []*sim.Building{tp}
				ship := &sim.Ship{ID: int64(9000 + moored), Type: "sloop", State: sim.ShipIdle, IslandID: is.ID}
				r.w.Ships = append(r.w.Ships, ship)
				if err := sim.Apply(r.w, c, sim.Demolish{IslandID: is.ID, BuildingID: tp.ID, AcceptSurplusLoss: true}); err != nil {
					t.Fatalf("demolish the Trading Post of %s: %v", is.ID, err)
				}
				if ship.Offshore == nil {
					t.Fatalf("idle ship at %s has no sea position after the demolition", is.ID)
				}
				if err := seaOnly(r.w, seen); err != nil {
					t.Error(err)
				}
				moored++
			}
			t.Logf("%d steps, %d legs checked, %d ports, %d demolished", len(s.Steps), legs, len(ports), moored)
		})
	}
}
