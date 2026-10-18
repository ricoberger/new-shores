package sim

import (
	"bytes"
	"fmt"
	"math/rand/v2"
	"testing"
	"time"

	"github.com/ricoberger/new-shores/server/internal/content"
)

// Property tests for the MECHANICS §13 invariants that apply to this slice.
// Every case is a seeded random island with random placements, commands and
// advancement splits, so failures are reproducible from the case number.

const propertyCases = 200

var (
	propertyTypes = []string{"lumberjack", "sawmill", "fisher", "sheep_farm", "weaver_wool", "house_settlers", "market_small", "warehouse"}
	goodIDs       = []string{"wood", "planks", "fish", "wool", "wool_garments"}
)

type propCase struct {
	t   *testing.T
	c   *content.Catalogue
	rng *rand.Rand
	w   *World
	l   *Ledger
	// log of operations for failure messages
	ops []string
}

func newPropCase(t *testing.T, c *content.Catalogue, seed uint64) *propCase {
	p := &propCase{t: t, c: c, rng: rand.New(rand.NewPCG(seed, 0x5eed)), l: NewLedger()} // #nosec G404 -- deterministic test data
	p.w = p.randomWorld()
	return p
}

func (p *propCase) fail(format string, args ...any) {
	p.t.Helper()
	p.t.Fatalf("%s\nops: %v", fmt.Sprintf(format, args...), p.ops)
}

func (p *propCase) randomWorld() *World {
	const width, height = 18, 12
	tiles := make([]Tile, width*height)
	for y := range height {
		for x := range width {
			terrain := content.TerrainWater
			switch {
			case x == 0 || y == 0 || x == width-1 || y == height-1:
			case y == 1:
				terrain = content.TerrainCoast
			case x <= 4 && y <= 3, y == 4:
				terrain = content.TerrainGrass
			default:
				switch r := p.rng.IntN(100); {
				case r < 45:
					terrain = content.TerrainForest
				case r < 95:
					terrain = content.TerrainGrass
				default:
					terrain = content.TerrainMountain
				}
			}
			tiles[y*width+x] = Tile{Terrain: terrain}
		}
	}
	w := NewWorld(t0.Add(time.Duration(p.rng.IntN(1_000_000)) * time.Millisecond))
	w.Islands = []*Island{NewIsland("main", width, height, tiles)}
	if err := PlaceFree(w, p.c, PlaceBuilding{IslandID: "main", Type: "warehouse", X: 1, Y: 1}, p.l); err != nil {
		p.fail("seed warehouse: %v", err)
	}
	w.Gold = 1_000_000_000
	if err := AddStock(w, p.c, "main", "planks", 250_000, p.l); err != nil {
		p.fail("seed stock: %v", err)
	}
	var road []Pos
	for x := 2; x < width-1; x++ {
		road = append(road, Pos{x, 4})
	}
	for range 1 + p.rng.IntN(3) {
		x := 3 + p.rng.IntN(width-5)
		for y := 5; y < 5+p.rng.IntN(height-6); y++ {
			if w.Islands[0].Tile(x, y).Terrain != content.TerrainMountain {
				road = append(road, Pos{x, y})
			} else {
				break
			}
		}
	}
	seen := map[Pos]bool{}
	var uniq []Pos
	for _, r := range road {
		if !seen[r] {
			seen[r] = true
			uniq = append(uniq, r)
		}
	}
	if err := ApplyWithLedger(w, p.c, PlaceRoad{IslandID: "main", Type: "road_dirt", Tiles: uniq}, p.l); err != nil {
		p.fail("seed road: %v", err)
	}
	return w
}

func (p *propCase) randomPos() (int, int) {
	is := p.w.Islands[0]
	return p.rng.IntN(is.Width), p.rng.IntN(is.Height)
}

// randomCommand returns a random command; many of them are invalid.
func (p *propCase) randomCommand() Command {
	is := p.w.Islands[0]
	switch r := p.rng.IntN(100); {
	case r < 15:
		x, y := p.randomPos()
		return PlaceBuilding{IslandID: "main", Type: propertyTypes[p.rng.IntN(len(propertyTypes))], X: x, Y: y, Rotation: 90 * p.rng.IntN(4)}
	case r < 55:
		return p.placeAtRoad()
	case r < 65:
		x, y := p.randomPos()
		return PlaceRoad{IslandID: "main", Type: "road_dirt", Tiles: []Pos{{x, y}}}
	case r < 72:
		x, y := p.randomPos()
		return DemolishRoad{IslandID: "main", Tiles: []Pos{{x, y}}}
	case r < 85:
		if len(is.Buildings) == 0 {
			return nil
		}
		b := is.Buildings[p.rng.IntN(len(is.Buildings))]
		return SetPaused{IslandID: "main", BuildingID: b.ID, Paused: p.rng.IntN(2) == 0}
	default:
		if len(is.Buildings) < 2 {
			return nil
		}
		// The seeded warehouse (ID 1) is demolished only rarely.
		b := is.Buildings[1+p.rng.IntN(len(is.Buildings)-1)]
		if p.rng.IntN(20) == 0 {
			b = is.Buildings[0]
		}
		return Demolish{IslandID: "main", BuildingID: b.ID, AcceptSurplusLoss: p.rng.IntN(3) == 0}
	}
}

