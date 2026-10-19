package sim

import (
	"bytes"
	"fmt"
	"maps"
	"math/rand/v2"
	"testing"
	"time"

	"github.com/ricoberger/new-shores/server/internal/content"
)

// Property tests for the MECHANICS §13 invariants that apply to this slice.
// Every case is a seeded random island with random placements, commands and
// advancement splits, so failures are reproducible from the case number.

const propertyCases = 200

// propertyTypes returns the building types placed by property cases: every
// building of the catalogue except roads, with the warehouse last (it is
// excluded from placements at roads).
func propertyTypes(c *content.Catalogue) []string {
	var out []string
	var wh string
	for _, b := range c.Buildings {
		switch {
		case b.Road != nil:
		case b.Warehouse != nil:
			wh = b.ID
		default:
			out = append(out, b.ID)
		}
	}
	return append(out, wh)
}

// propertyCatalogues are the shipped content and the variety test content
// (two-good food category, optional need, upgradeable Citizens house,
// locked tier-2 buildings).
func propertyCatalogues(t *testing.T) map[string]*content.Catalogue {
	return map[string]*content.Catalogue{"old_coast": catalogue(t), "variety": varietyCatalogue(t)}
}

type propCase struct {
	t     *testing.T
	c     *content.Catalogue
	types []string
	rng   *rand.Rand
	w     *World
	l     *Ledger
	// unlocked is the last observed set of unlocked tiers.
	unlocked []string
	// log of operations for failure messages
	ops []string
}

// addStockOp grants goods like a ship delivery; it is applied with AddStock.
type addStockOp struct {
	good string
	qty  Qty
}

func (addStockOp) isCommand() {}

