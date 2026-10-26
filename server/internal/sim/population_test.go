package sim

import (
	"bytes"
	"errors"
	"maps"
	"testing"
	"time"

	"github.com/ricoberger/new-shores/server/internal/content"
)

// townRows is a 30x14 island: coast at the north-west for warehouse and
// fisher, grass elsewhere.
func townRows() []string {
	rows := make([]string, 14)
	for y := range rows {
		row := make([]byte, 30)
		for x := range row {
			switch {
			case x == 0 || y == 0 || x == 29 || y == 13:
				row[x] = '~'
			case y == 1 && x <= 8:
				// The bay of the Trading Post (1,0) and the fisher (6,1):
				// their front rows stand on water (D-051).
				row[x] = '~'
			default:
				row[x] = '.'
			}
		}
		rows[y] = string(row)
	}
	return rows
}

// Town spots: houses north (y=2) and south (y=5, rotation 180) of the road
// row y=4.
var (
	townHouseNorth = []int{9, 11, 13, 15}
	townHouseSouth = []int{9, 11, 13, 15}
)

// newTown returns a world with a free warehouse at (1,1), a road along y=4
// from x=2 to x=28 plus (6,3) for a fisher at (6,1), the given gold (units)
// and 200 planks.
func newTown(t testing.TB, c *content.Catalogue, gold Qty) *World {
	t.Helper()
	w := NewWorld(t0)
	w.Islands = []*Island{islandFromRows("main", townRows()...)}
	if err := PlaceFree(w, c, PlaceBuilding{IslandID: "main", Type: "trading_post", X: 1, Y: 0}, nil); err != nil {
		t.Fatal(err)
	}
	road := []Pos{{6, 3}}
	for x := 2; x <= 28; x++ {
		road = append(road, Pos{x, 4})
	}
	mustApply(t, w, c, PlaceRoad{IslandID: "main", Type: "road_dirt", Tiles: road})
	if err := AddStock(w, c, "main", "planks", 200_000, nil); err != nil {
		t.Fatal(err)
	}
	w.Gold = gold * 1000
	return w
}

// placeFree places a building without cost and returns its ID.
func placeFree(t testing.TB, w *World, c *content.Catalogue, typ string, x, y, rot int) int64 {
	t.Helper()
	id := w.NextBuildingID
	if err := PlaceFree(w, c, PlaceBuilding{IslandID: "main", Type: typ, X: x, Y: y, Rotation: rot}, nil); err != nil {
		t.Fatalf("place %s at (%d,%d): %v", typ, x, y, err)
	}
	return id
}

// placeHouses places n settler houses (north spots first) and returns their
// IDs.
func placeHouses(t testing.TB, w *World, c *content.Catalogue, n int) []int64 {
	t.Helper()
	var ids []int64
	for i := 0; i < n; i++ {
		if i < 4 {
			ids = append(ids, placeFree(t, w, c, "house_settlers", townHouseNorth[i], 2, 0))
		} else {
			ids = append(ids, placeFree(t, w, c, "house_settlers", townHouseSouth[i-4], 5, 180))
		}
	}
	return ids
}

func addStock(t testing.TB, w *World, c *content.Catalogue, good string, units Qty) {
	t.Helper()
	if err := AddStock(w, c, "main", good, units*1000, nil); err != nil {
		t.Fatal(err)
	}
}

// withPauseCategory returns a catalogue copy in which building id has the
// given pause category.
func withPauseCategory(base *content.Catalogue, id, category string) *content.Catalogue {
	c := *base
	c.BuildingByID = maps.Clone(base.BuildingByID)
	def := *base.BuildingByID[id]
	def.PauseCategory = category
	c.BuildingByID[id] = &def
	return &c
}

func house(w *World, id int64) *HouseState { return w.Islands[0].Building(id).House }

func countKind(bs []Boundary, kind string) int {
	n := 0
	for _, b := range bs {
		if b.Kind == kind {
			n++
		}
	}
	return n
}