// placeAtRoad returns a random placement whose entrance touches a road tile,
// preferring (up to 20 attempts) one that is valid.
func (p *propCase) placeAtRoad() Command {
	var cmd Command
	for range 20 {
		cmd = p.placeAtRoadOnce()
		if cmd == nil || Apply(p.w.Clone(), p.c, cmd) == nil {
			return cmd
		}
	}
	return cmd
}

func (p *propCase) placeAtRoadOnce() Command {
	is := p.w.Islands[0]
	if len(is.Roads) == 0 {
		return nil
	}
	keys := sortedKeys(roadKeys(is))
	i := keys[p.rng.IntN(len(keys))]
	var road Pos
	fmt.Sscanf(i, "%d,%d", &road.X, &road.Y)
	d := neighbours()[p.rng.IntN(4)]
	e := Pos{road.X + d.X, road.Y + d.Y}
	typ := propertyTypes[p.rng.IntN(len(propertyTypes)-1)] // no warehouse
	rot := 90 * p.rng.IntN(4)
	off := entrance(p.c.BuildingByID[typ], 0, 0, rot)
	return PlaceBuilding{IslandID: "main", Type: typ, X: e.X - off.X, Y: e.Y - off.Y, Rotation: rot}
}

func roadKeys(is *Island) map[string]bool {
	m := map[string]bool{}
	for i := range is.Roads {
		m[fmt.Sprintf("%d,%d", i%is.Width, i/is.Width)] = true
	}
	return m
}

func (p *propCase) randomDuration() time.Duration {
	switch p.rng.IntN(3) {
	case 0:
		return time.Duration(1+p.rng.IntN(60_000)) * time.Millisecond
	case 1:
		return time.Duration(1+p.rng.IntN(30*60_000)) * time.Millisecond
	default:
		return time.Duration(1+p.rng.IntN(4*3_600_000)) * time.Millisecond
	}
}

// total returns stock + in-transit + buffers of a good in sub-milli units.
func total(is *Island, good string, now int64) int64 {
	t := is.Inventory.fine(good) + transitFine(is, good, now)
	for _, b := range is.Buildings {
		t += b.bufferFine(good)
	}
	return t
}

// checkInvariants asserts conservation, capacity bounds, gold and residents.
func (p *propCase) checkInvariants(stage string) {
	p.t.Helper()
	is := p.w.Islands[0]
	now := p.w.LastEvaluatedAt.UnixMilli()
	capFine := capacityFine(is, p.c)
	for _, good := range goodIDs {
		s := is.Inventory.fine(good)
		if s < 0 || s > capFine {
			p.fail("%s: %s stock %d outside [0, %d]", stage, good, s, capFine)
		}
		if sub := is.Inventory.StockSub[good]; sub < 0 || sub >= SubPerMilli {
			p.fail("%s: %s sub-milli remainder %d", stage, good, sub)
		}
		f := p.l.Flow("main", good)
		want := f.Produced - f.Consumed - f.Lost - f.Spent + f.Refunded + f.Granted
		if got := total(is, good, now); got != want {
			p.fail("%s: conservation of %s: stock+transit+buffer = %d, ledger = %d (%+v)", stage, good, got, want, f)
		}
	}
	if p.w.Gold < 0 {
		p.fail("%s: gold %d < 0", stage, p.w.Gold)
	}
	for _, b := range is.Buildings {
		if b.House == nil {
			continue
		}
		tier := p.c.TierByID[p.c.BuildingByID[b.Type].House.Tier]
		if b.House.Residents < tier.ResidentsFloor || b.House.Residents > tier.ResidentsMax {
			p.fail("%s: residents %d outside [%d, %d]", stage, b.House.Residents, tier.ResidentsFloor, tier.ResidentsMax)
		}
	}
}

