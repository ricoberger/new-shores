package archipelago

import (
	"errors"
	"math"
	"testing"
	"time"

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

// pathLand returns the first point of a polyline (sampled every 1/8 tile,
// the ship's centre line) on a land tile, ok false when there is none.
func pathLand(islands []*sim.Island, path []sim.Pos) (x, y float64, ok bool) {
	for i := 1; i < len(path); i++ {
		p, q := path[i-1], path[i]
		n := 8 * max(abs(q.X-p.X), abs(q.Y-p.Y), 1)
		for s := 0; s <= n; s++ {
			// Tile (tx, ty) covers [tx, tx+1); a waypoint is the tile's centre.
			fx := float64(p.X) + 0.5 + float64(q.X-p.X)*float64(s)/float64(n)
			fy := float64(p.Y) + 0.5 + float64(q.Y-p.Y)*float64(s)/float64(n)
			if landTile(islands, int(math.Floor(fx)), int(math.Floor(fy))) {
				return fx, fy, true
			}
		}
	}
	return 0, 0, false
}

// TestFoundingVoyage (D-058 round 4): a sail_ship bound to found a Trading
// Post is routed around land and ends at the site's harbour point: for
// every rotation and several sites per island, the leg's last position is
// open water outside the footprint and no point of the path lies on land;
// the ship then founds the Trading Post there.
func TestFoundingVoyage(t *testing.T) {
	c := catalogue(t)
	var tp *content.Building
	for _, b := range c.Buildings {
		if b.TradingPost != nil {
			tp = b
			break
		}
	}
	base := newWorld(t, 1053001)
	checked := 0
	for _, rotation := range []int{0, 90, 180, 270} {
		w, h := tp.Width, tp.Height
		if rotation == 90 || rotation == 270 {
			w, h = h, w
		}
		perRotation := 0
		probe := base.Clone()
		for _, is := range base.Islands[:6] {
			found := 0
			// Sites spread over the island: one per band of rows.
			for y := 0; y < is.Height && found < 4; y++ {
				for x := 0; x < is.Width; x++ {
					cmd := sim.SailShip{ShipID: 1, ToIslandID: is.ID, Site: &sim.FoundingSite{BuildingType: tp.ID, X: x, Y: y, Rotation: rotation}}
					if sim.Apply(probe, c, cmd) != nil {
						continue // rejected before any change: the probe stays as it was
					}
					world := probe
					probe = base.Clone()
					found++
					s := world.Ship(1)
					path := s.Leg.Path
					end := path[len(path)-1]
					if landTile(world.Islands, end.X, end.Y) {
						t.Errorf("%s site (%d,%d) r%d: leg ends on land at %v", is.ID, x, y, rotation, end)
					}
					if lx, ly := end.X-is.X, end.Y-is.Y; lx >= x && ly >= y && lx < x+w && ly < y+h {
						t.Errorf("%s site (%d,%d) r%d: leg ends inside the footprint at %v", is.ID, x, y, rotation, end)
					}
					if end != sim.HarbourAt(is, tp, x, y, rotation) {
						t.Errorf("%s site (%d,%d) r%d: leg ends at %v, not the harbour %v", is.ID, x, y, rotation, end, sim.HarbourAt(is, tp, x, y, rotation))
					}
					if fx, fy, bad := pathLand(world.Islands, path); bad {
						t.Errorf("%s site (%d,%d) r%d: path %v crosses land at (%.2f,%.2f)", is.ID, x, y, rotation, path, fx, fy)
					}
					// On arrival the ship founds the Trading Post at the site.
					if _, err := sim.Advance(world, c, time.UnixMilli(s.Leg.ArriveAtMs)); err != nil {
						t.Fatal(err)
					}
					if err := sim.Apply(world, c, sim.FoundIsland{ShipID: 1, IslandID: is.ID, BuildingType: tp.ID, X: x, Y: y, Rotation: rotation}); err != nil {
						t.Errorf("%s site (%d,%d) r%d: found: %v", is.ID, x, y, rotation, err)
					}
					checked++
					perRotation++
					y += is.Height / 5
					break
				}
			}
		}
		if perRotation == 0 {
			t.Errorf("rotation %d: no site", rotation)
		}
	}
	t.Logf("%d founding voyages", checked)
}

// TestSailShipSite: a sail_ship's site is validated like found_island's.
func TestSailShipSite(t *testing.T) {
	c := catalogue(t)
	w := newWorld(t, 1053001)
	is := w.Islands[0]
	if err := sim.Apply(w, c, sim.SailShip{ShipID: 1, ToIslandID: is.ID, Site: &sim.FoundingSite{BuildingType: "trading_post", X: 0, Y: 0, Rotation: 45}}); err == nil {
		t.Fatal("rotation 45 accepted")
	}
	if err := sim.Apply(w, c, sim.SailShip{ShipID: 1, ToIslandID: is.ID, Site: &sim.FoundingSite{BuildingType: "nope", X: 0, Y: 0}}); err == nil {
		t.Fatal("unknown building accepted")
	}
	// The grid's corner is open water: no Trading Post there.
	if err := sim.Apply(w, c, sim.SailShip{ShipID: 1, ToIslandID: is.ID, Site: &sim.FoundingSite{BuildingType: "trading_post", X: 0, Y: 0}}); err == nil {
		t.Fatal("site at sea accepted")
	}
}

// TestLagoonHarbourLegs (polish 8): seed 1053001, roll 2 (the owner's
// second playtest) — oc-03's Trading Post site (77, 41) at 180° had its
// harbour in a cliff bay whose mouth lies more than approachReach tiles
// out; the founding voyage from the start position and a manual shipment
// from the founded island to every other island sailed the straight line
// across oc-01 / oc-03. The bay is a cliff coast, which D-075 §1 now
// rejects (needs_low_shore); the legs of every other oc-03 site go by
// water.
func TestLagoonHarbourLegs(t *testing.T) {
	c := catalogue(t)
	w := newWorld(t, 1053001)
	for range 2 {
		cmd, err := Reroll(w, c)
		if err != nil {
			t.Fatal(err)
		}
		if err := sim.Apply(w, c, cmd); err != nil {
			t.Fatal(err)
		}
	}
	owner := sim.FoundingSite{BuildingType: "trading_post", X: 77, Y: 41, Rotation: 180}
	if err := sim.Apply(w, c, sim.SailShip{ShipID: 1, ToIslandID: "oc-03", Site: &owner}); !errors.Is(err, sim.ErrNeedsLowShore) {
		t.Fatalf("the owner's cliff-bay site: %v, want %v", err, sim.ErrNeedsLowShore)
	}
	var isle *sim.Island
	for _, is := range w.Islands {
		if is.ID == "oc-03" {
			isle = is
		}
	}
	sites := Sites(isle, c, TradingPost(c))
	if len(sites) == 0 {
		t.Fatal("oc-03 has no Trading Post site")
	}
	for i := 0; i < len(sites); i += max(1, len(sites)/24) {
		r := sites[i]
		site := sim.FoundingSite{BuildingType: "trading_post", X: r.X, Y: r.Y, Rotation: r.Rotation}
		w := w.Clone()
		if err := sim.Apply(w, c, sim.SailShip{ShipID: 1, ToIslandID: "oc-03", Site: &site}); err != nil {
			t.Fatalf("site %+v: %v", r, err)
		}
		s := w.Ship(1)
		if fx, fy, bad := pathLand(w.Islands, s.Leg.Path); bad {
			t.Errorf("founding voyage to %+v: %v crosses land at (%.2f,%.2f)", r, s.Leg.Path, fx, fy)
		}
		if i > 0 {
			continue
		}
		// From the first site: a shipment to every other island.
		if _, err := sim.Advance(w, c, time.UnixMilli(s.Leg.ArriveAtMs)); err != nil {
			t.Fatal(err)
		}
		if err := sim.Apply(w, c, sim.FoundIsland{ShipID: 1, IslandID: "oc-03", BuildingType: site.BuildingType, X: site.X, Y: site.Y, Rotation: site.Rotation}); err != nil {
			t.Fatal(err)
		}
		for _, to := range w.Islands[:12] {
			if to.ID == "oc-03" {
				continue
			}
			w := w.Clone()
			if err := sim.Apply(w, c, sim.ManualShipment{ShipID: 1, ToIslandID: to.ID, Cargo: []sim.CargoAmount{{Good: "planks", Amount: 1000}}}); err != nil {
				t.Fatalf("shipment to %s: %v", to.ID, err)
			}
			path := w.Ship(1).Leg.Path
			if fx, fy, bad := pathLand(w.Islands, path); bad {
				t.Errorf("shipment to %s: %v crosses land at (%.2f,%.2f)", to.ID, path, fx, fy)
			}
		}
	}
}
