package archipelago

import (
	"errors"
	"fmt"
	"slices"

	"github.com/ricoberger/new-shores/server/internal/content"
	"github.com/ricoberger/new-shores/server/internal/sim"
)

// Rect is a building footprint on an island: [X, X+W) x [Y, Y+H).
type Rect struct{ X, Y, W, H, Rotation int }

func (a Rect) overlaps(b Rect) bool {
	return a.X < b.X+b.W && b.X < a.X+a.W && a.Y < b.Y+b.H && b.Y < a.Y+a.H
}

func rotations() [4]int { return [4]int{0, 90, 180, 270} }

func footprint(def *content.Building, rotation int) (int, int) {
	if rotation == 90 || rotation == 270 {
		return def.Height, def.Width
	}
	return def.Width, def.Height
}

// Sites returns every valid site of a building on an empty island, by the
// real placement check (sim.CheckSite), in row-major order per rotation.
// For water-edge buildings only anchors whose first water tile is water
// and first land tile is buildable are checked in full.
func Sites(is *sim.Island, c *content.Catalogue, def *content.Building) []Rect {
	var out []Rect
	for _, rot := range rotations() {
		w, h := footprint(def, rot)
		for y := 0; y+h <= is.Height; y++ {
			for x := 0; x+w <= is.Width; x++ {
				if def.WaterTiles > 0 && !waterEdgeHint(is, def, x, y, w, h, rot) {
					continue
				}
				if sim.CheckSite(is, c, def, x, y, rot) == nil {
					out = append(out, Rect{x, y, w, h, rot})
				}
			}
		}
	}
	return out
}

// waterEdgeHint is a cheap necessary condition of a water-edge site: the
// corner tile in the water rows is water and the opposite corner (in the
// land rows) is not.
func waterEdgeHint(is *sim.Island, def *content.Building, x, y, w, h, rot int) bool {
	wx, wy, lx, ly := x, y, x+w-1, y+h-1
	switch rot {
	case 90:
		wx, lx = x+w-1, x
	case 180:
		wy, ly = y+h-1, y
	}
	if !sim.WaterTile(def, x, y, rot, wx, wy) || sim.WaterTile(def, x, y, rot, lx, ly) {
		return true // unexpected geometry: let CheckSite decide
	}
	return is.Tile(wx, wy).Terrain == content.TerrainWater && is.Tile(lx, ly).Terrain != content.TerrainWater
}

// disjoint reports whether two of the rects do not overlap.
func disjoint(rs []Rect) bool {
	for i := range rs {
		for j := i + 1; j < len(rs); j++ {
			if !rs[i].overlaps(rs[j]) {
				return true
			}
		}
	}
	return false
}

func firstBuilding(c *content.Catalogue, ok func(*content.Building) bool) *content.Building {
	for _, b := range c.Buildings {
		if ok(b) {
			return b
		}
	}
	return nil
}

// TradingPost returns the content's Trading Post building.
func TradingPost(c *content.Catalogue) *content.Building {
	return firstBuilding(c, func(b *content.Building) bool { return b.TradingPost != nil })
}

// Island rule errors.
var (
	ErrTradingPostSites = errors.New("too few trading post sites")
	ErrShipyardSite     = errors.New("no shipyard site")
	ErrMineUnreachable  = errors.New("a deposit building footprint has no road neighbour")
	ErrRockMines        = errors.New("a rock's deposits cannot be mined next to its trading post")
)

// verifyIsland checks the rules of one island on its own grid (D-053
// part 3, MECHANICS §2): a habitable island has two non-overlapping
// Trading Post sites and a shipyard site; a rock has a Trading Post site
// that leaves a mine site on every deposit slot; every footprint of a
// deposit building that covers its deposit touches buildable land (roads
// never go on mountains).
func verifyIsland(is *sim.Island, c *content.Catalogue) error {
	sc := c.Islands.SizeClassByID[is.SizeClass]
	if sc == nil {
		return fmt.Errorf("unknown size class %q", is.SizeClass)
	}
	if tp := TradingPost(c); tp != nil {
		sites := Sites(is, c, tp)
		switch {
		case sc.Rock:
			if !rockMinable(is, c, sites) {
				return ErrRockMines
			}
		case !disjoint(sites):
			return ErrTradingPostSites
		}
	}
	if !sc.Rock {
		if yard := firstBuilding(c, func(b *content.Building) bool { return b.Shipyard != nil }); yard != nil && len(Sites(is, c, yard)) == 0 {
			return ErrShipyardSite
		}
	}
	return minesReachable(is, c)
}

// rockMinable reports whether one Trading Post site leaves, for every
// deposit slot, a valid site of a building requiring its kind that does
// not overlap the Trading Post.
func rockMinable(is *sim.Island, c *content.Catalogue, tps []Rect) bool {
	slots := depositSlots(is)
	for _, tp := range tps {
		ok := true
		for _, s := range slots {
			def := firstBuilding(c, func(b *content.Building) bool { return b.RequiresDeposit == s.kind })
			if def == nil {
				continue
			}
			if !mineSiteNear(is, c, def, s.tiles, tp) {
				ok = false
				break
			}
		}
		if ok {
			return true
		}
	}
	return false
}

