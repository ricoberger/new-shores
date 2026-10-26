package archipelago

import (
	"bytes"
	"fmt"
	"slices"
	"testing"
	"time"

	"github.com/ricoberger/new-shores/server/internal/content"
	"github.com/ricoberger/new-shores/server/internal/sim"
)

// propertySeeds is the number of seeds the property test generates.
const propertySeeds = 200

// TestProperties checks the D-053 rules on the archipelagos of 200 seeds,
// independently of Verify where the rule is cheap to restate: the
// composition (counts per size class, fertility and deposit ranges per
// island and per archipelago), names and IDs, the buildable area, the
// spacing, the home candidate, the founding sites and the spawn.
func TestProperties(t *testing.T) {
	if testing.Short() {
		t.Skip("200 archipelagos")
	}
	c := catalogue(t)
	names := map[string]bool{}
	for _, n := range c.IslandNames {
		names[n] = true
	}
	tp := TradingPost(c)
	for seed := uint64(1); seed <= propertySeeds; seed++ {
		t.Run(fmt.Sprint(seed), func(t *testing.T) {
			t.Parallel()
			checkProperties(t, c, seed, names, tp)
		})
	}
}

func checkProperties(t *testing.T, c *content.Catalogue, seed uint64, names map[string]bool, tp *content.Building) {
	t.Helper()
	rules := &c.Islands
	area := rules.BuildableRange()
	a, err := Generate(seed, c)
	if err != nil {
		t.Fatalf("seed %d: %v", seed, err)
	}
	if err := Verify(a, c); err != nil {
		t.Errorf("seed %d: %v", seed, err)
	}
	if seed%20 == 0 {
		if again, err := Generate(seed, c); err != nil || render(again) != render(a) {
			t.Errorf("seed %d: a second generation differs (%v)", seed, err)
		}
	}
	fail := func(format string, args ...any) {
		t.Helper()
		t.Errorf("seed %d: %s", seed, fmt.Sprintf(format, args...))
	}
	checkTerrainRoundTrip(t, c, a)
	perClass := map[string]int{}
	fertilities := map[string]int{}
	deposits := map[string]int{}
	seen := map[string]bool{}
	buildable := 0
	for i, is := range a.Islands {
		sc := rules.SizeClassByID[is.SizeClass]
		if sc == nil {
			fail("%s has size class %q", is.ID, is.SizeClass)
			continue
		}
		perClass[sc.ID]++
		if is.ID != IslandID(i) {
			fail("island %d has ID %s", i, is.ID)
		}
		if !names[is.Name] || seen[is.Name] {
			fail("%s name %q not from the list or repeated", is.ID, is.Name)
		}
		seen[is.Name] = true
		if !sc.Fertilities.Contains(len(is.Fertilities)) {
			fail("%s has %d fertilities, want %v", is.ID, len(is.Fertilities), sc.Fertilities)
		}
		for _, f := range is.Fertilities {
			fertilities[f]++
		}
		slots := 0
		for kind, n := range DepositCounts(is) {
			deposits[kind] += n
			slots += n
		}
		if !sc.Deposits.Contains(slots) {
			fail("%s has %d deposit slots, want %v", is.ID, slots, sc.Deposits)
		}
		for _, tile := range is.Tiles {
			if tile.Terrain == content.TerrainCoast || tile.Terrain == content.TerrainGrass || tile.Terrain == content.TerrainForest {
				buildable++
			}
		}
		if sc.Rock {
			if len(Sites(is, c, tp)) == 0 {
				fail("rock %s has no Trading Post site", is.ID)
			}
		} else if !hasDisjoint(Sites(is, c, tp), 2) {
			fail("%s has fewer than two disjoint Trading Post sites", is.ID)
		}
		if is.X < 0 || is.Y < 0 {
			fail("%s at (%d,%d)", is.ID, is.X, is.Y)
		}
		nearest := -1
		for _, o := range a.Islands {
			if o == is {
				continue
			}
			g := Gap2(is, o)
			if g < rules.SpacingMin*rules.SpacingMin {
				fail("%s and %s closer than %d", is.ID, o.ID, rules.SpacingMin)
			}
			if nearest < 0 || g < nearest {
				nearest = g
			}
		}
		if nearest > rules.NearestMax*rules.NearestMax {
			fail("%s has no island within %d", is.ID, rules.NearestMax)
		}
	}
	for _, sc := range rules.SizeClasses {
		if !sc.Count.Contains(perClass[sc.ID]) {
			fail("%d %s islands, want %v", perClass[sc.ID], sc.ID, sc.Count)
		}
	}
	checkPool(t, seed, "fertility", rules.Fertilities, fertilities)
	checkPool(t, seed, "deposit", rules.Deposits, deposits)
	if !area.Contains(buildable) {
		fail("buildable area %d outside %v", buildable, area)
	}
	if a.Home != a.Islands[0].ID || !IsHomeCandidate(a.Islands[0], rules) {
		fail("home %s is not the first island or no candidate", a.Home)
	}
	x0, y0, x1, y1 := Bounds(a.Islands)
	if x0 != 0 || y0 != 0 {
		fail("bounds start at (%d,%d)", x0, y0)
	}
	if a.Ship.X < x0 || a.Ship.X >= x1 || a.Ship.Y < y0 || a.Ship.Y >= y1 {
		fail("ship at (%d,%d) outside the bounds", a.Ship.X, a.Ship.Y)
	}
	if !AtSea(a.Islands, a.Ship) || landWithin(a.Islands, a.Ship, ShipClearance) {
		fail("ship at (%d,%d) within %d tiles of land", a.Ship.X, a.Ship.Y, ShipClearance)
	}
}

