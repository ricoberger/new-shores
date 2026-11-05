// Package archipelago generates the archipelago of a world from a seed
// (D-053, MECHANICS §10): a pure, deterministic function of the seed and
// the content's generator rules (islands.json, island_names.json). Like
// package sim it performs no I/O, reads no clock and draws randomness only
// from its own seeded splitmix64 generator; all arithmetic is integer, so
// the same seed gives byte-identical islands on every platform.
//
// GeneratorVersion rule: bump it by hand in the same change whenever the
// generated rows (tiles, terrain, levels, heights) of an existing seed
// change, e.g. by a new shape algorithm (D-058) or generator rules in
// islands.json. It is part of the tiles ETag and `?v=` cache key, so
// browsers drop rows cached from the old generator. The content and
// schema versions do not cover this; the generator can change without them.
package archipelago

import (
	"errors"
	"fmt"
	"slices"

	"github.com/ricoberger/new-shores/server/internal/content"
	"github.com/ricoberger/new-shores/server/internal/sim"
)

// Archipelago is a generated archipelago.
type Archipelago struct {
	// Seed is the seed it was generated from.
	Seed uint64
	// Islands with ID, name, size class, position, tiles (deposit slots on
	// the mountain edges) and fertilities; the home candidate first, then
	// the size classes in content order.
	Islands []*sim.Island
	// Home is the ID of the guaranteed home candidate.
	Home string
	// Ship is the spawn position of the start ship: the sea tile nearest
	// the home candidate that is ShipClearance tiles from land.
	Ship sim.Pos
}

// GeneratorVersion identifies the island generator's output; see the rule
// in the package comment. 2: round islands replaced by D-058 outlines; 3: D-072 Anno 117 sizes;
// 4: D-072 rim massifs; 5: D-072 rivers two tiles wide; 6: D-072 part 2
// deposit slots with reserved footprints, 16 tiles apart.
const GeneratorVersion = 6

// MaxSeed bounds world seeds to 53 bits, so that they survive a JSON
// number in the client (D-053 display) unchanged.
const MaxSeed uint64 = 1<<53 - 1

// ShipClearance is the minimum Euclidean distance in tiles from the start
// ship's spawn to the nearest land tile: its first voyage takes 40 s or
// more (one tile per second, D-058 round 4).
const ShipClearance = 40

// Attempt bounds: the archipelago retries with derived sub-seeds, each
// island shape with its own. A seed that exhausts them is a content error
// (the property tests run 200 seeds); Generate then fails.
const (
	maxAttempts      = 64
	maxShapeAttempts = 64
)

// IslandID returns the ID of the i-th island (0-based) of a generated
// archipelago.
func IslandID(i int) string { return fmt.Sprintf("isle-%02d", i+1) }

// RollSeed returns the seed of re-roll number roll of a world seed
// (reroll_archipelago, D-053 part 2): the world seed itself for roll 0,
// else a non-zero 53-bit seed derived from both.
func RollSeed(seed uint64, roll int) uint64 {
	if roll <= 0 {
		return seed
	}
	return max(derive(seed, 0x5e11_0000+uint64(roll))&MaxSeed, 1) // #nosec G115 -- roll > 0
}

// Generate builds the archipelago of seed. It tries derived sub-seeds
// until one satisfies every rule (Verify) and fails only when none of
// maxAttempts does, which the content tests rule out for the shipped
// content.
func Generate(seed uint64, c *content.Catalogue) (*Archipelago, error) {
	var last error
	for attempt := range maxAttempts {
		a, err := try(seed, derive(seed, uint64(attempt)), c) // #nosec G115 -- attempt >= 0
		if err == nil {
			return a, nil
		}
		last = err
	}
	return nil, fmt.Errorf("archipelago: seed %d: no valid archipelago in %d attempts: %w", seed, maxAttempts, last)
}

func try(seed, sub uint64, c *content.Catalogue) (*Archipelago, error) {
	rules := &c.Islands
	// Later mining tiers' deposits: tier 3 on stream 4 (C3), tier 4 on 5.
	late := func(k int) *rng { return newRNG(derive(sub, 3+uint64(k))) } // #nosec G115 -- k >= 1
	// The rim massifs on stream 65 (D-072; any free stream would do, this
	// one keeps the dev seed's deposit composition as it was before them).
	plans, err := planComposition(newRNG(derive(sub, 1)), newRNG(derive(sub, 65)), late, c)
	if err != nil {
		return nil, err
	}
	// The home candidate first.
	home := slices.IndexFunc(plans, func(p *plan) bool { return p.home })
	plans = append(append([]*plan{plans[home]}, plans[:home]...), plans[home+1:]...)

	a := &Archipelago{Seed: seed, Home: IslandID(0), Islands: make([]*sim.Island, len(plans))}
	// The resource rocks first: their slots fail most often (D-072: the
	// small islands without a massif carry none), and a failed rock
	// should not cost the large islands' shapes. Every island keeps its
	// own stream, so the order changes no result.
	order := make([]int, 0, len(plans))
	for _, rock := range []bool{true, false} {
		for i, p := range plans {
			if p.class.Rock == rock {
				order = append(order, i)
			}
		}
	}
	for _, i := range order {
		is, err := buildIsland(derive(sub, 100+uint64(i)), plans[i], c) // #nosec G115 -- i >= 0
		if err != nil {
			return nil, err
		}
		is.ID = IslandID(i)
		a.Islands[i] = is
	}
	if n := buildableArea(a.Islands); !rules.BuildableRange().Contains(n) {
		return nil, fmt.Errorf("buildable area %d outside %+v", n, rules.BuildableRange())
	}
	if err := layout(newRNG(derive(sub, 2)), a.Islands, rules); err != nil {
		return nil, err
	}
	names := slices.Clone(c.IslandNames)
	r := newRNG(derive(sub, 3))
	r.shuffle(len(names), func(i, j int) { names[i], names[j] = names[j], names[i] })
	if len(names) < len(a.Islands) {
		return nil, errors.New("too few island names")
	}
	for i, is := range a.Islands {
		is.Name = names[i]
	}
	if a.Islands, err = skerries(newRNG(derive(sub, 50)), a.Islands, rules); err != nil {
		return nil, err
	}
	ship, ok := spawn(a.Islands)
	if !ok {
		return nil, errors.New("no sea tile for the start ship")
	}
	a.Ship = ship
	if err := Verify(a, c); err != nil {
		return nil, err
	}
	return a, nil
}