// TestResidentsStepAndClamp: at satisfaction 1 a house gains one resident
// per minute (one residents boundary each), stops at max, declines at
// decline_per_min x (threshold - satisfaction) and never leaves floor.
func TestResidentsStepAndClamp(t *testing.T) {
	c := catalogue(t)
	w := newTown(t, c, 100_000)
	h := placeHouses(t, w, c, 1)[0]
	market := placeFree(t, w, c, "market_small", 17, 1, 0)
	addStock(t, w, c, "fish", 100)
	addStock(t, w, c, "wool_garments", 100)

	bs := mustAdvance(t, w, c, 59*time.Second+999*time.Millisecond)
	if hs := house(w, h); hs.Residents != 2000 || hs.Growth != 59_999*1_000_000 || countKind(bs, BoundaryResidents) != 0 {
		t.Fatalf("before 1 min: %+v %v", hs, bs)
	}
	bs = mustAdvance(t, w, c, time.Millisecond)
	if hs := house(w, h); hs.Residents != 3000 || hs.Growth != 0 || countKind(bs, BoundaryResidents) != 1 || !bs[0].At.Equal(t0.Add(time.Minute)) {
		t.Fatalf("at 1 min: %+v %v", hs, bs)
	}
	bs = mustAdvance(t, w, c, 10*time.Minute)
	if hs := house(w, h); hs.Residents != 8000 || hs.Growth != 0 || countKind(bs, BoundaryResidents) != 5 {
		t.Fatalf("at max: %+v %d boundaries", hs, countKind(bs, BoundaryResidents))
	}
	ds := display(t, w, c)
	if b := buildingDisplay(t, ds, h); *b.GrowthRatePerMin != 0 || *b.SatisfactionPermille != 1000 || *b.TaxRatePerMin != 1_600 {
		t.Errorf("full house: rate %d satisfaction %d tax %d", *b.GrowthRatePerMin, *b.SatisfactionPermille, *b.TaxRatePerMin)
	}

	// Without the market satisfaction is 0.7 (still growing, but at max
	// nothing happens); without fish and garments it is 0: decline 0.5 x
	// 0.5 = 0.25 residents/min, one resident every 4 minutes.
	mustApply(t, w, c, Demolish{IslandID: "main", BuildingID: market})
	w.Islands[0].Inventory.setFine("fish", 0)
	w.Islands[0].Inventory.setFine("wool_garments", 0)
	ds = display(t, w, c)
	if b := buildingDisplay(t, ds, h); *b.SatisfactionPermille != 0 || *b.GrowthRatePerMin != -250 {
		t.Fatalf("starving house: satisfaction %d rate %d", *b.SatisfactionPermille, *b.GrowthRatePerMin)
	}
	bs = mustAdvance(t, w, c, 4*time.Minute)
	if hs := house(w, h); hs.Residents != 7000 || hs.Growth != 0 || countKind(bs, BoundaryResidents) != 1 {
		t.Fatalf("after 4 min decline: %+v %v", hs, bs)
	}
	// Decline stops at floor; a long advance adds no boundaries afterwards.
	mustAdvance(t, w, c, 20*time.Minute)
	if hs := house(w, h); hs.Residents != 2000 || hs.Growth != 0 {
		t.Fatalf("after decline: %+v", hs)
	}
	if bs := mustAdvance(t, w, c, 12*time.Hour); countKind(bs, BoundaryResidents) != 0 || house(w, h).Residents != 2000 {
		t.Errorf("at floor: %v residents %d", bs, house(w, h).Residents)
	}
}