func (p *propCase) apply(cmd Command) {
	p.t.Helper()
	if cmd == nil {
		return
	}
	before, err := Encode(p.w, "p")
	if err != nil {
		p.fail("encode: %v", err)
	}
	if err := ApplyWithLedger(p.w, p.c, cmd, p.l); err != nil {
		after, _ := Encode(p.w, "p")
		if !bytes.Equal(before, after) {
			p.fail("Apply(%#v) failed with %v but changed the world", cmd, err)
		}
		return
	}
	p.ops = append(p.ops, fmt.Sprintf("%T%+v", cmd, cmd))
	p.checkInvariants(fmt.Sprintf("after %T", cmd))
}

// advance advances by d in 1-4 random pieces, checking the invariants after
// every piece. With compose set it also checks that the split advancement
// equals a single Advance to the same time.
func (p *propCase) advance(d time.Duration, compose bool) []Boundary {
	p.t.Helper()
	to := p.w.LastEvaluatedAt.Add(d)
	var single *World
	if compose {
		single = p.w.Clone()
		if _, err := Advance(single, p.c, to); err != nil {
			p.fail("single advance: %v", err)
		}
	}
	p.ops = append(p.ops, fmt.Sprintf("advance %s", d))

	var all []Boundary
	pieces := 1 + p.rng.IntN(4)
	for i := 0; i < pieces; i++ {
		next := to
		if i < pieces-1 {
			span := to.Sub(p.w.LastEvaluatedAt)
			if span <= 0 {
				break
			}
			next = p.w.LastEvaluatedAt.Add(time.Duration(p.rng.Int64N(int64(span/time.Millisecond)+1)) * time.Millisecond)
		}
		bs, err := AdvanceWithLedger(p.w, p.c, next, p.l)
		if err != nil {
			p.fail("advance: %v", err)
		}
		for _, b := range bs {
			if b.Kind == BoundaryCoarseMode {
				p.fail("iteration cap reached in a property case")
			}
		}
		all = append(all, bs...)
		p.checkInvariants(fmt.Sprintf("advance piece %d", i))
	}
	if !p.w.LastEvaluatedAt.Equal(to) {
		bs, err := AdvanceWithLedger(p.w, p.c, to, p.l)
		if err != nil {
			p.fail("advance: %v", err)
		}
		all = append(all, bs...)
	}
	if compose {
		a, _ := Encode(single, "p")
		b, _ := Encode(p.w, "p")
		if !bytes.Equal(a, b) {
			p.fail("composition violated after %s split into %d pieces:\nsingle: %s\nsplit:  %s", d, pieces, a, b)
		}
	}
	return all
}

// run executes a random scenario and returns the encoded final world and
// the boundaries.
func (p *propCase) run(compose bool) ([]byte, []Boundary) {
	var bs []Boundary
	for range 10 + p.rng.IntN(15) {
		p.apply(p.randomCommand())
	}
	for range 4 + p.rng.IntN(6) {
		if p.rng.IntN(3) == 0 {
			bs = append(bs, p.advance(p.randomDuration(), compose)...)
			continue
		}
		p.apply(p.randomCommand())
	}
	bs = append(bs, p.advance(p.randomDuration(), compose)...)
	data, err := Encode(p.w, "p")
	if err != nil {
		p.fail("encode: %v", err)
	}
	return data, bs
}

// TestPropertyConservationAndBounds: for every good, the change of stock +
// in-transit + buffers equals produced - consumed - lost (plus construction
// spending, refunds and grants for commands), and 0 <= stock <= capacity,
// gold >= 0 and floor <= residents <= max hold after every Apply and Advance.
func TestPropertyConservationAndBounds(t *testing.T) {
	c := catalogue(t)
	for seed := range uint64(propertyCases) {
		p := newPropCase(t, c, seed)
		p.checkInvariants("initial")
		p.run(false)
	}
}

// TestPropertyComposition: Advance(Advance(s, t1), t2) == Advance(s, t2)
// for random split points, compared via the encoded world.
func TestPropertyComposition(t *testing.T) {
	c := catalogue(t)
	for seed := range uint64(propertyCases) {
		p := newPropCase(t, c, 10_000+seed)
		p.run(true)
	}
}

// TestPropertyDeterminism: the same random scenario run twice yields the
// identical world and boundaries.
func TestPropertyDeterminism(t *testing.T) {
	c := catalogue(t)
	for seed := range uint64(propertyCases) {
		a, abs := newPropCase(t, c, 20_000+seed).run(false)
		b, bbs := newPropCase(t, c, 20_000+seed).run(false)
		if !bytes.Equal(a, b) || fmt.Sprint(abs) != fmt.Sprint(bbs) {
			t.Fatalf("seed %d: runs differ", seed)
		}
	}
}