// buildIsland draws shapes for one island until one passes the island
// checks.
func buildIsland(seed uint64, p *plan, c *content.Catalogue) (*sim.Island, error) {
	s := &scratch{}
	sr := newSlotRules(c)
	for attempt := range maxShapeAttempts {
		r := newRNG(derive(seed, uint64(attempt))) // #nosec G115 -- attempt >= 0
		g := shape(r, p.class, p.massifs, p.deposits, sr, s)
		if g == nil {
			continue
		}
		is := g.island(p)
		if err := verifyIsland(is, c); err != nil {
			continue
		}
		return is, nil
	}
	return nil, fmt.Errorf("no valid %s island in %d attempts", p.class.ID, maxShapeAttempts)
}

// island converts the working grid to a sim island at (0, 0), cropped to
// the land's bounding box plus the water margin.
func (g *grid) island(p *plan) *sim.Island {
	x0, y0, x1, y1 := g.n, g.n, -1, -1
	for i, t := range g.t {
		if t == tWater {
			continue
		}
		x, y := i%g.n, i/g.n
		x0, y0, x1, y1 = min(x0, x), min(y0, y), max(x1, x), max(y1, y)
	}
	x0, y0 = max(0, x0-margin), max(0, y0-margin)
	x1, y1 = min(g.n-1, x1+margin), min(g.n-1, y1+margin)
	w, h := x1-x0+1, y1-y0+1
	tiles := make([]sim.Tile, 0, w*h)
	for y := y0; y <= y1; y++ {
		for x := x0; x <= x1; x++ {
			i := y*g.n + x
			var tile sim.Tile
			switch g.t[i] {
			case tWater:
				tile.Terrain = content.TerrainWater
			case tCoast:
				tile.Terrain = content.TerrainCoast
			case tGrass:
				tile.Terrain = content.TerrainGrass
			case tForest:
				tile.Terrain = content.TerrainForest
			case tMountain:
				tile.Terrain = content.TerrainMountain
			case tRiver:
				tile.Terrain = content.TerrainRiver
			case tIslet:
				tile.Terrain = content.TerrainIslet
			case tCliff:
				tile.Terrain = content.TerrainCliff
			}
			if g.lvl != nil {
				tile.Level, tile.Height = g.lvl[i], g.hgt[i]
			}
			if s := g.depAt(i); s > 0 {
				tile.Deposit = &sim.Deposit{Kind: g.slots[s-1].kind, Quantity: -1}
			}
			tiles = append(tiles, tile)
		}
	}
	is := sim.NewIsland("", w, h, tiles)
	is.SizeClass = p.class.ID
	if len(p.fertilities) > 0 {
		is.Fertilities = slices.Clone(p.fertilities)
	}
	return is
}

// slotRules are the deposit-slot rules derived from the content
// (MECHANICS §2, CONTENT §9): feet is the footprint (width, height at
// rotation 0) the generator reserves per deposit kind, the largest of the
// buildings requiring it (D-054: quarries and mines are 3x8, the clay pit
// 4x6); side is the longest side of any of them, at least 3; gap is the
// minimum Chebyshev distance between the tiles of two slots of a
// habitable island, twice side (16 since D-072 part 2).
type slotRules struct {
	feet      map[string][2]int
	side, gap int
}

func newSlotRules(c *content.Catalogue) slotRules {
	sr := slotRules{feet: map[string][2]int{}, side: 3}
	for _, b := range c.Buildings {
		if b.RequiresDeposit == "" {
			continue
		}
		sr.side = max(sr.side, b.Width, b.Height)
		if f, ok := sr.feet[b.RequiresDeposit]; !ok || b.Width*b.Height > f[0]*f[1] {
			sr.feet[b.RequiresDeposit] = [2]int{b.Width, b.Height}
		}
	}
	sr.gap = 2 * sr.side
	return sr
}

// depAt returns the deposit slot of tile i (0: none).
func (g *grid) depAt(i int) int {
	if g.dep == nil {
		return 0
	}
	return g.dep[i]
}

// buildableArea counts the buildable tiles (coast, grass, forest).
func buildableArea(islands []*sim.Island) int {
	n := 0
	for _, is := range islands {
		for _, t := range is.Tiles {
			if t.Terrain == content.TerrainCoast || t.Terrain == content.TerrainGrass || t.Terrain == content.TerrainForest {
				n++
			}
		}
	}
	return n
}