// TestBuildingNeedRadiusConnectionPaused: the market fulfils the need when
// its nearest footprint tile is within the radius of the nearest footprint
// tile of the house (D-042), it is connected to a warehouse and not paused.
func TestBuildingNeedRadiusConnectionPaused(t *testing.T) {
	c := withPauseCategory(catalogue(t), "market_small", "public")
	servedBy := func(w *World, h int64) []int64 {
		t.Helper()
		return buildingDisplay(t, display(t, w, c), h).ServedBy
	}
	reason := func(w *World, h int64) string {
		t.Helper()
		for _, n := range buildingDisplay(t, display(t, w, c), h).Needs {
			if n.ID == "settlers_market_small" {
				return n.Reason
			}
		}
		t.Fatal("no market need")
		return ""
	}

	// House footprint x 9..10, y 2..3; market footprint x 23..25, y 1..3:
	// nearest tiles (10,y) and (23,y) at distance 13 > 12.
	w := newTown(t, c, 1_000)
	h := placeHouses(t, w, c, 1)[0]
	m := placeFree(t, w, c, "market_small", 23, 1, 0)
	if got := reason(w, h); got != NeedOutOfRange {
		t.Errorf("distance 13: %s", got)
	}
	if got := servedBy(w, h); len(got) != 0 {
		t.Errorf("served_by out of range: %v", got)
	}
	mustApply(t, w, c, Demolish{IslandID: "main", BuildingID: m})
	// Footprint x 22..24: nearest tile (22,y) at distance exactly 12.
	m = placeFree(t, w, c, "market_small", 22, 1, 0)
	if got := reason(w, h); got != NeedOK {
		t.Errorf("distance 12: %s", got)
	}
	if got := servedBy(w, h); len(got) != 1 || got[0] != m {
		t.Errorf("served_by at distance 12: %v, want [%d]", got, m)
	}
	mustApply(t, w, c, SetPaused{IslandID: "main", BuildingID: m, Paused: true})
	if got := reason(w, h); got != NeedPaused {
		t.Errorf("paused market: %s", got)
	}
	if got := servedBy(w, h); len(got) != 0 {
		t.Errorf("served_by with a paused market: %v", got)
	}
	mustApply(t, w, c, SetPaused{IslandID: "main", BuildingID: m, Paused: false})
	// Cutting the road between the warehouse and the market disconnects it.
	mustApply(t, w, c, DemolishRoad{IslandID: "main", Tiles: []Pos{{18, 4}}})
	if got := reason(w, h); got != NeedNotConnected {
		t.Errorf("unconnected market: %s", got)
	}
	if got := servedBy(w, h); len(got) != 0 {
		t.Errorf("served_by with an unconnected market: %v", got)
	}
	ds := display(t, w, c)
	if b := buildingDisplay(t, ds, m); b.Status != StatusNotConnected {
		t.Errorf("market status %s", b.Status)
	}
	if b := buildingDisplay(t, ds, h); *b.SatisfactionPermille != 0 {
		t.Errorf("satisfaction without market and goods = %d", *b.SatisfactionPermille)
	}
}

// TestEqualShareWithStarvedGood: with fish in stock and bread starved with a
// small arrival rate, both goods are supplied (variety 1); bread is consumed
// at its arrival share and the shortfall is drawn from fish in list order, so
// the food need is fulfilled.
func TestEqualShareWithStarvedGood(t *testing.T) {
	c := varietyCatalogue(t)
	w := newTown(t, c, 1_000)
	houses := placeHouses(t, w, c, 5) // 10 residents
	addStock(t, w, c, "fish", 100)
	is := w.Islands[0]
	now := w.LastEvaluatedAt.UnixMilli()
	// 0.02 bread/min arriving, nothing in stock: starved regime with
	// positive arrivals.
	arrival := needRate(1000, 20) // 20 milli-units/min in sub-milli per ms
	is.Building(houses[0]).Transit = []TransitSegment{{Good: "bread", FromMs: now - 1, ToMs: now + 3_600_000, RateSub: arrival}}
	is.Inventory.Starved = map[string]bool{"bread": true}

	wr, _ := settleWorld(w, c, now)
	r := wr.islands[0]
	gs := r.goodsNeeds["settlers"][0]
	if gs.need.ID != "settlers_food" || gs.m != 2 || gs.variety != 1 || gs.fulfilment != ppm {
		t.Fatalf("food need = m %d variety %d fulfilment %d", gs.m, gs.variety, gs.fulfilment)
	}
	// N = 10: nominal demand fish 0.1/2 = 0.05/min, bread 0.08/2 = 0.04/min.
	// Bread gets its arrivals (0.02/min); the missing 0.02 bread/min are
	// half of the bread demand, i.e. 0.025 fish/min drawn from fish.
	if want := needRate(1000, 20); gs.cons[1] != want {
		t.Errorf("bread consumption %d, want %d", gs.cons[1], want)
	}
	if want := needRate(1000, 50) + needRate(1000, 25); gs.cons[0] != want {
		t.Errorf("fish consumption %d, want %d", gs.cons[0], want)
	}
	ds := display(t, w, c)
	var food NeedDisplay
	for _, n := range buildingDisplay(t, ds, houses[0]).Needs {
		if n.ID == "settlers_food" {
			food = n
		}
	}
	if food.Reason != NeedOK || food.FulfilmentPermille != 1000 || *food.Variety != 1 || food.Goods["fish"] != 75 || food.Goods["bread"] != 20 {
		t.Errorf("food display = %+v", food)
	}
	// Variety +10 %: multiplier 1.1.
	if b := buildingDisplay(t, ds, houses[0]); *b.VarietyMultiplierPermille != 1100 {
		t.Errorf("variety multiplier %d", *b.VarietyMultiplierPermille)
	}

	// Without fish only the starved bread is supplied: fulfilment is the
	// arrival share, 0.02 / 0.08 = 0.25.
	is.Inventory.setFine("fish", 0)
	is.Inventory.Starved = map[string]bool{"bread": true, "fish": true}
	wr, _ = settleWorld(w, c, now)
	gs = wr.islands[0].goodsNeeds["settlers"][0]
	if gs.m != 1 || gs.variety != 0 || gs.fulfilment != 250_000 || gs.cons[0] != 0 {
		t.Errorf("bread only: m %d variety %d fulfilment %d fish %d", gs.m, gs.variety, gs.fulfilment, gs.cons[0])
	}
}

