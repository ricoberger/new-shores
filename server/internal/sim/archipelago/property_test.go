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
// spacing, the home candidate, the founding sites and the spawn; and the
// D-058 shapes (checkShape).
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
		if !sc.Rock {
			checkShape(t, c, seed, is, sc)
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

// checkShape restates the D-058 shape rules of a habitable island: a
// plain of the class's side on one level; river and islet counts in
// range; islets of 1-15 tiles at least two water tiles off the land; levels within range
// and 0 on beaches; cliffs on the coast ring (next to the sea); deposits
// on mountain tiles at the foot (next to buildable land); two disjoint
// Trading Post sites and a shipyard site that reach the plain by land or
// bridges; large and medium islands keep a bay and a peninsula.
func checkShape(t *testing.T, c *content.Catalogue, seed uint64, is *sim.Island, sc *content.SizeClass) {
	t.Helper()
	fail := func(format string, args ...any) {
		t.Helper()
		t.Errorf("seed %d %s: %s", seed, is.ID, fmt.Sprintf(format, args...))
	}
	sh := sc.Shape
	if p := largestSquare(is); p < sh.Plain {
		fail("largest plain %d, want %d", p, sh.Plain)
	}
	if sc.Size >= ridgeLargeSize {
		land := make([]bool, len(is.Tiles))
		for i, tl := range is.Tiles {
			land[i] = tl.Terrain != content.TerrainWater && tl.Terrain != content.TerrainIslet
		}
		span, bay, pen := outlineOf(land, is.Width, is.Height)
		if bay*100 < span*bayMinPct || pen*100 < span*peninsulaMinPct {
			fail("bay %d%%, peninsula %d%% of the span, want %d%% and %d%%", bay*100/span, pen*100/span, bayMinPct, peninsulaMinPct)
		}
	}
	if n := components(is, content.TerrainRiver); !sh.Rivers.Contains(n) {
		fail("%d rivers, want %v", n, sh.Rivers)
	}
	islets := islandComponents(is, content.TerrainIslet)
	if !sh.Islets.Contains(len(islets)) {
		fail("%d islets, want %v", len(islets), sh.Islets)
	}
	for _, isl := range islets {
		if len(isl) < 1 || len(isl) > 15 {
			fail("islet of %d tiles", len(isl))
		}
		for _, i := range isl {
			x, y := i%is.Width, i/is.Width
			for dy := -2; dy <= 2; dy++ {
				for dx := -2; dx <= 2; dx++ {
					if is.InBounds(x+dx, y+dy) {
						if tr := is.Tile(x+dx, y+dy).Terrain; tr != content.TerrainWater && tr != content.TerrainIslet {
							fail("islet at (%d,%d) within two tiles of land", x, y)
						}
					}
				}
			}
		}
	}
	for i, tile := range is.Tiles {
		x, y := i%is.Width, i/is.Width
		if tile.Level > sh.Levels || (tile.Terrain == content.TerrainCoast && tile.Level != 0) {
			fail("%s at level %d at (%d,%d)", tile.Terrain, tile.Level, x, y)
		}
		if tile.Terrain == content.TerrainCliff && !nearSea(is, x, y) {
			fail("cliff at (%d,%d) away from the sea", x, y)
		}
		if tile.Deposit != nil {
			foot := false
			for _, d := range dirs4() {
				if is.InBounds(x+d[0], y+d[1]) && buildableTerrain(is.Tile(x+d[0], y+d[1]).Terrain) {
					foot = true
				}
			}
			if tile.Terrain != content.TerrainMountain || !foot {
				fail("deposit at (%d,%d) on %s not at the ridge foot", x, y, tile.Terrain)
			}
		}
	}
	reach, ok := plainReach(is, sh.Plain)
	if !ok {
		fail("no plain")
		return
	}
	var connected []Rect
	for _, r := range Sites(is, c, TradingPost(c)) {
		if reach(r) {
			connected = append(connected, r)
		}
	}
	if !hasDisjoint(connected, 2) {
		fail("fewer than two disjoint Trading Post sites reach the plain")
	}
	yard := firstBuilding(c, func(b *content.Building) bool { return b.Shipyard != nil })
	if yard != nil && !slices.ContainsFunc(Sites(is, c, yard), reach) {
		fail("no shipyard site reaches the plain")
	}
}

// largestSquare returns the side of the largest square of grass/forest
// on one level.
func largestSquare(is *sim.Island) int {
	w := is.Width
	dp := make([]int, len(is.Tiles))
	best := 0
	for i, tile := range is.Tiles {
		if tile.Terrain != content.TerrainGrass && tile.Terrain != content.TerrainForest {
			continue
		}
		dp[i] = 1
		if l := tile.Level; i%w > 0 && i >= w && is.Tiles[i-1].Level == l && is.Tiles[i-w].Level == l && is.Tiles[i-w-1].Level == l {
			dp[i] = 1 + min(dp[i-1], dp[i-w], dp[i-w-1])
		}
		best = max(best, dp[i])
	}
	return best
}

// islandComponents returns the 8-connected components of a terrain.
func islandComponents(is *sim.Island, terrain string) [][]int {
	seen := make([]bool, len(is.Tiles))
	var out [][]int
	for i, tile := range is.Tiles {
		if tile.Terrain != terrain || seen[i] {
			continue
		}
		seen[i] = true
		comp := []int{i}
		for k := 0; k < len(comp); k++ {
			x, y := comp[k]%is.Width, comp[k]/is.Width
			for dy := -1; dy <= 1; dy++ {
				for dx := -1; dx <= 1; dx++ {
					if !is.InBounds(x+dx, y+dy) {
						continue
					}
					j := (y+dy)*is.Width + x + dx
					if !seen[j] && is.Tiles[j].Terrain == terrain {
						seen[j] = true
						comp = append(comp, j)
					}
				}
			}
		}
		out = append(out, comp)
	}
	return out
}

// nearSea reports whether a sea tile lies within one tile (8-neighbours).
func nearSea(is *sim.Island, x, y int) bool {
	for dy := -1; dy <= 1; dy++ {
		for dx := -1; dx <= 1; dx++ {
			if is.InBounds(x+dx, y+dy) && is.Tile(x+dx, y+dy).Terrain == content.TerrainWater {
				return true
			}
		}
	}
	return false
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