func mineSiteNear(is *sim.Island, c *content.Catalogue, def *content.Building, tiles []sim.Pos, avoid Rect) bool {
	for _, rot := range [2]int{0, 90} {
		w, h := footprint(def, rot)
		for _, t := range tiles {
			for y := t.Y - h + 1; y <= t.Y; y++ {
				for x := t.X - w + 1; x <= t.X; x++ {
					r := Rect{x, y, w, h, rot}
					if !r.overlaps(avoid) && sim.CheckSite(is, c, def, x, y, rot) == nil {
						return true
					}
				}
			}
		}
	}
	return false
}

// minesReachable checks MECHANICS §2: every footprint (both orientations)
// of a deposit building that covers a deposit of its kind and stands on
// buildable or mountain terrain has a 4-adjacent buildable tile outside
// it, where a road can connect it.
func minesReachable(is *sim.Island, c *content.Catalogue) error {
	buildableAt := func(x, y int) bool {
		if !is.InBounds(x, y) {
			return false
		}
		t := is.Tile(x, y).Terrain
		return t == content.TerrainCoast || t == content.TerrainGrass || t == content.TerrainForest
	}
	var deps []sim.Pos
	for i, t := range is.Tiles {
		if t.Deposit != nil {
			deps = append(deps, sim.Pos{X: i % is.Width, Y: i / is.Width})
		}
	}
	for _, def := range c.Buildings {
		if def.RequiresDeposit == "" {
			continue
		}
		for _, rot := range [2]int{0, 90} {
			fw, fh := footprint(def, rot)
			for _, d := range deps {
				if is.Tile(d.X, d.Y).Deposit.Kind != def.RequiresDeposit {
					continue
				}
				for y := d.Y - fh + 1; y <= d.Y; y++ {
					for x := d.X - fw + 1; x <= d.X; x++ {
						if x < 0 || y < 0 || x+fw > is.Width || y+fh > is.Height {
							continue
						}
						valid := true
						for ty := y; ty < y+fh && valid; ty++ {
							for tx := x; tx < x+fw; tx++ {
								if t := is.Tile(tx, ty).Terrain; !buildableAt(tx, ty) && t != content.TerrainMountain {
									valid = false
									break
								}
							}
						}
						if !valid {
							continue
						}
						reach := false
						for tx := x; tx < x+fw && !reach; tx++ {
							reach = buildableAt(tx, y-1) || buildableAt(tx, y+fh)
						}
						for ty := y; ty < y+fh && !reach; ty++ {
							reach = buildableAt(x-1, ty) || buildableAt(x+fw, ty)
						}
						if !reach {
							return fmt.Errorf("%w: %s at (%d,%d) %dx%d", ErrMineUnreachable, def.ID, x, y, fw, fh)
						}
					}
				}
			}
		}
	}
	return nil
}

// DepositSlot is a slot found on an island's tiles: a 4-connected group of
// deposit tiles of one kind.
type DepositSlot struct {
	kind  string
	tiles []sim.Pos
}

// Kind returns the deposit kind of the slot.
func (s DepositSlot) Kind() string { return s.kind }

// depositSlots returns the slots of an island in row-major order of their
// first tile.
func depositSlots(is *sim.Island) []DepositSlot {
	seen := make([]bool, len(is.Tiles))
	var out []DepositSlot
	for i, t := range is.Tiles {
		if t.Deposit == nil || seen[i] {
			continue
		}
		s := DepositSlot{kind: t.Deposit.Kind}
		stack := []int{i}
		seen[i] = true
		for len(stack) > 0 {
			j := stack[len(stack)-1]
			stack = stack[:len(stack)-1]
			x, y := j%is.Width, j/is.Width
			s.tiles = append(s.tiles, sim.Pos{X: x, Y: y})
			for _, d := range dirs4() {
				nx, ny := x+d[0], y+d[1]
				if !is.InBounds(nx, ny) {
					continue
				}
				k := ny*is.Width + nx
				if !seen[k] && is.Tiles[k].Deposit != nil && is.Tiles[k].Deposit.Kind == s.kind {
					seen[k] = true
					stack = append(stack, k)
				}
			}
		}
		out = append(out, s)
	}
	return out
}

// DepositCounts returns the number of deposit slots per kind of an island.
func DepositCounts(is *sim.Island) map[string]int {
	out := map[string]int{}
	for _, s := range depositSlots(is) {
		out[s.kind]++
	}
	return out
}

func hasTerrain(is *sim.Island, terrain string) bool {
	return slices.ContainsFunc(is.Tiles, func(t sim.Tile) bool { return t.Terrain == terrain })
}