// TestWorkforceFactor: producers of a tier share the island's pool
// proportionally; paused buildings need no workers.
func TestWorkforceFactor(t *testing.T) {
	c := catalogue(t)
	w := newTown(t, c, 100_000)
	placeHouses(t, w, c, 2) // 4 settlers
	fisher := placeFree(t, w, c, "fisher", 6, 1, 0)
	weaver := placeFree(t, w, c, "weaver_wool", 21, 2, 0)
	// Required 4 + 6 = 10, available 4: factor 0.4.
	ds := display(t, w, c)
	wf := ds.Islands[0].Workforce["settlers"]
	if wf.Available != 4_000 || wf.Required != 10_000 || wf.FactorPermille != 400 {
		t.Fatalf("workforce = %+v", wf)
	}
	f := buildingDisplay(t, ds, fisher)
	if f.Status != StatusShortOfWorkers || *f.WorkforceFactorPermille != 400 || f.Rates.Outputs["fish"] != 600 || f.Workforce.Required != 4_000 {
		t.Errorf("fisher = %s factor %d rate %d", f.Status, *f.WorkforceFactorPermille, f.Rates.Outputs["fish"])
	}
	// Pausing the weaver leaves 4 required: factor 1.
	mustApply(t, w, c, SetPaused{IslandID: "main", BuildingID: weaver, Paused: true})
	ds = display(t, w, c)
	if f := buildingDisplay(t, ds, fisher); f.Status != StatusOK || *f.WorkforceFactorPermille != 1000 || f.Rates.Outputs["fish"] != 1500 {
		t.Errorf("fisher after pausing weaver = %s factor %d", f.Status, *f.WorkforceFactorPermille)
	}
	if wf := ds.Islands[0].Workforce["settlers"]; wf.Required != 4_000 || wf.FactorPermille != 1000 {
		t.Errorf("workforce = %+v", wf)
	}
}

// TestProducerStatusPrecedence: short_of_workers ranks below throttled and
// above low_efficiency (MECHANICS §14).
func TestProducerStatusPrecedence(t *testing.T) {
	is := &Island{}
	def := &content.Building{Recipe: &content.Recipe{}}
	p := &producer{b: &Building{Efficiency: 500}, def: def, connected: true, throughput: 900, workforce: 500}
	for _, want := range []string{StatusThrottled, StatusShortOfWorkers, StatusLowEfficiency, StatusOK} {
		if got := producerStatus(is, p); got != want {
			t.Errorf("status = %s, want %s", got, want)
		}
		switch want {
		case StatusThrottled:
			p.throughput = 1000
		case StatusShortOfWorkers:
			p.workforce = 1000
		case StatusLowEfficiency:
			p.b.Efficiency = 1000
		}
	}
}