func newPropCase(t *testing.T, c *content.Catalogue, seed uint64) *propCase {
	p := &propCase{t: t, c: c, types: propertyTypes(c), rng: rand.New(rand.NewPCG(seed, 0x5eed)), l: NewLedger()} // #nosec G404 -- deterministic test data
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
	// Most cases are rich; some start poor so that insolvency pauses and
	// auto-resumes happen.
	switch p.rng.IntN(4) {
	case 0:
		w.Gold = 400_000
	case 1:
		w.Gold = 2_000_000
	default:
		w.Gold = 1_000_000_000
	}
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

// townWorld is a settlement with a random subset of up to eight houses,
// market, chapel and the tier-1 chains along one road, little gold and some
// need goods, so that houses grow and decline, insolvency pauses and
// auto-resumes happen and tiers unlock.
func (p *propCase) townWorld() *World {
	p.l = NewLedger() // the ledger of the replaced random world
	rows := make([]string, 14)
	for y := range rows {
		row := make([]byte, 30)
		for x := range row {
			switch {
			case x == 0 || y == 0 || x == 29 || y == 13:
				row[x] = '~'
			case y == 1 && x <= 8:
				row[x] = 'c'
			default:
				row[x] = '.'
			}
		}
		rows[y] = string(row)
	}
	w := NewWorld(t0.Add(time.Duration(p.rng.IntN(1_000_000)) * time.Millisecond))
	w.Islands = []*Island{islandFromRows("main", rows...)}
	free := func(typ string, x, y, rot int) {
		if p.c.BuildingByID[typ] == nil {
			return
		}
		if err := PlaceFree(w, p.c, PlaceBuilding{IslandID: "main", Type: typ, X: x, Y: y, Rotation: rot}, p.l); err != nil {
			p.fail("town %s: %v", typ, err)
		}
	}
	free("warehouse", 1, 1, 0)
	var road []Pos
	for x := 2; x <= 28; x++ {
		road = append(road, Pos{x, 4})
	}
	road = append(road, Pos{6, 3})
	if err := ApplyWithLedger(w, p.c, PlaceRoad{IslandID: "main", Type: "road_dirt", Tiles: road}, p.l); err != nil {
		p.fail("town road: %v", err)
	}
	type spot struct {
		typ       string
		x, y, rot int
	}
	spots := []spot{
		{"fisher", 6, 1, 0}, {"market_small", 17, 1, 0}, {"weaver_wool", 21, 2, 0},
		{"sheep_farm", 24, 5, 180}, {"chapel", 19, 5, 180}, {"bakery", 21, 5, 180},
	}
	for _, x := range []int{9, 11, 13, 15} {
		spots = append(spots, spot{"house_settlers", x, 2, 0}, spot{"house_settlers", x, 5, 180})
	}
	for _, sp := range spots {
		if p.rng.IntN(4) > 0 {
			free(sp.typ, sp.x, sp.y, sp.rot)
		}
	}
	for _, n := range p.c.NeedsByTier[p.c.Tiers[0].ID] {
		for _, g := range n.Goods {
			if err := AddStock(w, p.c, "main", g.Good, Qty(p.rng.IntN(30))*1000, p.l); err != nil {
				p.fail("town stock: %v", err)
			}
		}
	}
	if err := AddStock(w, p.c, "main", "planks", 100_000, p.l); err != nil {
		p.fail("town stock: %v", err)
	}
	w.Gold = Qty(p.rng.IntN(1500)) * 1000
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
	case r < 12:
		x, y := p.randomPos()
		return PlaceBuilding{IslandID: "main", Type: p.types[p.rng.IntN(len(p.types))], X: x, Y: y, Rotation: 90 * p.rng.IntN(4)}
	case r < 47:
		return p.placeAtRoad()
	case r < 52:
		var houses []*Building
		for _, b := range is.Buildings {
			if b.House != nil {
				houses = append(houses, b)
			}
		}
		if len(houses) == 0 {
			return nil
		}
		return UpgradeHouse{IslandID: "main", BuildingID: houses[p.rng.IntN(len(houses))].ID}
	case r < 55:
		// Mostly goods that houses consume, so that houses grow and decline.
		var goods []string
		for _, n := range p.c.NeedsByTier[p.c.Tiers[0].ID] {
			for _, g := range n.Goods {
				goods = append(goods, g.Good)
			}
		}
		if p.rng.IntN(4) == 0 {
			goods = []string{p.c.Goods[p.rng.IntN(len(p.c.Goods))].ID}
		}
		return addStockOp{good: goods[p.rng.IntN(len(goods))], qty: Qty(1+p.rng.IntN(60)) * 1000}
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
	typ := p.types[p.rng.IntN(len(p.types)-1)] // no warehouse
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

// checkInvariants asserts conservation, capacity bounds, gold, residents,
// growth accumulators, workforce factors, unpaid pauses and unlocks.
func (p *propCase) checkInvariants(stage string) {
	p.t.Helper()
	is := p.w.Islands[0]
	now := p.w.LastEvaluatedAt.UnixMilli()
	capFine := capacityFine(is, p.c)
	for _, g := range p.c.Goods {
		good := g.ID
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
	if p.w.Gold < 0 || p.w.GoldSub < 0 || p.w.GoldSub >= GoldSubPerMilli {
		p.fail("%s: gold %d sub %d", stage, p.w.Gold, p.w.GoldSub)
	}
	for _, b := range is.Buildings {
		def := p.c.BuildingByID[b.Type]
		if b.PausedReason == PausedReasonUnpaid && (!b.Paused || def.UpkeepPerMin <= 0 || b.PauseSeq <= 0 || b.PausedAtMs <= 0 || b.PausedAtMs > now) {
			p.fail("%s: unpaid building %d (%s) paused %v upkeep %d seq %d", stage, b.ID, b.Type, b.Paused, def.UpkeepPerMin, b.PauseSeq)
		}
		if b.House == nil {
			continue
		}
		tier := p.c.TierByID[def.House.Tier]
		h := b.House
		if h.Residents < tier.ResidentsFloor || h.Residents > tier.ResidentsMax || h.Residents%1000 != 0 {
			p.fail("%s: residents %d outside [%d, %d] or not whole", stage, h.Residents, tier.ResidentsFloor, tier.ResidentsMax)
		}
		if h.Growth <= -ResidentSub || h.Growth >= ResidentSub {
			p.fail("%s: growth accumulator %d outside (-1, +1) resident", stage, h.Growth)
		}
	}
	r := computeRates(is.clone(), p.c, now)
	for _, pr := range r.producers {
		if pr.workforce < 0 || pr.workforce > 1000 {
			p.fail("%s: workforce factor %d of building %d", stage, pr.workforce, pr.b.ID)
		}
	}
	for _, id := range p.unlocked {
		if !TierUnlocked(p.w, p.c, id) {
			p.fail("%s: tier %s was locked again", stage, id)
		}
	}
	p.unlocked = UnlockedTiers(p.w, p.c)
}

// checkSettled asserts that the world after an Advance is a fixed point of
// settle: settling again at the same time changes nothing, so an Advance
// split at that time behaves like an unsplit one.
func (p *propCase) checkSettled(stage string) {
	p.t.Helper()
	a, err := Encode(p.w, "p")
	if err != nil {
		p.fail("encode: %v", err)
	}
	cw := p.w.Clone()
	settleWorld(cw, p.c, cw.LastEvaluatedAt.UnixMilli())
	if b, _ := Encode(cw, "p"); !bytes.Equal(a, b) {
		p.fail("%s: settle is not idempotent:\nbefore: %s\nafter:  %s", stage, a, b)
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
	apply := func() error { return ApplyWithLedger(p.w, p.c, cmd, p.l) }
	if op, ok := cmd.(addStockOp); ok {
		apply = func() error { return AddStock(p.w, p.c, "main", op.good, op.qty, p.l) }
	}
	if err := apply(); err != nil {
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
	var splits []time.Time // boundary instants of the single advance
	if compose {
		single = p.w.Clone()
		bs, err := Advance(single, p.c, to)
		if err != nil {
			p.fail("single advance: %v", err)
		}
		for _, b := range bs {
			if b.At.After(p.w.LastEvaluatedAt) && b.At.Before(to) {
				splits = append(splits, b.At)
			}
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
			// Half of the splits fall exactly on a boundary instant (or
			// 1 ms after it), where discrete effects happen.
			var later []time.Time
			for _, at := range splits {
				if at.After(p.w.LastEvaluatedAt) {
					later = append(later, at)
				}
			}
			if len(later) > 0 && p.rng.IntN(2) == 0 {
				next = later[p.rng.IntN(len(later))].Add(time.Duration(p.rng.IntN(2)) * time.Millisecond)
				if next.After(to) {
					next = to
				}
			}
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
		p.checkSettled(fmt.Sprintf("advance piece %d", i))
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
// spending, refunds and grants for commands; house consumption is counted as
// consumed), and 0 <= stock <= capacity, gold >= 0, floor <= residents <=
// max (whole residents), -1 < growth accumulator < +1, 0 <= workforce factor
// <= 1, unpaid pauses only on buildings with upkeep and permanent unlocks
// hold after every Apply and Advance piece.
func TestPropertyConservationAndBounds(t *testing.T) {
	for name, c := range propertyCatalogues(t) {
		t.Run(name, func(t *testing.T) {
			for seed := range uint64(propertyCases) {
				p := newPropCase(t, c, seed)
				p.checkInvariants("initial")
				p.run(false)
			}
		})
	}
}

// TestPropertyComposition: Advance(Advance(s, t1), t2) == Advance(s, t2)
// for random split points, compared via the encoded world.
func TestPropertyComposition(t *testing.T) {
	for name, c := range propertyCatalogues(t) {
		t.Run(name, func(t *testing.T) {
			for seed := range uint64(propertyCases) {
				p := newPropCase(t, c, 10_000+seed)
				p.run(true)
			}
		})
	}
}

// TestPropertyTownComposition runs the conservation/bounds and composition
// checks on settlements (townWorld) where growth, insolvency pauses,
// auto-resumes, upgrades and unlocks actually occur.
func TestPropertyTownComposition(t *testing.T) {
	for name, c := range propertyCatalogues(t) {
		t.Run(name, func(t *testing.T) {
			for seed := range uint64(propertyCases) {
				p := newPropCase(t, c, 30_000+seed)
				p.w = p.townWorld()
				p.checkInvariants("initial")
				p.run(true)
			}
		})
	}
}

// fishWeaverCatalogue is the shipped catalogue with no resume reserve and a
// weaver that consumes fish: pausing the weaver frees fish for the houses,
// raises taxes and can make it resumable right after its insolvency pause
// (review round 1).
func fishWeaverCatalogue(t *testing.T, base *content.Catalogue) *content.Catalogue {
	c := *base
	c.Region.Rules.AutoResumeMs = 0
	weaver := *base.BuildingByID["weaver_wool"]
	rec := *weaver.Recipe
	rec.Inputs = []content.GoodAmount{{Good: "fish", Amount: 1000}}
	weaver.Recipe = &rec
	c.BuildingByID = maps.Clone(base.BuildingByID)
	c.BuildingByID["weaver_wool"] = &weaver
	return &c
}

// TestPropertyTownCompositionNoReserve repeats the town composition check
// with auto_resume_upkeep_minutes = 0 and the fish-consuming weaver.
func TestPropertyTownCompositionNoReserve(t *testing.T) {
	c := fishWeaverCatalogue(t, varietyCatalogue(t))
	for seed := range uint64(propertyCases / 2) {
		p := newPropCase(t, c, 50_000+seed)
		p.w = p.townWorld()
		p.checkInvariants("initial")
		p.run(true)
	}
}

// TestPropertyPauseResumeInterplay targets insolvency pauses that change
// taxes at once: houses share a fisher's fish with two fish-consuming
// weavers, gold is nearly zero and there is no resume reserve. Pausing a
// weaver frees fish and raises taxes, resuming it lowers them again; before
// review round 1 this flapped every millisecond until the iteration cap.
// Advances are split at random times and exactly at boundary instants
// (including pauses); every piece must leave a settled world, the split
// result must equal a single Advance and coarse mode is never reached.
func TestPropertyPauseResumeInterplay(t *testing.T) {
	c := fishWeaverCatalogue(t, catalogue(t))
	pauses, resumes := 0, 0
	for seed := range uint64(propertyCases) {
		p := newPropCase(t, c, 60_000+seed)
		p.l = NewLedger()
		w := NewWorld(t0.Add(time.Duration(p.rng.IntN(1_000_000)) * time.Millisecond))
		w.Islands = []*Island{islandFromRows("main", townRows()...)}
		p.w = w
		free := func(typ string, x, y, rot int) {
			if err := PlaceFree(w, c, PlaceBuilding{IslandID: "main", Type: typ, X: x, Y: y, Rotation: rot}, p.l); err != nil {
				p.fail("%s: %v", typ, err)
			}
		}
		free("warehouse", 1, 1, 0)
		road := []Pos{{6, 3}}
		for x := 2; x <= 28; x++ {
			road = append(road, Pos{x, 4})
		}
		if err := ApplyWithLedger(w, c, PlaceRoad{IslandID: "main", Type: "road_dirt", Tiles: road}, p.l); err != nil {
			p.fail("road: %v", err)
		}
		free("fisher", 6, 1, 0)
		free("market_small", 17, 1, 0)
		free("weaver_wool", 21, 2, 0)
		free("weaver_wool", 24, 2, 0)
		for i, x := range []int{9, 11, 13, 15, 9, 11, 13, 15}[:6+p.rng.IntN(3)] {
			if i < 4 {
				free("house_settlers", x, 2, 0)
			} else {
				free("house_settlers", x, 5, 180)
			}
		}
		for _, b := range w.Islands[0].Buildings {
			if b.House != nil {
				b.House.Residents = Qty(6+p.rng.IntN(3)) * 1000
			}
		}
		if err := AddStock(w, c, "main", "wool_garments", 100_000, p.l); err != nil {
			p.fail("stock: %v", err)
		}
		if err := AddStock(w, c, "main", "fish", Qty(p.rng.IntN(5))*1000, p.l); err != nil {
			p.fail("stock: %v", err)
		}
		w.Gold = Qty(p.rng.IntN(20_000))
		p.checkInvariants("initial")
		for range 3 {
			for _, b := range p.advance(p.randomDuration(), true) {
				switch {
				case b.Kind == BoundaryAutoPause:
					pauses++
				case b.Kind == BoundaryAutoResume && b.BuildingID != 0:
					resumes++
				}
			}
		}
	}
	t.Logf("auto pauses %d, auto resumes %d", pauses, resumes)
	if pauses == 0 || resumes == 0 {
		t.Error("cases did not exercise pauses and resumes")
	}
}

// TestPropertyDeterminism: the same random scenario run twice yields the
// identical world and boundaries.
func TestPropertyDeterminism(t *testing.T) {
	for name, c := range propertyCatalogues(t) {
		t.Run(name, func(t *testing.T) {
			for seed := range uint64(propertyCases) {
				a, abs := newPropCase(t, c, 20_000+seed).run(false)
				b, bbs := newPropCase(t, c, 20_000+seed).run(false)
				if !bytes.Equal(a, b) || fmt.Sprint(abs) != fmt.Sprint(bbs) {
					t.Fatalf("seed %d: runs differ", seed)
				}
			}
		})
	}
}