func checkPool(t *testing.T, seed uint64, what string, pool []content.PoolEntry, got map[string]int) {
	t.Helper()
	for _, e := range pool {
		if !e.Count.Contains(got[e.ID]) {
			t.Errorf("seed %d: %s %s %d times, want %v", seed, what, e.ID, got[e.ID], e.Count)
		}
	}
	for id := range got {
		if !slices.ContainsFunc(pool, func(e content.PoolEntry) bool { return e.ID == id }) {
			t.Errorf("seed %d: %s %s is not in the pool", seed, what, id)
		}
	}
}

// hasDisjoint reports whether n of the sites are pairwise disjoint
// (greedy, enough for n = 2).
func hasDisjoint(sites []Rect, n int) bool {
	for i, a := range sites {
		count := 1
		for _, b := range sites[i+1:] {
			if !a.overlaps(b) {
				count++
			}
		}
		if count >= n {
			return true
		}
	}
	return false
}

// landWithin reports whether a land tile lies within Euclidean distance d
// of p (archipelago tiles).
func landWithin(islands []*sim.Island, p sim.Pos, d int) bool {
	for _, is := range islands {
		for y := range is.Height {
			for x := range is.Width {
				if is.Tile(x, y).Terrain == content.TerrainWater {
					continue
				}
				dx, dy := is.X+x-p.X, is.Y+y-p.Y
				if dx*dx+dy*dy < d*d {
					return true
				}
			}
		}
	}
	return false
}

// checkTerrainRoundTrip: the world of the archipelago stored as state and
// terrain (sim.EncodeState, D-054) decodes to the same world.
func checkTerrainRoundTrip(t *testing.T, c *content.Catalogue, a *Archipelago) {
	t.Helper()
	w := sim.NewWorld(time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC))
	w.Seed, w.Islands = a.Seed, a.Islands
	state, terrain, err := sim.EncodeState(w, c.Region.Version)
	if err != nil {
		t.Fatalf("seed %d: encode state: %v", a.Seed, err)
	}
	if bytes.Contains(state, []byte(`"tiles"`)) {
		t.Errorf("seed %d: the state carries tiles", a.Seed)
	}
	got, _, _, err := sim.DecodeState(state, terrain, c)
	if err != nil {
		t.Fatalf("seed %d: decode state: %v", a.Seed, err)
	}
	want, _ := sim.Encode(w, c.Region.Version)
	if again, _ := sim.Encode(got, c.Region.Version); !bytes.Equal(again, want) {
		t.Errorf("seed %d: the terrain does not round-trip", a.Seed)
	}
}
