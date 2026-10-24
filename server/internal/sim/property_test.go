package sim

import (
	"bytes"
	"fmt"
	"maps"
	"math/rand/v2"
	"slices"
	"strings"
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
	// splitKinds counts the deliberate split points used by advance, by the
	// kind of boundary they were taken from ("between" for a point strictly
	// between a gold_zero and the following gold_reserve boundary).
	splitKinds map[string]int
	// maxPieces bounds the number of pieces of a split advancement
	// (default 4).
	maxPieces int
	// queued counts the observations of a ship waiting for a berth and
	// atSea those of a ship at sea (checkInvariants).
	queued, atSea int
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
	p := &propCase{t: t, c: c, types: propertyTypes(c), rng: rand.New(rand.NewPCG(seed, 0x5eed)), l: NewLedger(), splitKinds: map[string]int{}} // #nosec G404 -- deterministic test data
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
				// A bay row: the Trading Post (1,0) and fishers stand with
				// their front rows on it (D-051).
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
	if err := PlaceFree(w, p.c, PlaceBuilding{IslandID: "main", Type: "trading_post", X: 1, Y: 0}, p.l); err != nil {
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
				row[x] = '~'
			default:
				row[x] = '.'
			}
		}
		rows[y] = string(row)
	}
	w := NewWorld(t0.Add(time.Duration(p.rng.IntN(1_000_000)) * time.Millisecond))
	w.Islands = []*Island{islandFromRows("main", rows...)}
	free := func(typ string, x, y, rot int) {
		// Only first-tier buildings: the town is a Settler town (the
		// shipped content's tier-2 bakery needs flour and Citizens).
		if def := p.c.BuildingByID[typ]; def == nil || def.Tier != p.c.Tiers[0].ID {
			return
		}
		if err := PlaceFree(w, p.c, PlaceBuilding{IslandID: "main", Type: typ, X: x, Y: y, Rotation: rot}, p.l); err != nil {
			p.fail("town %s: %v", typ, err)
		}
	}
	free("trading_post", 1, 0, 0)
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
	// Up to 16 fields around the town's farms (D-049), so that their
	// chains run.
	for _, fb := range sortedKeys(p.c.FieldByType) {
		def := p.c.FieldByType[fb]
		if def.Tier != p.c.Tiers[0].ID {
			continue
		}
		var cand []Pos
		for y := range 14 {
			for x := range 30 {
				cand = append(cand, Pos{x, y})
			}
		}
		valid := ValidFieldTiles(w.Islands[0], p.c, def.ID, cand)
		for i := 0; i < len(valid) && i < 4*(1+p.rng.IntN(4)); i++ {
			free(def.ID, valid[i].X, valid[i].Y, 0)
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
	case r < 8:
		x, y := p.randomPos()
		return PlaceBuilding{IslandID: "main", Type: p.types[p.rng.IntN(len(p.types))], X: x, Y: y, Rotation: 90 * p.rng.IntN(4)}
	case r < 12:
		return p.randomFieldCommand()
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
	case r < 81:
		if len(is.Buildings) == 0 {
			return nil
		}
		b := is.Buildings[p.rng.IntN(len(is.Buildings))]
		return SetPaused{IslandID: "main", BuildingID: b.ID, Paused: p.rng.IntN(2) == 0}
	case r < 85:
		return p.randomMove()
	case r < 88:
		// Warehouse upgrades charge gold and materials like a placement
		// (conservation via the ledger's Spent); most fail for lack of
		// stone or at the last level.
		var whs []*Building
		for _, b := range is.Buildings {
			if def := p.c.BuildingByID[b.Type]; def != nil && def.Collector() {
				whs = append(whs, b)
			}
		}
		if len(whs) == 0 {
			return nil
		}
		if p.c.GoodByID["stone"] != nil && p.rng.IntN(2) == 0 {
			return addStockOp{good: "stone", qty: 20_000}
		}
		b := whs[p.rng.IntN(len(whs))]
		if def := p.c.BuildingByID[b.Type]; def.TradingPost != nil {
			return UpgradeTradingPost{IslandID: "main", BuildingID: b.ID}
		}
		return UpgradeWarehouse{IslandID: "main", BuildingID: b.ID}
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

// randomFieldCommand returns a PlaceFields of the valid tiles of a random
// rectangle around a farm (sometimes with one random, mostly invalid,
// tile, which fails the whole command) or a DemolishFields of random
// field tiles (sometimes with another tile). Nil without field types.
func (p *propCase) randomFieldCommand() Command {
	is := p.w.Islands[0]
	if len(p.c.FieldByType) == 0 {
		return nil
	}
	var fields []Pos
	for _, b := range is.Buildings {
		if def := p.c.BuildingByID[b.Type]; def != nil && def.Field != nil {
			fields = append(fields, Pos{b.X, b.Y})
		}
	}
	if len(fields) > 0 && p.rng.IntN(3) == 0 {
		var tiles []Pos
		for range 1 + p.rng.IntN(3) {
			tiles = append(tiles, fields[p.rng.IntN(len(fields))])
		}
		if p.rng.IntN(4) == 0 {
			x, y := p.randomPos()
			tiles = append(tiles, Pos{x, y})
		}
		return DemolishFields{IslandID: "main", Tiles: uniquePos(tiles)}
	}
	types := sortedKeys(p.c.FieldByType)
	def := p.c.FieldByType[types[p.rng.IntN(len(types))]]
	cx, cy := p.randomPos()
	for _, b := range is.Buildings {
		if fd := p.c.BuildingByID[b.Type]; fd != nil && fd.Fields != nil && fd.Fields.Type == def.Field.Type && p.rng.IntN(2) == 0 {
			cx, cy = b.X+1, b.Y+1
		}
	}
	var rect []Pos
	w, h := 1+p.rng.IntN(8), 1+p.rng.IntN(8)
	for y := cy - h/2; y < cy-h/2+h; y++ {
		for x := cx - w/2; x < cx-w/2+w; x++ {
			rect = append(rect, Pos{x, y})
		}
	}
	tiles := ValidFieldTiles(is, p.c, def.ID, rect)
	if p.rng.IntN(5) == 0 || len(tiles) == 0 {
		x, y := p.randomPos()
		tiles = append(tiles, Pos{x, y})
	}
	return PlaceFields{IslandID: "main", Type: def.ID, Tiles: uniquePos(tiles)}
}

func uniquePos(tiles []Pos) []Pos {
	seen := map[Pos]bool{}
	var out []Pos
	for _, t := range tiles {
		if !seen[t] {
			seen[t] = true
			out = append(out, t)
		}
	}
	return out
}

// placeAtRoad returns a random placement whose footprint touches a road
// tile, preferring (up to 20 attempts) one that is valid. Random placements
// without a road come from randomCommand (placement never requires a road,
// D-042), so unconnected buildings and houses occur as well.
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
	e := Pos{road.X + d.X, road.Y + d.Y}       // a footprint tile next to the road
	typ := p.types[p.rng.IntN(len(p.types)-1)] // no warehouse
	rot := 90 * p.rng.IntN(4)
	w, h := footprint(p.c.BuildingByID[typ], rot)
	return PlaceBuilding{IslandID: "main", Type: typ, X: e.X - p.rng.IntN(w), Y: e.Y - p.rng.IntN(h), Rotation: rot}
}

// randomMove returns a move of a random building to a random target,
// preferring (up to 20 attempts) a valid one; nil without buildings.
func (p *propCase) randomMove() Command {
	is := p.w.Islands[0]
	if len(is.Buildings) == 0 {
		return nil
	}
	b := is.Buildings[p.rng.IntN(len(is.Buildings))]
	var cmd Command
	for range 20 {
		cmd = p.moveTarget(b)
		if Apply(p.w.Clone(), p.c, cmd) == nil {
			return cmd
		}
	}
	return cmd
}

// moveTarget returns a move of b to a random position (next to a road in
// half of the cases, possibly overlapping its own footprint).
func (p *propCase) moveTarget(b *Building) MoveBuilding {
	rot := 90 * p.rng.IntN(4)
	x, y := p.randomPos()
	switch p.rng.IntN(3) {
	case 0:
		if place, ok := p.placeAtRoadOnce().(PlaceBuilding); ok {
			x, y = place.X, place.Y
		}
	case 1:
		x, y = b.X+p.rng.IntN(5)-2, b.Y+p.rng.IntN(5)-2
	}
	return MoveBuilding{IslandID: "main", BuildingID: b.ID, X: x, Y: y, Rotation: rot}
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

// checkInvariants asserts conservation (per island and world-wide including
// cargo aboard ships), capacity bounds, gold, residents, growth
// accumulators, workforce factors, unpaid pauses, unlocks and the ship
// invariants (a ship is in exactly one place, whole milli-units within its
// slots, pending due moments after now).
func (p *propCase) checkInvariants(stage string) {
	p.t.Helper()
	now := p.w.LastEvaluatedAt.UnixMilli()
	cargo := map[string]int64{}
	for _, s := range p.w.Ships {
		def := p.c.ShipByID[s.Type]
		for _, sl := range s.Cargo {
			cargo[sl.Good] += sl.Amount * SubPerMilli
			if sl.Amount <= 0 || sl.Amount > def.SlotSize {
				p.fail("%s: ship %d slot %+v", stage, s.ID, sl)
			}
		}
		if len(s.Cargo) > def.Slots || slotsUsed(cargoAmounts(s), def.SlotSize) != len(s.Cargo) {
			p.fail("%s: ship %d cargo %+v exceeds %d slots or is not canonical", stage, s.ID, s.Cargo, def.Slots)
		}
		if s.AtSea != nil {
			p.atSea++
			// At sea only idle or anchored, at no island (D-051).
			if s.IslandID != "" || s.Leg != nil || (s.State != ShipIdle && s.State != ShipAnchoredUnpaid) {
				p.fail("%s: ship at sea %+v", stage, s)
			}
		}
		switch s.State {
		case ShipIdle, ShipAnchoredUnpaid:
			if s.Leg != nil || (p.w.Island(s.IslandID) == nil) == (s.AtSea == nil) || s.BerthUntilMs != 0 || s.QueuedAtMs != 0 {
				p.fail("%s: ship %d %s at %q with leg %+v berth %d queued %d", stage, s.ID, s.State, s.IslandID, s.Leg, s.BerthUntilMs, s.QueuedAtMs)
			}
		case ShipWaitingForBerth:
			p.queued++
			// Queued at an island for a berth (D-051): no leg, no berth.
			if s.Leg != nil || p.w.Island(s.IslandID) == nil || s.QueuedAtMs <= 0 || s.QueuedAtMs > now || s.BerthUntilMs != 0 {
				p.fail("%s: waiting ship %+v", stage, s)
			}
		case ShipOnRoute, ShipManualLeg:
			l := s.Leg
			switch {
			case l == nil && s.State == ShipManualLeg && s.BerthUntilMs > now && p.w.Island(s.IslandID) != nil:
				// Unloading at a berth after a manual leg.
			case l == nil:
				p.fail("%s: ship %d %s without leg", stage, s.ID, s.State)
			case s.BerthUntilMs != 0 && (s.BerthUntilMs != l.DepartAtMs || s.BerthUntilMs <= now):
				p.fail("%s: ship %d holds a berth until %d with leg %+v at %d", stage, s.ID, s.BerthUntilMs, l, now)
			case l.DepartAtMs > now && s.IslandID != l.FromIsland, l.DepartAtMs <= now && s.IslandID != "":
				p.fail("%s: ship %d at %q with leg %+v at %d", stage, s.ID, s.IslandID, l, now)
			case l.ArriveAtMs <= now || l.ArriveAtMs <= l.DepartAtMs || l.FromIsland == l.ToIsland:
				p.fail("%s: ship %d leg %+v at %d", stage, s.ID, l, now)
			}
		default:
			p.fail("%s: ship %d state %q", stage, s.ID, s.State)
		}
		if s.State != ShipAnchoredUnpaid && s.State != ShipWaitingForBerth && (s.State == ShipOnRoute) != (s.RouteID != 0) {
			p.fail("%s: ship %d %s with route %d", stage, s.ID, s.State, s.RouteID)
		}
		if s.RouteID != 0 && p.w.Route(s.RouteID) == nil {
			p.fail("%s: ship %d on missing route %d", stage, s.ID, s.RouteID)
		}
		if s.Paused != (s.PausedReason == PausedReasonUnpaid) || (s.State == ShipAnchoredUnpaid && !s.Paused) {
			p.fail("%s: ship %d paused %v reason %q state %s", stage, s.ID, s.Paused, s.PausedReason, s.State)
		}
	}
	for _, e := range DueEvents(p.w) {
		if e.At.UnixMilli() <= now {
			p.fail("%s: due moment %+v not after %d", stage, e, now)
		}
	}
	// Berths (MECHANICS §9.3): never more holders than berths, none at an
	// island without a pier; a queue only while every berth is busy.
	for _, is := range p.w.Islands {
		total, holders := berthTotal(is), berthHolders(p.w, is.ID, now)
		if len(holders) > total {
			p.fail("%s: %s has %d berth holders for %d berths", stage, is.ID, len(holders), total)
		}
		if q := berthQueue(p.w, is.ID); len(q) > 0 && total > 0 && len(holders) < total {
			p.fail("%s: %s queues %d ships with %d of %d berths busy", stage, is.ID, len(q), len(holders), total)
		}
	}
	for _, g := range p.c.Goods {
		good := g.ID
		var world, flows int64
		for _, is := range p.w.Islands {
			capFine := capacityFine(is, p.c)
			s := is.Inventory.fine(good)
			if s < 0 || s > capFine {
				p.fail("%s: %s/%s stock %d outside [0, %d]", stage, is.ID, good, s, capFine)
			}
			if sub := is.Inventory.StockSub[good]; sub < 0 || sub >= SubPerMilli {
				p.fail("%s: %s sub-milli remainder %d", stage, good, sub)
			}
			f := p.l.Flow(is.ID, good)
			own := f.Produced - f.Consumed - f.Lost - f.Spent + f.Refunded + f.Granted
			want := own - f.Loaded + f.Unloaded
			got := total(is, good, now)
			if got != want {
				p.fail("%s: conservation of %s on %s: stock+transit+buffer = %d, ledger = %d (%+v)", stage, good, is.ID, got, want, f)
			}
			world += got
			flows += own
		}
		if world+cargo[good] != flows {
			p.fail("%s: world conservation of %s: islands %d + cargo %d != ledger %d", stage, good, world, cargo[good], flows)
		}
	}
	if p.w.Gold < 0 || p.w.GoldSub < 0 || p.w.GoldSub >= GoldSubPerMilli {
		p.fail("%s: gold %d sub %d", stage, p.w.Gold, p.w.GoldSub)
	}
	for _, is := range p.w.Islands {
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
	// Deliberate split points from the single advance (R31): every boundary
	// instant and the millisecond after it (gold_zero, gold_reserve, the
	// auto_pause/auto_resume instants, residents, regimes, transfers) and a
	// point strictly between each gold_zero and the next gold_reserve
	// boundary, while stocks are changing.
	type split struct {
		at   time.Time
		kind string
	}
	var splits []split
	if compose {
		single = p.w.Clone()
		bs, err := Advance(single, p.c, to)
		if err != nil {
			p.fail("single advance: %v", err)
		}
		start := p.w.LastEvaluatedAt
		for i, b := range bs {
			kind := b.Kind
			if b.Kind == BoundaryAutoResume && b.Trial {
				kind = "trial_resume"
			}
			for _, at := range []time.Time{b.At, b.At.Add(time.Millisecond)} {
				if at.After(start) && at.Before(to) {
					splits = append(splits, split{at, kind})
				}
			}
			// Inside the handling time after an arrival (before the
			// departure) and at the departure itself.
			if h := p.c.Region.Rules.ShipHandlingBaseMs; b.Kind == BoundaryShipArrived && h > 1 {
				for _, at := range []time.Time{b.At.Add(time.Duration(1+p.rng.Int64N(h-1)) * time.Millisecond), b.At.Add(time.Duration(h) * time.Millisecond)} {
					if at.After(start) && at.Before(to) {
						splits = append(splits, split{at, "handling"})
					}
				}
			}
			if b.Kind != BoundaryGoldZero {
				continue
			}
			end := to
			for _, r := range bs[i+1:] {
				if r.Kind == BoundaryGoldReserve {
					end = r.At
					break
				}
			}
			if gap := end.Sub(b.At); gap > 2*time.Millisecond {
				at := b.At.Add(time.Millisecond + time.Duration(p.rng.Int64N(int64(gap/time.Millisecond)-1))*time.Millisecond)
				splits = append(splits, split{at, "between"})
			}
		}
	}
	p.ops = append(p.ops, fmt.Sprintf("advance %s", d))

	var all []Boundary
	pieces := 1 + p.rng.IntN(max(p.maxPieces, 4))
	for i := 0; i < pieces; i++ {
		next := to
		if i < pieces-1 {
			span := to.Sub(p.w.LastEvaluatedAt)
			if span <= 0 {
				break
			}
			next = p.w.LastEvaluatedAt.Add(time.Duration(p.rng.Int64N(int64(span/time.Millisecond)+1)) * time.Millisecond)
			// Most splits use a deliberate split point; economy points
			// (gold_zero, gold_reserve, auto_pause, auto_resume, between)
			// are preferred when there are any.
			// The economy kind is chosen uniformly first, so that rare
			// kinds (gold_reserve, auto_resume) are split at often enough.
			var later []split
			byKind := map[string][]split{}
			for _, sp := range splits {
				if sp.at.After(p.w.LastEvaluatedAt) {
					later = append(later, sp)
					switch sp.kind {
					case BoundaryGoldZero, BoundaryGoldReserve, BoundaryAutoPause, BoundaryAutoResume, "between",
						BoundaryGoldTrialReserve, "trial_resume",
						BoundaryShipArrived, BoundaryShipBuilt, "handling":
						byKind[sp.kind] = append(byKind[sp.kind], sp)
					}
				}
			}
			if kinds := sortedKeys(byKind); len(kinds) > 0 && p.rng.IntN(4) > 0 {
				later = byKind[kinds[p.rng.IntN(len(kinds))]]
			}
			if len(later) > 0 && p.rng.IntN(3) > 0 {
				sp := later[p.rng.IntN(len(later))]
				next = sp.at
				p.splitKinds[sp.kind]++
			}
		}
		moved := next.After(p.w.LastEvaluatedAt)
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
		// A zero-length piece is a no-op Advance: right after a command the
		// regimes are still cleared (re-derived by the next settle), which
		// is not a settled world.
		if moved {
			p.checkSettled(fmt.Sprintf("advance piece %d", i))
		}
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
			upgrades := 0
			for seed := range uint64(propertyCases) {
				p := newPropCase(t, c, seed)
				p.checkInvariants("initial")
				p.run(false)
				for _, op := range p.ops {
					if strings.HasPrefix(op, "sim.UpgradeWarehouse") || strings.HasPrefix(op, "sim.UpgradeTradingPost") {
						upgrades++
					}
				}
			}
			// Content with a second warehouse level must exercise the
			// upgrade's material charges (conservation via Spent).
			if wh := c.BuildingByID["trading_post"]; len(wh.TradingPost.Levels) > 1 && upgrades == 0 {
				t.Error("no successful warehouse upgrade")
			}
			t.Logf("successful warehouse upgrades: %d", upgrades)
		})
	}
}

// TestPropertyComposition: Advance(Advance(s, t1), t2) == Advance(s, t2)
// for random and deliberate split points (R31), compared via the encoded
// world. The recovery cases drive towns into insolvency and back, so that
// gold_zero, auto_pause, gold_reserve and auto_resume boundaries (and splits
// at and between them) occur in most cases; minimum counts guard against a
// vacuous pass.
func TestPropertyComposition(t *testing.T) {
	cats := propertyCatalogues(t)
	// The weaver consumes fish: pausing or resuming it changes the houses'
	// fish supply and taxes at once (default 5-minute reserve).
	cats["fish_weaver"] = fishWeaverCatalogue(catalogue(t), catalogue(t).Region.Rules.AutoResumeMs)
	for name, c := range cats {
		// The recovery cases need towns that fall into insolvency again
		// and again; they keep the never-pausable upkeep of the content
		// before it was folded into the prices (legacyUpkeep), the random
		// command cases run on the content as shipped.
		rc := legacyUpkeep(c)
		t.Run(name, func(t *testing.T) {
			for seed := range uint64(propertyCases) {
				p := newPropCase(t, c, 10_000+seed)
				p.run(true)
			}
		})
		t.Run(name+"/recovery", func(t *testing.T) {
			kinds, splitKinds := map[string]int{}, map[string]int{}
			recovered := 0
			for seed := range uint64(propertyCases) {
				p := newPropCase(t, rc, 70_000+seed)
				p.maxPieces = 8
				p.w = p.recoveryWorld()
				p.checkInvariants("initial")
				caseKinds := p.runRecovery()
				for k, n := range caseKinds {
					kinds[k] += n
				}
				for k, n := range p.splitKinds {
					splitKinds[k] += n
				}
				if caseKinds[BoundaryAutoPause] > 0 && caseKinds[BoundaryAutoResume] > 0 {
					recovered++
				}
			}
			t.Logf("boundaries %v; deliberate splits %v; cases with pause and resume: %d", kinds, splitKinds, recovered)
			for _, k := range []string{BoundaryGoldZero, BoundaryAutoPause, BoundaryGoldReserve, BoundaryAutoResume} {
				if kinds[k] < propertyCases/2 {
					t.Errorf("only %d %s boundaries", kinds[k], k)
				}
			}
			for _, k := range []string{BoundaryGoldZero, BoundaryGoldReserve, BoundaryAutoResume, "between"} {
				if splitKinds[k] < propertyCases/10 {
					t.Errorf("only %d splits at %s points", splitKinds[k], k)
				}
			}
			if recovered < propertyCases/3 {
				t.Errorf("only %d of %d cases paused and resumed", recovered, propertyCases)
			}
		})
	}
}

// recoveryWorld is a town that starts insolvent: up to eight houses at
// their floor with fish and clothing in stock (so they grow and pay more
// taxes), a market and several producers with upkeep, and almost no gold.
func (p *propCase) recoveryWorld() *World {
	p.l = NewLedger()
	w := NewWorld(t0.Add(time.Duration(p.rng.IntN(1_000_000)) * time.Millisecond))
	w.Islands = []*Island{islandFromRows("main", townRows()...)}
	free := func(typ string, x, y, rot int) {
		// Only first-tier buildings: the town is a Settler town (the
		// shipped content's tier-2 bakery needs flour and Citizens).
		if def := p.c.BuildingByID[typ]; def == nil || def.Tier != p.c.Tiers[0].ID {
			return
		}
		if err := PlaceFree(w, p.c, PlaceBuilding{IslandID: "main", Type: typ, X: x, Y: y, Rotation: rot}, p.l); err != nil {
			p.fail("recovery %s: %v", typ, err)
		}
	}
	free("trading_post", 1, 0, 0)
	road := []Pos{{6, 3}}
	for x := 2; x <= 28; x++ {
		road = append(road, Pos{x, 4})
	}
	if err := ApplyWithLedger(w, p.c, PlaceRoad{IslandID: "main", Type: "road_dirt", Tiles: road}, p.l); err != nil {
		p.fail("recovery road: %v", err)
	}
	free("market_small", 17, 1, 0)
	type spot struct {
		typ       string
		x, y, rot int
	}
	for _, sp := range []spot{
		{"fisher", 6, 1, 0}, {"weaver_wool", 21, 2, 0}, {"sawmill", 24, 2, 0}, {"sawmill", 26, 2, 0},
		{"sheep_farm", 24, 5, 180}, {"chapel", 19, 5, 180}, {"sawmill", 21, 5, 180}, {"bakery", 17, 5, 180},
	} {
		if p.rng.IntN(4) > 0 {
			free(sp.typ, sp.x, sp.y, sp.rot)
		}
	}
	for i, x := range []int{9, 11, 13, 15, 9, 11, 13, 15}[:4+p.rng.IntN(5)] {
		if i < 4 {
			free("house_settlers", x, 2, 0)
		} else {
			free("house_settlers", x, 5, 180)
		}
	}
	for _, n := range p.c.NeedsByTier[p.c.Tiers[0].ID] {
		for _, g := range n.Goods {
			if err := AddStock(w, p.c, "main", g.Good, Qty(20+p.rng.IntN(150))*1000, p.l); err != nil {
				p.fail("recovery stock: %v", err)
			}
		}
	}
	w.Gold = Qty(p.rng.IntN(40_000))
	return w
}

// runRecovery advances a recovery world in pieces (with composition checks)
// and sometimes demolishes a producer or adds goods, and returns the
// boundary counts by kind.
func (p *propCase) runRecovery() map[string]int {
	kinds := map[string]int{}
	for range 4 + p.rng.IntN(5) {
		switch p.rng.IntN(8) {
		case 0:
			var producers []*Building
			for _, b := range p.w.Islands[0].Buildings {
				if def := p.c.BuildingByID[b.Type]; def.Recipe != nil {
					producers = append(producers, b)
				}
			}
			if len(producers) > 0 {
				p.apply(Demolish{IslandID: "main", BuildingID: producers[p.rng.IntN(len(producers))].ID})
			}
		case 1:
			p.apply(addStockOp{good: "fish", qty: Qty(1+p.rng.IntN(50)) * 1000})
		default:
			d := time.Duration(1+p.rng.IntN(45*60_000)) * time.Millisecond
			for _, b := range p.advance(d, true) {
				if b.Kind != BoundaryAutoResume || b.BuildingID != 0 {
					kinds[b.Kind]++
				}
			}
		}
	}
	return kinds
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

// minimalReserveMs is the smallest valid auto-resume reserve: 0.001 minutes
// (3 decimal places) = 60 ms. A zero reserve is invalid content.
const minimalReserveMs = 60

// fishWeaverCatalogue is the shipped catalogue with the given resume reserve
// (must be > 0) and a weaver that consumes fish: pausing the weaver frees
// fish for the houses, raises taxes and can make it resumable soon after its
// insolvency pause (review rounds 1 and 2).
func fishWeaverCatalogue(base *content.Catalogue, reserveMs int64) *content.Catalogue {
	if reserveMs <= 0 {
		panic("fishWeaverCatalogue: the resume reserve must be > 0 (a zero reserve is invalid content)")
	}
	c := *base
	c.Region.Rules.AutoResumeMs = reserveMs
	weaver := *base.BuildingByID["weaver_wool"]
	rec := *weaver.Recipe
	rec.Inputs = []content.GoodAmount{{Good: "fish", Amount: 1000}}
	weaver.Recipe = &rec
	c.BuildingByID = maps.Clone(base.BuildingByID)
	c.BuildingByID["weaver_wool"] = &weaver
	return &c
}

// TestPropertyTownCompositionMinimalReserve repeats the town composition
// check with the smallest valid resume reserve (60 ms) and the
// fish-consuming weaver, where pauses and resumes follow each other fastest.
func TestPropertyTownCompositionMinimalReserve(t *testing.T) {
	c := fishWeaverCatalogue(varietyCatalogue(t), minimalReserveMs)
	for seed := range uint64(propertyCases / 2) {
		p := newPropCase(t, c, 50_000+seed)
		p.w = p.townWorld()
		p.checkInvariants("initial")
		p.run(true)
	}
}

// TestPropertyPauseResumeInterplay targets insolvency pauses that change
// taxes at once: houses share a fisher's fish with two fish-consuming
// weavers, gold is nearly zero and the resume reserve is the smallest valid
// one (60 ms). Pausing a
// weaver frees fish and raises taxes, resuming it lowers them again; before
// review round 1 this flapped every millisecond until the iteration cap.
// Advances are split at random times and exactly at boundary instants
// (including pauses); every piece must leave a settled world, the split
// result must equal a single Advance and coarse mode is never reached.
func TestPropertyPauseResumeInterplay(t *testing.T) {
	c := fishWeaverCatalogue(legacyUpkeep(catalogue(t)), minimalReserveMs)
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
		free("trading_post", 1, 0, 0)
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

// TestPropertyResumeEligibility (R21, review round 2): full houses get fish
// from a delivery whose rate is close to their demand, an unpaid
// fish-consuming weaver waits for its resume, the fish stock starts at or
// near zero and gold, upkeep and the resume reserve vary. Whether the weaver
// may resume depends on the fish regime; while the fish stock grows or
// shrinks between boundaries, splits at random times and at the deliberate
// split points must give the same world as one Advance.
func TestPropertyResumeEligibility(t *testing.T) {
	base := catalogue(t)
	resumes := 0
	for seed := range uint64(propertyCases) {
		rng := rand.New(rand.NewPCG(80_000+seed, 0x5eed)) // #nosec G404 -- deterministic test data
		c := fishWeaverCatalogue(base, []int64{60_000, 300_000, 900_000}[rng.IntN(3)])
		p := &propCase{t: t, c: c, rng: rng, l: NewLedger(), splitKinds: map[string]int{}, maxPieces: 8}
		w := NewWorld(t0.Add(time.Duration(p.rng.IntN(1_000_000)) * time.Millisecond))
		w.Islands = []*Island{islandFromRows("main", townRows()...)}
		p.w = w
		free := func(typ string, x, y, rot int) int64 {
			id := w.NextBuildingID
			if err := PlaceFree(w, c, PlaceBuilding{IslandID: "main", Type: typ, X: x, Y: y, Rotation: rot}, p.l); err != nil {
				p.fail("%s: %v", typ, err)
			}
			return id
		}
		free("trading_post", 1, 0, 0)
		road := []Pos{{6, 3}}
		for x := 2; x <= 28; x++ {
			road = append(road, Pos{x, 4})
		}
		if err := ApplyWithLedger(w, c, PlaceRoad{IslandID: "main", Type: "road_dirt", Tiles: road}, p.l); err != nil {
			p.fail("road: %v", err)
		}
		free("market_small", 17, 1, 0)
		wv := free("weaver_wool", 21, 2, 0)
		if p.rng.IntN(3) == 0 {
			free("sawmill", 24, 2, 0) // extra upkeep
		}
		var houses []int64
		// Around 64 settlers against about 9 gold/min upkeep, taxes with and
		// without the weaver's share of the fish straddle the upkeep.
		for i, x := range []int{9, 11, 13, 15, 9, 11, 13, 15}[:7+p.rng.IntN(2)] {
			if i < 4 {
				houses = append(houses, free("house_settlers", x, 2, 0))
			} else {
				houses = append(houses, free("house_settlers", x, 5, 180))
			}
		}
		n := Qty(0)
		for _, id := range houses {
			h := w.Islands[0].Building(id).House
			h.Residents = Qty(7+p.rng.IntN(2)) * 1000
			n += h.Residents
		}
		if err := AddStock(w, c, "main", "wool_garments", 200_000, p.l); err != nil {
			p.fail("stock: %v", err)
		}
		if err := AddStock(w, c, "main", "fish", Qty(p.rng.IntN(3))*100, p.l); err != nil {
			p.fail("stock: %v", err)
		}
		// Fish delivery at 90-110 % of the houses' demand for 2 hours,
		// booked as granted so that conservation holds.
		now := w.LastEvaluatedAt.UnixMilli()
		rate := needRate(n, 10) * int64(90+p.rng.IntN(21)) / 100
		seg := TransitSegment{Good: "fish", FromMs: now, ToMs: now + 7_200_000, RateSub: rate}
		w.Islands[0].Building(houses[0]).Transit = []TransitSegment{seg}
		p.l.flow("main", "fish").Granted += seg.RateSub * (seg.ToMs - seg.FromMs)
		b := w.Islands[0].Building(wv)
		w.PauseSeq = 1
		b.Paused, b.PausedReason, b.PauseSeq, b.PausedAtMs = true, PausedReasonUnpaid, 1, now-1
		w.Gold = Qty(p.rng.IntN(30_000))
		if p.rng.IntN(2) == 0 {
			w.Gold = 1_000_000
		}
		p.checkInvariants("initial")
		for range 3 + p.rng.IntN(3) {
			for _, bd := range p.advance(time.Duration(1+p.rng.IntN(40*60_000))*time.Millisecond, true) {
				if bd.Kind == BoundaryAutoResume {
					resumes++
				}
			}
		}
	}
	t.Logf("auto resumes: %d", resumes)
	if resumes < propertyCases/4 {
		t.Errorf("only %d resumes", resumes)
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

// moveWorld runs a random case (alternating random worlds and towns, so that
// houses are moved too) and returns it.
func moveWorld(t *testing.T, c *content.Catalogue, seed uint64) *propCase {
	p := newPropCase(t, c, seed)
	if seed%2 == 1 {
		p.w = p.townWorld()
	}
	p.run(false)
	return p
}

// validMove returns a valid random move of a random building (false when
// none was found).
func (p *propCase) validMove() (MoveBuilding, bool) {
	is := p.w.Islands[0]
	if len(is.Buildings) == 0 {
		return MoveBuilding{}, false
	}
	for range 50 {
		b := is.Buildings[p.rng.IntN(len(is.Buildings))]
		cmd := p.moveTarget(b)
		if Apply(p.w.Clone(), p.c, cmd) == nil {
			return cmd, true
		}
	}
	return MoveBuilding{}, false
}

// TestPropertyMovePreservesState: a valid move keeps the building's ID,
// type, level, pause state, progress, buffer, remaining transit per good and
// house state, the island inventory, gold and NextBuildingID (D-042).
func TestPropertyMovePreservesState(t *testing.T) {
	for name, c := range propertyCatalogues(t) {
		t.Run(name, func(t *testing.T) {
			moved, houses := 0, 0
			for seed := range uint64(propertyCases) {
				p := moveWorld(t, c, 90_000+seed)
				cmd, ok := p.validMove()
				if !ok {
					continue
				}
				is := p.w.Islands[0]
				old := is.Building(cmd.BuildingID).clone()
				now := p.w.LastEvaluatedAt.UnixMilli()
				transit := map[string]int64{}
				for _, g := range transitGoods(old) {
					transit[g] = old.transitFine(g, now)
				}
				gold, goldSub, next := p.w.Gold, p.w.GoldSub, p.w.NextBuildingID
				stock, stockSub := maps.Clone(is.Inventory.Stock), maps.Clone(is.Inventory.StockSub)
				p.apply(cmd)

				b := is.Building(cmd.BuildingID)
				if b == nil || b.X != cmd.X || b.Y != cmd.Y || b.Rotation != cmd.Rotation {
					p.fail("seed %d: move %+v not applied: %+v", seed, cmd, b)
				}
				if b.ID != old.ID || b.Type != old.Type || b.Level != old.Level || b.Paused != old.Paused ||
					b.PausedReason != old.PausedReason || b.PauseSeq != old.PauseSeq || b.PausedAtMs != old.PausedAtMs ||
					b.Progress != old.Progress || !maps.Equal(b.Buffer, old.Buffer) || !maps.Equal(b.BufferSub, old.BufferSub) {
					p.fail("seed %d: state changed by move:\nbefore %+v\nafter  %+v", seed, old, b)
				}
				for _, g := range sortedKeys(transit) {
					if got := b.transitFine(g, now); got != transit[g] {
						p.fail("seed %d: transit of %s %d -> %d", seed, g, transit[g], got)
					}
				}
				if (old.House == nil) != (b.House == nil) || (old.House != nil && *old.House != *b.House) {
					p.fail("seed %d: house %+v -> %+v", seed, old.House, b.House)
				}
				if old.House != nil {
					houses++
				}
				if p.w.Gold != gold || p.w.GoldSub != goldSub || p.w.NextBuildingID != next ||
					!maps.Equal(is.Inventory.Stock, stock) || !maps.Equal(is.Inventory.StockSub, stockSub) {
					p.fail("seed %d: move changed gold, inventory or NextBuildingID", seed)
				}
				moved++
			}
			t.Logf("%d moves, %d of them houses", moved, houses)
			if moved < propertyCases/2 || houses < propertyCases/20 {
				t.Errorf("only %d moves (%d houses) in %d cases", moved, houses, propertyCases)
			}
		})
	}
}

// TestPropertyMoveEqualsPlacement: placing a building at A and moving it to
// B at the same instant yields a world byte-identical to placing it at B
// directly. No field is excluded; the catalogues have no quests, because a
// quest completed by the placement at A stays completed (completion is
// permanent by design).
func TestPropertyMoveEqualsPlacement(t *testing.T) {
	for name, c := range propertyCatalogues(t) {
		c := withoutQuests(c)
		t.Run(name, func(t *testing.T) {
			compared := 0
			for seed := range uint64(propertyCases) {
				p := moveWorld(t, c, 110_000+seed)
				var places []PlaceBuilding
				var typ string
				for i := range 400 {
					if len(places) == 2 {
						break
					}
					if i%40 == 0 && len(places) == 0 {
						// A new type unless one valid position was found.
						typ = p.types[p.rng.IntN(len(p.types))]
					}
					x, y := p.randomPos()
					if p.rng.IntN(2) == 0 {
						if pl, ok := p.placeAtRoadOnce().(PlaceBuilding); ok {
							x, y = pl.X, pl.Y
						}
					}
					cmd := PlaceBuilding{IslandID: "main", Type: typ, X: x, Y: y, Rotation: 90 * p.rng.IntN(4)}
					if Apply(p.w.Clone(), p.c, cmd) == nil {
						places = append(places, cmd)
					}
				}
				if len(places) < 2 {
					continue
				}
				a, bpl := places[0], places[1]
				viaMove := p.w.Clone()
				id := viaMove.NextBuildingID
				if err := Apply(viaMove, p.c, a); err != nil {
					p.fail("seed %d: place A: %v", seed, err)
				}
				if err := Apply(viaMove, p.c, MoveBuilding{IslandID: "main", BuildingID: id, X: bpl.X, Y: bpl.Y, Rotation: bpl.Rotation}); err != nil {
					p.fail("seed %d: move %+v -> %+v: %v", seed, a, bpl, err)
				}
				direct := p.w.Clone()
				if err := Apply(direct, p.c, bpl); err != nil {
					p.fail("seed %d: place B: %v", seed, err)
				}
				if x, y := encode(t, viaMove), encode(t, direct); !bytes.Equal(x, y) {
					p.fail("seed %d: place %+v + move differs from place %+v:\nmove:   %s\ndirect: %s", seed, a, bpl, x, y)
				}
				compared++
			}
			t.Logf("%d comparisons", compared)
			if compared < propertyCases/2 {
				t.Errorf("only %d comparisons in %d cases", compared, propertyCases)
			}
		})
	}
}

// TestPropertyMoveRoundTrip: moving a building to B and back to A at the
// same instant restores the world byte-identically except the regimes
// (Inventory.Starved/Full), which every command clears.
func TestPropertyMoveRoundTrip(t *testing.T) {
	for name, c := range propertyCatalogues(t) {
		t.Run(name, func(t *testing.T) {
			moved := 0
			for seed := range uint64(propertyCases) {
				p := moveWorld(t, c, 130_000+seed)
				cmd, ok := p.validMove()
				if !ok {
					continue
				}
				before := p.w.Clone()
				b := p.w.Islands[0].Building(cmd.BuildingID)
				// An unassigned field stands where no field may be placed
				// (its farm was moved or demolished): it cannot move back.
				if def := p.c.BuildingByID[b.Type]; def != nil && def.Field != nil && b.FarmID == 0 {
					continue
				}
				back := MoveBuilding{IslandID: "main", BuildingID: b.ID, X: b.X, Y: b.Y, Rotation: b.Rotation}
				p.apply(cmd)
				if err := ApplyWithLedger(p.w, p.c, back, p.l); err != nil {
					p.fail("seed %d: move back %+v: %v", seed, back, err)
				}
				p.checkInvariants("after move back")
				clearRegimes(before.Islands[0])
				clearRegimes(p.w.Islands[0])
				if x, y := encode(t, before), encode(t, p.w); !bytes.Equal(x, y) {
					p.fail("seed %d: round trip %+v differs:\nbefore: %s\nafter:  %s", seed, cmd, x, y)
				}
				moved++
			}
			t.Logf("%d round trips", moved)
			if moved < propertyCases/2 {
				t.Errorf("only %d moves in %d cases", moved, propertyCases)
			}
		})
	}
}

// TestPropertyFieldMoveEqualsPlacement (D-049): moving a field to tile T
// yields the same field assignment and farm efficiencies as demolishing
// it and placing a field of its type at T, apart from building IDs and
// the refund.
func TestPropertyFieldMoveEqualsPlacement(t *testing.T) {
	for name, c := range propertyCatalogues(t) {
		c := withoutQuests(c)
		t.Run(name, func(t *testing.T) {
			compared, reassigned := 0, 0
			for seed := range uint64(propertyCases) {
				p := moveWorld(t, c, 210_000+seed)
				p.w.Gold = max(p.w.Gold, 1_000_000_000)
				is := p.w.Islands[0]
				var fields []*Building
				for _, b := range is.Buildings {
					if def := p.c.BuildingByID[b.Type]; def != nil && def.Field != nil {
						fields = append(fields, b)
					}
				}
				if len(fields) == 0 {
					continue
				}
				f := fields[p.rng.IntN(len(fields))]
				var cand []Pos
				for y := f.Y - 6; y <= f.Y+6; y++ {
					for x := f.X - 6; x <= f.X+6; x++ {
						cand = append(cand, Pos{x, y})
					}
				}
				valid := ValidFieldTiles(is, p.c, f.Type, cand)
				if len(valid) == 0 {
					continue
				}
				to := valid[p.rng.IntN(len(valid))]
				viaMove := p.w.Clone()
				if err := Apply(viaMove, p.c, MoveBuilding{IslandID: "main", BuildingID: f.ID, X: to.X, Y: to.Y}); err != nil {
					p.fail("seed %d: move field %d to %v: %v", seed, f.ID, to, err)
				}
				direct := p.w.Clone()
				if err := Apply(direct, p.c, Demolish{IslandID: "main", BuildingID: f.ID}); err != nil {
					p.fail("seed %d: demolish field %d: %v", seed, f.ID, err)
				}
				if err := Apply(direct, p.c, PlaceFields{IslandID: "main", Type: f.Type, Tiles: []Pos{to}}); err != nil {
					p.fail("seed %d: place field at %v: %v", seed, to, err)
				}
				a, b := fieldState(viaMove, p.c), fieldState(direct, p.c)
				if a != b {
					p.fail("seed %d: move field %d to %v:\nmove:   %s\ndirect: %s", seed, f.ID, to, a, b)
				}
				if f.FarmID != viaMove.Islands[0].BuildingAt(p.c, to.X, to.Y).FarmID {
					reassigned++
				}
				compared++
			}
			t.Logf("%d comparisons, %d reassigned", compared, reassigned)
			if compared < propertyCases/4 {
				t.Errorf("only %d comparisons in %d cases", compared, propertyCases)
			}
		})
	}
}

// fieldState describes the fields (position, type, farm) and the farms
// (ID, efficiency) of the first island, independent of field IDs.
func fieldState(w *World, c *content.Catalogue) string {
	var parts []string
	for _, b := range w.Islands[0].Buildings {
		def := c.BuildingByID[b.Type]
		switch {
		case def != nil && def.Field != nil:
			parts = append(parts, fmt.Sprintf("field %s (%d,%d) -> %d", b.Type, b.X, b.Y, b.FarmID))
		case def != nil && def.Fields != nil:
			parts = append(parts, fmt.Sprintf("farm %d %d", b.ID, b.Efficiency))
		}
	}
	slices.Sort(parts)
	return strings.Join(parts, "; ")
}