// TestSetPausedRules (R22): pausing needs a pause category other than
// never; resuming works for every paused building.
func TestSetPausedRules(t *testing.T) {
	c := catalogue(t)
	w := newTown(t, c, 1_000)
	h := placeHouses(t, w, c, 1)[0]
	m := placeFree(t, w, c, "market_small", 17, 1, 0)
	f := placeFree(t, w, c, "fisher", 6, 1, 0)
	for _, id := range []int64{1, h, m} {
		for _, paused := range []bool{true, false} {
			before := encode(t, w)
			if err := Apply(w, c, SetPaused{IslandID: "main", BuildingID: id, Paused: paused}); !errors.Is(err, ErrNotPausable) {
				t.Errorf("SetPaused(%d, %v) = %v", id, paused, err)
			}
			if !bytes.Equal(before, encode(t, w)) {
				t.Error("world changed on error")
			}
		}
	}
	b := w.Islands[0].Building(f)
	b.Paused, b.PausedReason, b.PauseSeq = true, PausedReasonUnpaid, 7
	mustApply(t, w, c, SetPaused{IslandID: "main", BuildingID: f, Paused: true})
	if b.PausedReason != PausedReasonPlayer || b.PauseSeq != 0 {
		t.Errorf("player pause of an unpaid building = %+v", b)
	}
	b.PausedReason, b.PauseSeq = PausedReasonUnpaid, 7
	mustApply(t, w, c, SetPaused{IslandID: "main", BuildingID: f, Paused: false})
	if b.Paused || b.PausedReason != "" || b.PauseSeq != 0 {
		t.Errorf("resumed = %+v", b)
	}
}

// TestGrantWorkforce (R28a): a seed grant raises the workforce pool and the
// factor but not population, unlock progress, taxes or consumption; it
// survives Clone and Encode/Decode and is validated.
func TestGrantWorkforce(t *testing.T) {
	c := catalogue(t)
	w := newTown(t, c, 1_000)
	h := placeHouses(t, w, c, 1)[0] // 2 settlers
	placeFree(t, w, c, "market_small", 17, 1, 0)
	fisher := placeFree(t, w, c, "fisher", 6, 1, 0)
	placeFree(t, w, c, "weaver_wool", 21, 2, 0) // 4 + 6 required
	addStock(t, w, c, "fish", 50)
	before := display(t, w, c)
	if wf := before.Islands[0].Workforce["settlers"]; wf.FactorPermille != 200 {
		t.Fatalf("workforce before grant = %+v", wf)
	}

	for _, bad := range []struct {
		tier string
		qty  Qty
	}{{"peasants", 1000}, {"settlers", -1000}, {"settlers", 1500}} {
		enc := encode(t, w)
		if err := GrantWorkforce(w, c, "main", bad.tier, bad.qty); !errors.Is(err, ErrInvalidCommand) {
			t.Errorf("GrantWorkforce(%s, %d) = %v", bad.tier, bad.qty, err)
		}
		if !bytes.Equal(enc, encode(t, w)) {
			t.Error("world changed on error")
		}
	}
	if err := GrantWorkforce(w, c, "nowhere", "settlers", 1000); !errors.Is(err, ErrUnknownIsland) {
		t.Errorf("unknown island: %v", err)
	}
	if err := GrantWorkforce(w, c, "main", "settlers", 8_000); err != nil {
		t.Fatal(err)
	}

	after := display(t, w, c)
	wf := after.Islands[0].Workforce["settlers"]
	if wf.Available != 10_000 || wf.Required != 10_000 || wf.FactorPermille != 1000 {
		t.Errorf("workforce after grant = %+v", wf)
	}
	if f := buildingDisplay(t, after, fisher); *f.WorkforceFactorPermille != 1000 || f.Status != StatusOK {
		t.Errorf("fisher = %s %d", f.Status, *f.WorkforceFactorPermille)
	}
	if after.Islands[0].Population["settlers"] != 2_000 || after.Tiers[1].Population["settlers"].Have != 2_000 {
		t.Errorf("population %v, unlock progress %+v", after.Islands[0].Population, after.Tiers[1].Population)
	}
	if after.TaxRatePerMin != before.TaxRatePerMin {
		t.Errorf("tax %d -> %d", before.TaxRatePerMin, after.TaxRatePerMin)
	}
	hb, ha := buildingDisplay(t, before, h), buildingDisplay(t, after, h)
	if hb.Needs[0].Goods["fish"] != ha.Needs[0].Goods["fish"] || *ha.TaxRatePerMin != *hb.TaxRatePerMin {
		t.Errorf("house consumption/tax changed: %+v -> %+v", hb.Needs[0], ha.Needs[0])
	}

	// Clone and envelope round trip.
	cw := w.Clone()
	cw.Islands[0].WorkforceGrant["settlers"] = 1_000
	if w.Islands[0].WorkforceGrant["settlers"] != 8_000 {
		t.Error("clone shares the grant map")
	}
	data := encode(t, w)
	w2, _, _, err := Decode(data, nil)
	if err != nil {
		t.Fatal(err)
	}
	if w2.Islands[0].WorkforceGrant["settlers"] != 8_000 || !bytes.Equal(data, encode(t, w2)) {
		t.Error("grant not round-tripped")
	}
}