// IsHomeCandidate reports whether an island satisfies the home rule.
func IsHomeCandidate(is *sim.Island, rules *content.IslandRules) bool {
	h := rules.Home
	if is.SizeClass != h.SizeClass {
		return false
	}
	for _, t := range h.Terrain {
		if !hasTerrain(is, t) {
			return false
		}
	}
	deps := DepositCounts(is)
	for _, d := range h.Deposits {
		if deps[d] == 0 {
			return false
		}
	}
	for _, d := range h.DepositsNone {
		if deps[d] > 0 {
			return false
		}
	}
	for _, f := range h.FertilitiesNone {
		if slices.Contains(is.Fertilities, f) {
			return false
		}
	}
	if len(h.FertilitiesAny) > 0 && !slices.ContainsFunc(h.FertilitiesAny, func(f string) bool { return slices.Contains(is.Fertilities, f) }) {
		return false
	}
	return true
}

// Verify checks a generated archipelago against every rule of D-053 and
// the content: the island count per size class, the per-island and
// per-archipelago fertility and deposit ranges, the buildable area, the
// spacing, the home candidate, the island checks (Trading Post and
// shipyard sites, minable deposits), unique names and the start ship at
// sea.
func Verify(a *Archipelago, c *content.Catalogue) error {
	rules := &c.Islands
	if len(a.Islands) == 0 {
		return errors.New("no island")
	}
	perClass := map[string]int{}
	fert := map[string]int{}
	deps := map[string]int{}
	names := map[string]bool{}
	ids := map[string]bool{}
	for _, is := range a.Islands {
		sc := rules.SizeClassByID[is.SizeClass]
		if sc == nil {
			return fmt.Errorf("%s: unknown size class %q", is.ID, is.SizeClass)
		}
		perClass[sc.ID]++
		if ids[is.ID] {
			return fmt.Errorf("duplicate island ID %q", is.ID)
		}
		ids[is.ID] = true
		if names[is.Name] || content.CheckIslandName(is.Name) != nil {
			return fmt.Errorf("%s: invalid or duplicate name %q", is.ID, is.Name)
		}
		names[is.Name] = true
		if !sc.Fertilities.Contains(len(is.Fertilities)) {
			return fmt.Errorf("%s: %d fertilities outside %+v", is.ID, len(is.Fertilities), sc.Fertilities)
		}
		seen := map[string]bool{}
		for _, f := range is.Fertilities {
			if seen[f] {
				return fmt.Errorf("%s: duplicate fertility %q", is.ID, f)
			}
			seen[f] = true
			fert[f]++
		}
		n := 0
		for k, v := range DepositCounts(is) {
			deps[k] += v
			n += v
		}
		if !sc.Deposits.Contains(n) {
			return fmt.Errorf("%s: %d deposit slots outside %+v", is.ID, n, sc.Deposits)
		}
		if sc.Rock {
			for _, t := range is.Tiles {
				if t.Terrain != content.TerrainWater && t.Terrain != content.TerrainCoast && t.Terrain != content.TerrainMountain {
					return fmt.Errorf("%s: a rock has %s", is.ID, t.Terrain)
				}
			}
		}
		if err := verifyIsland(is, c); err != nil {
			return fmt.Errorf("%s: %w", is.ID, err)
		}
	}
	for _, sc := range rules.SizeClasses {
		if !sc.Count.Contains(perClass[sc.ID]) {
			return fmt.Errorf("%d %s islands outside %+v", perClass[sc.ID], sc.ID, sc.Count)
		}
	}
	for _, e := range rules.Fertilities {
		if !e.Count.Contains(fert[e.ID]) {
			return fmt.Errorf("fertility %s on %d islands, want %+v", e.ID, fert[e.ID], e.Count)
		}
	}
	for _, e := range rules.Deposits {
		if !e.Count.Contains(deps[e.ID]) {
			return fmt.Errorf("deposit %s: %d slots, want %+v", e.ID, deps[e.ID], e.Count)
		}
	}
	if n := buildableArea(a.Islands); !rules.BuildableRange().Contains(n) {
		return fmt.Errorf("buildable area %d outside %+v", n, rules.BuildableRange())
	}
	for i, is := range a.Islands {
		nearest := -1
		for j, o := range a.Islands {
			if i == j {
				continue
			}
			g := Gap2(is, o)
			if g < rules.SpacingMin*rules.SpacingMin {
				return fmt.Errorf("%s and %s closer than %d tiles", is.ID, o.ID, rules.SpacingMin)
			}
			if nearest < 0 || g < nearest {
				nearest = g
			}
		}
		if nearest > rules.NearestMax*rules.NearestMax {
			return fmt.Errorf("%s: nearest island farther than %d tiles", is.ID, rules.NearestMax)
		}
	}
	home := slices.IndexFunc(a.Islands, func(is *sim.Island) bool { return is.ID == a.Home })
	if home < 0 || !IsHomeCandidate(a.Islands[home], rules) {
		return fmt.Errorf("home candidate %q does not satisfy the home rule", a.Home)
	}
	if !AtSea(a.Islands, a.Ship) {
		return fmt.Errorf("start ship at (%d,%d) is not at sea", a.Ship.X, a.Ship.Y)
	}
	return nil
}