// TestShortfallDrawsSlackOfStarvedGood (review round 1): both foods starved
// with arrivals, fish 0.01/min (below its 0.05 demand) and bread 0.06/min
// (above its 0.04 demand). The fish shortfall is drawn from the excess bread
// arrivals: fulfilment = 0.01/0.1 + 0.06/0.08 = 0.85, the regimes are
// stable and a split Advance equals a single one.
func TestShortfallDrawsSlackOfStarvedGood(t *testing.T) {
	c := varietyCatalogue(t)
	w := newTown(t, c, 1_000)
	hs := placeHouses(t, w, c, 5) // 10 settlers
	is := w.Islands[0]
	now := w.LastEvaluatedAt.UnixMilli()
	is.Building(hs[0]).Transit = []TransitSegment{
		{Good: "fish", FromMs: now - 1, ToMs: now + 3_600_000, RateSub: needRate(1000, 10)},
		{Good: "bread", FromMs: now - 1, ToMs: now + 3_600_000, RateSub: needRate(1000, 60)},
	}
	is.Inventory.Starved = map[string]bool{"fish": true, "bread": true}
	wr, _ := settleWorld(w, c, now)
	gs := wr.islands[0].goodsNeeds["settlers"][0]
	if gs.fulfilment != 850_000 || gs.cons[0] != needRate(1000, 10) || gs.cons[1] != needRate(1000, 60) {
		t.Errorf("fulfilment %d consumption %v", gs.fulfilment, gs.cons)
	}
	if !is.Inventory.Starved["fish"] || !is.Inventory.Starved["bread"] {
		t.Errorf("regimes = %v", is.Inventory.Starved)
	}
	// Settling again changes nothing.
	before := encode(t, w)
	settleWorld(w, c, now)
	if !bytes.Equal(before, encode(t, w)) {
		t.Error("settle is not idempotent")
	}
	single, split := w.Clone(), w.Clone()
	mustAdvance(t, single, c, time.Minute)
	mustAdvance(t, split, c, 30*time.Second)
	mustAdvance(t, split, c, 30*time.Second)
	if !bytes.Equal(encode(t, single), encode(t, split)) {
		t.Error("composition violated")
	}

	// With 0.08 bread/min the bread slack covers the fish shortfall
	// (0.04 fish = 0.032 bread): bread leaves the starved regime and the
	// need is fulfilled.
	is.Building(hs[0]).Transit[1].RateSub = needRate(1000, 80)
	wr, _ = settleWorld(w, c, now)
	gs = wr.islands[0].goodsNeeds["settlers"][0]
	if is.Inventory.Starved["bread"] || gs.fulfilment != ppm || gs.cons[1] != needRate(1000, 72) {
		t.Errorf("bread %v fulfilment %d consumption %v", is.Inventory.Starved, gs.fulfilment, gs.cons)
	}
}

// checkUnconnectedHouse asserts the effects of a house without a road path
// to a warehouse: status not_connected, every need at 0 with reason
// not_connected, no attributed consumption, satisfaction and tax 0, while
// its residents count for population and workforce.
func checkUnconnectedHouse(t *testing.T, w *World, c *content.Catalogue, h int64) {
	t.Helper()
	ds := display(t, w, c)
	b := buildingDisplay(t, ds, h)
	if b.Status != StatusNotConnected || *b.SatisfactionPermille != 0 || *b.TaxRatePerMin != 0 {
		t.Errorf("house = %s satisfaction %d tax %d", b.Status, *b.SatisfactionPermille, *b.TaxRatePerMin)
	}
	if len(b.Needs) == 0 {
		t.Fatal("no needs displayed")
	}
	for _, n := range b.Needs {
		if n.FulfilmentPermille != 0 || n.Reason != NeedNotConnected {
			t.Errorf("need %s = %d %s", n.ID, n.FulfilmentPermille, n.Reason)
		}
		for g, rate := range n.Goods {
			if rate != 0 {
				t.Errorf("need %s attributes %d/min of %s", n.ID, rate, g)
			}
		}
	}
	is := ds.Islands[0]
	if is.Inventory["fish"].RatePerMin != 0 {
		t.Errorf("fish consumed at %d/min", is.Inventory["fish"].RatePerMin)
	}
	res := *b.Residents
	if is.Population["settlers"] != res || is.Workforce["settlers"].Available != res {
		t.Errorf("population %d workforce %d, want %d", is.Population["settlers"], is.Workforce["settlers"].Available, res)
	}
}

// TestHouseWithoutRoad: a house placed without a road keeps its floor
// residents but receives no goods and no building needs.
func TestHouseWithoutRoad(t *testing.T) {
	c := catalogue(t)
	w := newTown(t, c, 100_000)
	h := w.NextBuildingID
	mustApply(t, w, c, PlaceBuilding{IslandID: "main", Type: "house_settlers", X: 9, Y: 7})
	placeFree(t, w, c, "market_small", 17, 1, 0)
	addStock(t, w, c, "fish", 100)
	addStock(t, w, c, "wool_garments", 100)
	checkUnconnectedHouse(t, w, c, h)
	mustAdvance(t, w, c, 12*time.Hour)
	if hs := house(w, h); hs.Residents != 2000 || hs.Growth != 0 {
		t.Errorf("house after 12 h = %+v", hs)
	}
	if got := w.Islands[0].Inventory.Stock["fish"]; got != 100_000 {
		t.Errorf("fish = %d, want untouched", got)
	}
	checkUnconnectedHouse(t, w, c, h)
}

// TestHouseOnIsolatedRoadStub: a house next to a road that does not lead to
// a warehouse is not connected; linking the stub connects it (goods and
// building needs evaluated normally), demolishing the link disconnects it
// again and it declines to the floor.
func TestHouseOnIsolatedRoadStub(t *testing.T) {
	c := catalogue(t)
	w := newTown(t, c, 100_000)
	// House x 9..10, y 7..8; stub (11,7) on its east edge; link (11,5..6)
	// to the main road at (11,4).
	mustApply(t, w, c, PlaceRoad{IslandID: "main", Type: "road_dirt", Tiles: []Pos{{11, 7}}})
	h := placeFree(t, w, c, "house_settlers", 9, 7, 0)
	placeFree(t, w, c, "market_small", 17, 1, 0)
	addStock(t, w, c, "fish", 100)
	addStock(t, w, c, "wool_garments", 100)
	checkUnconnectedHouse(t, w, c, h)

	link := []Pos{{11, 5}, {11, 6}}
	mustApply(t, w, c, PlaceRoad{IslandID: "main", Type: "road_dirt", Tiles: link})
	ds := display(t, w, c)
	b := buildingDisplay(t, ds, h)
	if b.Status == StatusNotConnected || *b.SatisfactionPermille != 1000 || *b.TaxRatePerMin == 0 {
		t.Errorf("linked house = %s satisfaction %d tax %d", b.Status, *b.SatisfactionPermille, *b.TaxRatePerMin)
	}
	for _, n := range b.Needs {
		if n.Reason != NeedOK {
			t.Errorf("need %s reason %s", n.ID, n.Reason)
		}
	}
	if ds.Islands[0].Inventory["fish"].RatePerMin >= 0 {
		t.Errorf("fish not consumed: %d/min", ds.Islands[0].Inventory["fish"].RatePerMin)
	}
	mustAdvance(t, w, c, 10*time.Minute)
	grown := house(w, h).Residents
	if grown <= 2000 {
		t.Fatalf("linked house did not grow: %d", grown)
	}

	mustApply(t, w, c, DemolishRoad{IslandID: "main", Tiles: []Pos{{11, 5}}})
	checkUnconnectedHouse(t, w, c, h)
	if got := *buildingDisplay(t, display(t, w, c), h).GrowthRatePerMin; got >= 0 {
		t.Errorf("unconnected house growth rate %d, want decline", got)
	}
	mustAdvance(t, w, c, 12*time.Hour)
	if hs := house(w, h); hs.Residents != 2000 || hs.Growth != 0 {
		t.Errorf("after decline = %+v, want floor", hs)
	}
}
