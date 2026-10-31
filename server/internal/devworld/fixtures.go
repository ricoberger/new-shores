package devworld

import (
	"errors"
	"fmt"
	"slices"
	"time"

	"github.com/ricoberger/new-shores/server/internal/content"
	"github.com/ricoberger/new-shores/server/internal/sim"
	"github.com/ricoberger/new-shores/server/internal/sim/archipelago"
)

// Dev fixtures: worlds the dev server's reset endpoint (POST
// /api/v1/dev/reset, --dev only) seeds for `make shots`, so that no shot
// depends on what an earlier one left in the shared in-memory world. Each
// fixture is the seeded archipelago (the server's --seed, DevSeed by
// default) plus a layout replayed through sim.Apply over a short
// world-time history that ends at now; the player was last seen at now (no
// "while you were away" summary). Sites are found programmatically on the
// generated islands (the real placement check), so every fixture works on
// any seed (citizens: any seed whose home island has the wheat fertility):
//
//   - seafaring: the start state as New builds it (D-051): no island
//     settled, the start ship at sea with the starting stock.
//   - default: the home candidate (the archipelago's first island)
//     founded from the start ship at its roomiest Trading Post site; the
//     sloop idle there.
//   - town: default plus FixtureGold, a street inland from the Trading
//     Post, a connected lumberjack with its 24 tree plots painted in one
//     place_fields drag (D-059) and a sawmill, four settler houses (one
//     house and the sawmill moved once), the quests that layout completes
//     claimed, and a sheep farm with its three 3x3 pastures painted in
//     one place_fields drag (D-054).
//   - settled: town plus the citizens tier (granted; the shipyard is tier
//     2, D-056), a shipyard on the coast, a second sloop (ship 2),
//     the nearest habitable island founded by it (Trading Post, street,
//     two houses, a fisher) and ship 2 sailing the route "Fish home"; the
//     start sloop (ship 1) idle at the home island.
//   - citizens: town with the citizens tier unlocked and a wheat farm
//     without fields on the home island, at a site where its 140 wheat
//     fields fit in one drag, with the gold and materials for them (the
//     field painting shots). A seed whose home island lacks the wheat
//     fertility is an error (DevSeed has it).
//   - merchants: town plus the citizens and merchants tiers (granted),
//     the services ladder up to the church with the market at level 2,
//     four Merchant houses (seeded: houses of a later tier only appear by
//     upgrading), a butcher, a pastry kitchen and a shipyard with a brig;
//     the brig founds the nearest island with a clay deposit (Trading
//     Post, street, clay pit on the slot, brickworks) and sails the route
//     "Bricks home". A seed without a clay deposit is an error (every
//     seed of the shipped content has one, DevSeed included).
//   - patricians: merchants plus the patricians tier (granted), the
//     services ladder to the cathedral with the market at level 3, two
//     Merchant houses and a Patrician house (seeded), the roast-beef chain
//     on the home island (cattle farm with its five pastures, salt pans,
//     slaughterhouse) and a galleon that founds the nearest island with a
//     quartz deposit (Trading Post, street, lumberjack with its tree
//     plots, charcoal burner, quartz quarry on the slot, glass smelter)
//     and sails the route "Glass home". A seed without a quartz deposit
//     is an error (every seed of the shipped content has two or more,
//     DevSeed included).
//   - played: the Patricians reference game replayed (played.go).
const (
	FixtureDefault    = "default"
	FixtureSeafaring  = "seafaring"
	FixtureTown       = "town"
	FixtureSettled    = "settled"
	FixtureCitizens   = "citizens"
	FixtureMerchants  = "merchants"
	FixturePatricians = "patricians"
)

// ErrUnknownFixture reports a fixture name that NewFixture does not know.
var ErrUnknownFixture = errors.New("unknown dev fixture")

// ErrFixtureSeed reports a fixture that cannot be built on the seed's
// archipelago (citizens: no wheat at home; merchants: no clay deposit;
// patricians: no quartz deposit).
var ErrFixtureSeed = errors.New("not available on this seed")

// Fixtures lists the fixture names.
func Fixtures() []string {
	return []string{FixtureDefault, FixtureSeafaring, FixtureTown, FixtureSettled, FixtureCitizens, FixtureMerchants, FixturePatricians, FixturePlayed}
}

// History of the fixtures before now (world time): long enough for the
// voyages from the spawn and between islands, the planks, the sloop and
// the first fish the layouts need.
const (
	foundHistory     = 20 * time.Minute
	townHistory      = foundHistory + 12*time.Minute
	settledHistory   = townHistory + 60*time.Minute
	citizensHistory  = townHistory + 2*time.Minute
	merchantsHistory = townHistory + 60*time.Minute
	// patriciansHistory: the galleon's 10 min build and a longer voyage.
	patriciansHistory = townHistory + 90*time.Minute
)

// FixtureGold (milli-gold) is granted to the town and settled fixtures, so
// that a shot session on them never runs into insolvency while it adds
// upkeep (a shipyard, the sloop, island 2).
const FixtureGold = 3_000_000

// NewFixture builds the named dev fixture on the archipelago of seed
// evaluated at now (truncated to milliseconds); "" is the default. The
// played fixture needs NewFixtureWith.
func NewFixture(c *content.Catalogue, name string, seed uint64, now time.Time) (*sim.World, error) {
	return NewFixtureWith(c, name, seed, now, Options{})
}

// NewFixtureWith is NewFixture with the options of the played fixture.
func NewFixtureWith(c *content.Catalogue, name string, seed uint64, now time.Time, opts Options) (*sim.World, error) {
	now = now.UTC().Truncate(time.Millisecond)
	switch name {
	case FixturePlayed:
		return played(c, seed, now, opts)
	case FixtureSeafaring:
		return New(c, seed, now)
	case "", FixtureDefault:
		return replay(c, seed, now, foundHistory, foundHome)
	case FixtureTown:
		return replay(c, seed, now, townHistory, func(f *fixture) {
			foundHome(f)
			town(f)
		})
	case FixtureSettled:
		return replay(c, seed, now, settledHistory, func(f *fixture) {
			foundHome(f)
			town(f)
			settle(f)
		})
	case FixtureCitizens:
		return replay(c, seed, now, citizensHistory, func(f *fixture) {
			foundHome(f)
			town(f)
			citizens(f)
		})
	case FixtureMerchants:
		return replay(c, seed, now, merchantsHistory, func(f *fixture) {
			foundHome(f)
			town(f)
			merchants(f)
		})
	case FixturePatricians:
		return replay(c, seed, now, patriciansHistory, func(f *fixture) {
			foundHome(f)
			town(f)
			patricians(f)
		})
	}
	return nil, fmt.Errorf("%w %q (known: %v)", ErrUnknownFixture, name, Fixtures())
}

// replay builds the archipelago at now − history, runs build on it and
// advances to now; the player was last seen at now.
func replay(c *content.Catalogue, seed uint64, now time.Time, history time.Duration, build func(*fixture)) (*sim.World, error) {
	w, err := New(c, seed, now.Add(-history))
	if err != nil {
		return nil, err
	}
	f := &fixture{c: c, w: w}
	build(f)
	if f.err == nil && f.w.LastEvaluatedAt.After(now) {
		f.err = fmt.Errorf("fixture history %s too short (ends at %s)", history, f.w.LastEvaluatedAt.Sub(now.Add(-history)))
	}
	if f.err == nil {
		f.advance(now.Sub(f.w.LastEvaluatedAt))
	}
	if f.err != nil {
		return nil, fmt.Errorf("dev fixture: %w", f.err)
	}
	sim.MarkSeen(f.w)
	f.w.PendingSummary = nil
	return f.w, nil
}

// foundHome sails the start ship to the home candidate and founds it at
// its roomiest Trading Post site; the starting stock is unloaded into the
// Trading Post.
func foundHome(f *fixture) {
	if f.err != nil {
		return
	}
	if len(f.w.Ships) == 0 {
		f.err = errors.New("no start ship")
		return
	}
	f.found(f.w.Ships[0].ID, f.home())
}

// found sails an idle ship to the island, waits for its arrival and
// founds the island at its roomiest Trading Post site.
func (f *fixture) found(ship int64, island string) {
	f.apply(sim.SailShip{ShipID: ship, ToIslandID: island})
	f.arrive(ship)
	if f.err != nil {
		return
	}
	site, ok := f.tradingPostSite(island)
	if !ok {
		f.err = fmt.Errorf("no trading post site on %s", island)
		return
	}
	f.apply(sim.FoundIsland{ShipID: ship, IslandID: island, BuildingType: tradingPostType(f.c), X: site.X, Y: site.Y, Rotation: site.Rotation})
}

// arrive advances to the arrival of a ship on a leg.
func (f *fixture) arrive(ship int64) {
	if f.err != nil {
		return
	}
	s := f.ship(ship)
	if s == nil || s.Leg == nil {
		f.err = fmt.Errorf("ship %d is not sailing", ship)
		return
	}
	f.advance(time.Duration(s.Leg.ArriveAtMs-f.w.LastEvaluatedAt.UnixMilli()) * time.Millisecond)
}

// town builds the town layout on the home island.
func town(f *fixture) {
	if f.err != nil {
		return
	}
	f.w.Gold += FixtureGold
	home := f.home()
	f.street(home, 14)
	f.placeFarm(home, "lumberjack", f.forestAnchor(home, f.streetEnd(home)))
	f.placeNear(home, "house_settlers", f.streetEnd(home))
	f.placeNear(home, "sawmill", f.streetEnd(home))
	f.advance(90 * time.Second)
	f.moveOnce(home, "house_settlers")
	f.moveOnce(home, "sawmill")
	f.advance(2 * time.Minute)
	for range 3 {
		f.placeNear(home, "house_settlers", f.streetEnd(home))
	}
	f.advance(10 * time.Second)
	// The quests this layout completed (the first three of the content).
	for _, q := range f.c.Quests {
		if st, ok := f.w.Quests[q.ID]; f.err == nil && ok && !st.Claimed && sim.QuestCompleted(f.w, q.ID) {
			f.apply(sim.ClaimQuest{QuestID: q.ID, IslandID: home})
		}
	}
	f.placeNearThen(home, "sheep_farm", f.streetEnd(home), func(farm int64) bool {
		return f.paintFields(home, farm, "pasture", f.requiredFields("sheep_farm"))
	})
	f.advance(time.Minute)
}

// settle builds a shipyard and a sloop and settles the nearest habitable
// island with it. The shipyard is a tier-2 building (D-056), so the
// citizens tier is granted first, as in the citizens fixture.
func settle(f *fixture) {
	if f.err != nil {
		return
	}
	if !slices.Contains(f.w.UnlockedTiers, citizensTier) {
		f.w.UnlockedTiers = append(f.w.UnlockedTiers, citizensTier)
	}
	home := f.home()
	yard := f.placeNear(home, "shipyard", f.streetEnd(home))
	if f.err != nil {
		return
	}
	f.apply(sim.OrderShip{IslandID: home, BuildingID: yard, ShipType: "sloop"})
	f.advance(2*time.Minute + 10*time.Second)
	if f.err == nil && (len(f.w.Ships) != 2 || f.w.Ships[1].State != sim.ShipIdle) {
		f.err = errors.New("the sloop is not idle after its build time")
		return
	}
	if f.err != nil {
		return
	}
	ship := f.w.Ships[len(f.w.Ships)-1].ID
	second := f.neighbour(home)
	f.apply(sim.ManualShipment{ShipID: ship, ToIslandID: second, Cargo: []sim.CargoAmount{{Good: "planks", Amount: 60_000}}})
	f.arrive(ship)
	if f.err != nil {
		return
	}
	site, ok := f.tradingPostSite(second)
	if !ok {
		f.err = fmt.Errorf("no trading post site on %s", second)
		return
	}
	f.apply(sim.FoundIsland{ShipID: ship, IslandID: second, BuildingType: tradingPostType(f.c), X: site.X, Y: site.Y, Rotation: site.Rotation})
	f.street(second, 8)
	f.placeNear(second, "house_settlers", f.streetEnd(second))
	f.placeNear(second, "house_settlers", f.streetEnd(second))
	f.placeNear(second, "fisher", f.tradingPostCentre(second))
	f.advance(2 * time.Minute)
	f.apply(sim.CreateRoute{Name: "Fish home", Stops: []sim.Stop{
		{IslandID: second, Load: []sim.LoadRule{{Good: "fish", MaxAmount: 50_000}}},
		{IslandID: home, Unload: []string{"fish"}},
	}})
	if f.err != nil {
		return
	}
	route := f.w.Routes[len(f.w.Routes)-1].ID
	f.apply(sim.AssignShip{ShipID: ship, RouteID: route})
	f.advance(time.Minute)
}

// The citizens fixture's tier and farm.
const (
	citizensTier = "citizens"
	citizensFarm = "wheat_farm"
)

// citizens unlocks the citizens tier (granted, like the fixture gold: the
// town is far from 120 settlers) and places a wheat farm without fields
// near the street, at the nearest site where a trial drag places all its
// fields (the trial is not kept). The farm's materials the town lacks are
// granted first; the fields cost gold only (FixtureGold).
func citizens(f *fixture) {
	if f.err != nil {
		return
	}
	if !slices.Contains(f.w.UnlockedTiers, citizensTier) {
		f.w.UnlockedTiers = append(f.w.UnlockedTiers, citizensTier)
	}
	home := f.home()
	def := f.c.BuildingByID[citizensFarm]
	if def == nil || def.Fields == nil {
		f.err = fmt.Errorf("no %s with fields in the content", citizensFarm)
		return
	}
	inv := &f.w.Island(home).Inventory
	if inv.Stock == nil {
		inv.Stock = map[string]sim.Qty{}
	}
	for _, m := range def.Cost.Materials {
		inv.Stock[m.Good] = max(inv.Stock[m.Good], m.Amount)
	}
	if fert := def.WorkArea; fert != nil && fert.Fertility != "" && !slices.Contains(f.w.Island(home).Fertilities, fert.Fertility) {
		f.err = fmt.Errorf("%w: the %s fixture needs a home island with the %s fertility for its %s, but seed %d's home island %s has %v; use a seed whose home island grows %s (the dev seed %d does)",
			ErrFixtureSeed, FixtureCitizens, fert.Fertility, citizensFarm, f.w.Seed, home, f.w.Island(home).Fertilities, fert.Fertility, DevSeed)
		return
	}
	n := f.requiredFields(citizensFarm)
	f.placeNearThen(home, citizensFarm, f.fieldAnchor(home, f.streetEnd(home), def), func(farm int64) bool {
		w, placed := f.fieldDrag(home, farm, def.Fields.Type)
		return w != nil && placed == n
	})
	f.advance(time.Minute)
}

// The merchants fixture's tier, house, ship and deposit.
const (
	merchantsTier    = "merchants"
	merchantsHouse   = "house_merchants"
	merchantsShip    = "brig"
	merchantsDeposit = "clay"
	// merchantsGold (milli-gold) is granted on top of FixtureGold.
	merchantsGold = 5_000_000
)

// merchants unlocks the citizens and merchants tiers (granted, like the
// gold), builds the services up to the church and four seeded Merchant
// houses on the home island, a butcher and a pastry kitchen, and a
// shipyard (placed first) whose brig founds the nearest island with a
// clay deposit and then sails bricks home. Every charged placement gets its cost granted
// first, and merchantsGold covers the larger upkeep (services, workshops,
// the brig) for well over an hour.
func merchants(f *fixture) {
	if f.err != nil {
		return
	}
	f.w.Gold += merchantsGold
	for _, tier := range []string{citizensTier, merchantsTier} {
		if !slices.Contains(f.w.UnlockedTiers, tier) {
			f.w.UnlockedTiers = append(f.w.UnlockedTiers, tier)
		}
	}
	home := f.home()
	deposit := f.nearestWithDeposit(home, merchantsDeposit)
	if deposit == "" {
		f.err = fmt.Errorf("%w: the %s fixture needs an island with a %s deposit, but seed %d has none; use a seed with one (the dev seed %d has)",
			ErrFixtureSeed, FixtureMerchants, merchantsDeposit, f.w.Seed, DevSeed)
		return
	}
	// The shipyard first: it needs a coast site a road reaches, which the
	// town's later buildings could close off.
	yard := f.placePaid(home, "shipyard", f.streetEnd(home))
	market := f.placePaid(home, "market", f.streetEnd(home))
	for _, typ := range []string{"chapel", "tavern", "school", "church", "city_guard", "fire_station"} {
		f.placePaid(home, typ, f.streetEnd(home))
	}
	if f.err == nil {
		f.grant(home, f.c.BuildingByID["market"].LevelCost(2))
		f.apply(sim.UpgradeBuilding{IslandID: home, BuildingID: market})
	}
	f.seeded = true
	for range 4 {
		f.placeNear(home, merchantsHouse, f.streetEnd(home))
	}
	f.seeded = false
	for _, typ := range []string{"butcher", "pastry_kitchen"} {
		f.placePaid(home, typ, f.streetEnd(home))
	}
	if f.err != nil {
		return
	}
	brig := f.c.ShipByID[merchantsShip]
	f.grant(home, &brig.Cost)
	f.apply(sim.OrderShip{IslandID: home, BuildingID: yard, ShipType: merchantsShip})
	f.advance(time.Duration(brig.BuildMs)*time.Millisecond + 10*time.Second)
	if f.err == nil && (len(f.w.Ships) != 2 || f.w.Ships[1].Type != merchantsShip || f.w.Ships[1].State != sim.ShipIdle) {
		f.err = errors.New("the brig is not idle after its build time")
	}
	if f.err != nil {
		return
	}
	ship := f.w.Ships[1].ID
	f.grant(home, &content.Cost{Materials: []content.GoodAmount{{Good: "planks", Amount: 60_000}}})
	f.apply(sim.ManualShipment{ShipID: ship, ToIslandID: deposit, Cargo: []sim.CargoAmount{{Good: "planks", Amount: 60_000}}})
	f.arrive(ship)
	if f.err != nil {
		return
	}
	site, ok := f.tradingPostSite(deposit)
	if !ok {
		f.err = fmt.Errorf("no trading post site on %s", deposit)
		return
	}
	f.apply(sim.FoundIsland{ShipID: ship, IslandID: deposit, BuildingType: tradingPostType(f.c), X: site.X, Y: site.Y, Rotation: site.Rotation})
	f.street(deposit, 8)
	f.placePaid(deposit, "clay_pit", f.depositTile(deposit, merchantsDeposit))
	f.placePaid(deposit, "brickworks", f.streetEnd(deposit))
	f.advance(time.Minute)
	f.apply(sim.CreateRoute{Name: "Bricks home", Stops: []sim.Stop{
		{IslandID: deposit, Load: []sim.LoadRule{{Good: "bricks", MaxAmount: 50_000}}},
		{IslandID: home, Unload: []string{"bricks"}},
	}})
	if f.err != nil {
		return
	}
	f.apply(sim.AssignShip{ShipID: ship, RouteID: f.w.Routes[len(f.w.Routes)-1].ID})
	f.advance(time.Minute)
}

// The patricians fixture's tier, house, ship, deposit and chains.
const (
	patriciansTier    = "patricians"
	patriciansHouse   = "house_patricians"
	patriciansShip    = "galleon"
	patriciansDeposit = "quartz"
	// patriciansGold (milli-gold) is granted on top of FixtureGold: the
	// university and cathedral alone cost 110 000 gold.
	patriciansGold = 150_000_000
)

// patricians unlocks the citizens, merchants and patricians tiers
// (granted, like the gold), builds the full services ladder with the
// market at level 3, two seeded Merchant houses and a seeded Patrician
// house, and the roast-beef chain on the home island (cattle farm with
// its pastures, salt pans on the coast, slaughterhouse); a shipyard's
// galleon founds the nearest island with a quartz deposit, builds the
// glass chain there (lumberjack with its tree plots, charcoal burner,
// quartz quarry on the slot, glass smelter) and sails glass home. Every charged placement gets
// its cost granted first.
func patricians(f *fixture) {
	if f.err != nil {
		return
	}
	f.w.Gold += patriciansGold
	for _, tier := range []string{citizensTier, merchantsTier, patriciansTier} {
		if !slices.Contains(f.w.UnlockedTiers, tier) {
			f.w.UnlockedTiers = append(f.w.UnlockedTiers, tier)
		}
	}
	home := f.home()
	deposit := f.nearestWithDeposit(home, patriciansDeposit)
	if deposit == "" {
		f.err = fmt.Errorf("%w: the %s fixture needs an island with a %s deposit, but seed %d has none; use a seed with one (the dev seed %d has)",
			ErrFixtureSeed, FixturePatricians, patriciansDeposit, f.w.Seed, DevSeed)
		return
	}
	yard := f.placePaid(home, "shipyard", f.streetEnd(home))
	f.placePaid(home, "slaughterhouse", f.streetEnd(home))
	f.grant(home, &f.c.BuildingByID["salt_pans"].Cost)
	f.placeNear(home, "salt_pans", f.tradingPostCentre(home))
	if farm := f.c.BuildingByID["cattle_farm"]; farm != nil && farm.Fields != nil {
		f.grant(home, &farm.Cost)
		field := f.c.FieldByType[farm.Fields.Type]
		for range farm.Fields.Required {
			f.grant(home, &field.Cost)
		}
		f.placeNearThen(home, "cattle_farm", f.fieldAnchor(home, f.streetEnd(home), farm), func(id int64) bool {
			return f.paintFields(home, id, farm.Fields.Type, farm.Fields.Required)
		})
	}
	market := f.placePaid(home, "market", f.streetEnd(home))
	for _, typ := range []string{"chapel", "tavern", "school", "church", "playhouse", "university", "cathedral", "city_guard", "fire_station", "surgery"} {
		f.placePaid(home, typ, f.streetEnd(home))
	}
	for lv := 2; lv <= 3 && f.err == nil; lv++ {
		f.grant(home, f.c.BuildingByID["market"].LevelCost(lv))
		f.apply(sim.UpgradeBuilding{IslandID: home, BuildingID: market})
	}
	f.seeded = true
	for _, typ := range []string{merchantsHouse, merchantsHouse, patriciansHouse} {
		f.placeNear(home, typ, f.streetEnd(home))
	}
	f.seeded = false
	if f.err != nil {
		return
	}
	galleon := f.c.ShipByID[patriciansShip]
	f.grant(home, &galleon.Cost)
	f.apply(sim.OrderShip{IslandID: home, BuildingID: yard, ShipType: patriciansShip})
	f.advance(time.Duration(galleon.BuildMs)*time.Millisecond + 10*time.Second)
	if f.err == nil && (len(f.w.Ships) != 2 || f.w.Ships[1].Type != patriciansShip || f.w.Ships[1].State != sim.ShipIdle) {
		f.err = errors.New("the galleon is not idle after its build time")
	}
	if f.err != nil {
		return
	}
	ship := f.w.Ships[1].ID
	f.grant(home, &content.Cost{Materials: []content.GoodAmount{{Good: "planks", Amount: 60_000}}})
	f.apply(sim.ManualShipment{ShipID: ship, ToIslandID: deposit, Cargo: []sim.CargoAmount{{Good: "planks", Amount: 60_000}}})
	f.arrive(ship)
	if f.err != nil {
		return
	}
	site, ok := f.tradingPostSite(deposit)
	if !ok {
		f.err = fmt.Errorf("no trading post site on %s", deposit)
		return
	}
	f.apply(sim.FoundIsland{ShipID: ship, IslandID: deposit, BuildingType: tradingPostType(f.c), X: site.X, Y: site.Y, Rotation: site.Rotation})
	f.street(deposit, 8)
	f.placePaid(deposit, "quartz_quarry", f.depositTile(deposit, patriciansDeposit))
	f.grantFarm(deposit, "lumberjack")
	f.placeFarm(deposit, "lumberjack", f.forestAnchor(deposit, f.streetEnd(deposit)))
	f.placePaid(deposit, "charcoal_burner", f.streetEnd(deposit))
	f.placePaid(deposit, "glass_smelter", f.streetEnd(deposit))
	f.advance(time.Minute)
	f.apply(sim.CreateRoute{Name: "Glass home", Stops: []sim.Stop{
		{IslandID: deposit, Load: []sim.LoadRule{{Good: "glass", MaxAmount: 60_000}}},
		{IslandID: home, Unload: []string{"glass"}},
	}})
	if f.err != nil {
		return
	}
	f.apply(sim.AssignShip{ShipID: ship, RouteID: f.w.Routes[len(f.w.Routes)-1].ID})
	f.advance(time.Minute)
	// The harbour shot builds its extensions through the normal API; reserve
	// their materials in this explicitly seeded dev fixture, never a replay.
	for _, typ := range []string{"trading_pier", "depot"} {
		f.grant(home, &f.c.BuildingByID[typ].Cost)
	}
	f.grant(home, &content.Cost{Materials: []content.GoodAmount{{Good: "stone", Amount: 20_000}}})
}

// grant adds a cost's gold and materials to the world and the island's
// stock (fixtures only).
func (f *fixture) grant(island string, cost *content.Cost) {
	if f.err != nil || cost == nil {
		return
	}
	f.w.Gold += cost.Gold
	inv := &f.w.Island(island).Inventory
	if inv.Stock == nil {
		inv.Stock = map[string]sim.Qty{}
	}
	for _, m := range cost.Materials {
		inv.Stock[m.Good] += m.Amount
	}
}

// grantFarm grants a farm's cost and the cost of its required fields.
func (f *fixture) grantFarm(island, typ string) {
	def := f.c.BuildingByID[typ]
	if def == nil {
		return
	}
	f.grant(island, &def.Cost)
	if def.Fields == nil {
		return
	}
	if field := f.c.FieldByType[def.Fields.Type]; field != nil {
		for range def.Fields.Required {
			f.grant(island, &field.Cost)
		}
	}
}

// placeFarm places a farm at the site nearest to anchor where one drag
// paints every required field (the drag is kept); a building without
// fields (the pre-D-059 test content's lumberjack) is placeNear.
func (f *fixture) placeFarm(island, typ string, anchor sim.Pos) int64 {
	def := f.c.BuildingByID[typ]
	if def == nil || def.Fields == nil {
		return f.placeNear(island, typ, anchor)
	}
	return f.placeNearThen(island, typ, anchor, func(id int64) bool {
		return f.paintFields(island, id, def.Fields.Type, def.Fields.Required)
	})
}

// placePaid is placeNear with the building's cost granted first.
func (f *fixture) placePaid(island, typ string, anchor sim.Pos) int64 {
	if def := f.c.BuildingByID[typ]; def != nil {
		f.grant(island, &def.Cost)
	}
	return f.placeNear(island, typ, anchor)
}

// nearestWithDeposit returns the habitable island nearest to from (grid
// gap, then ID) with a slot of the deposit kind; "" if there is none.
func (f *fixture) nearestWithDeposit(from, kind string) string {
	src := f.w.Island(from)
	best, bestGap := "", -1
	for _, is := range f.w.Islands {
		sc := f.c.Islands.SizeClassByID[is.SizeClass]
		if is.ID == from || sc == nil || sc.Rock || archipelago.DepositCounts(is)[kind] == 0 {
			continue
		}
		if g := archipelago.Gap2(src, is); bestGap < 0 || g < bestGap {
			best, bestGap = is.ID, g
		}
	}
	return best
}

// depositTile returns the first tile (row-major) of a deposit kind on the
// island.
func (f *fixture) depositTile(island, kind string) sim.Pos {
	is := f.w.Island(island)
	for i, t := range is.Tiles {
		if t.Deposit != nil && t.Deposit.Kind == kind {
			return sim.Pos{X: i % is.Width, Y: i / is.Width}
		}
	}
	return f.streetEnd(island)
}

// tradingPostType is the first building with a trading_post block.
func tradingPostType(c *content.Catalogue) string {
	if def := archipelago.TradingPost(c); def != nil {
		return def.ID
	}
	return ""
}

// HomeTradingPostSite returns the Trading Post site the fixtures found the
// home island at (shots: the founding ghost).
func HomeTradingPostSite(c *content.Catalogue, w *sim.World) (archipelago.Rect, bool) {
	f := &fixture{c: c, w: w}
	return f.tradingPostSite(f.home())
}

// fixture replays commands on a world; the first error sticks.
type fixture struct {
	c   *content.Catalogue
	w   *sim.World
	err error
	// ends holds the town centre per island (street).
	ends map[string]sim.Pos
	// spareForest keeps sites and roads off the forest while other sites
	// exist (planner): forest is scenery since D-059.
	spareForest bool
	// seeded places buildings with sim.PlaceFree (no cost, no tier or
	// upgrade-only check): the merchants fixture's Merchant houses.
	seeded bool
}

func (f *fixture) apply(cmd sim.Command) {
	if f.err != nil {
		return
	}
	if err := sim.Apply(f.w, f.c, cmd); err != nil {
		f.err = fmt.Errorf("%#v: %w", cmd, err)
	}
}

// try applies cmd to a copy of the world and keeps the copy on success,
// so a rejected trial leaves no trace.
func (f *fixture) try(cmd sim.Command) bool {
	if f.err != nil {
		return false
	}
	w := f.w.Clone()
	var err error
	if p, ok := cmd.(sim.PlaceBuilding); ok && f.seeded {
		err = sim.PlaceFree(w, f.c, p, nil)
	} else {
		err = sim.Apply(w, f.c, cmd)
	}
	if err != nil {
		return false
	}
	f.w = w
	return true
}

func (f *fixture) advance(d time.Duration) {
	if f.err != nil {
		return
	}
	if _, err := sim.Advance(f.w, f.c, f.w.LastEvaluatedAt.Add(d)); err != nil {
		f.err = err
	}
}

func (f *fixture) ship(id int64) *sim.Ship {
	for _, s := range f.w.Ships {
		if s.ID == id {
			return s
		}
	}
	return nil
}

// requiredFields is the field count a farm type needs for full efficiency.
func (f *fixture) requiredFields(farm string) int {
	if def := f.c.BuildingByID[farm]; def != nil && def.Fields != nil {
		return def.Fields.Required
	}
	return 0
}

// home is the archipelago's home candidate (its first island).
func (f *fixture) home() string { return f.w.Islands[0].ID }

// neighbour returns the habitable island nearest to the island (grid gap,
// then ID).
func (f *fixture) neighbour(id string) string {
	from := f.w.Island(id)
	best, bestGap := "", -1
	for _, is := range f.w.Islands {
		sc := f.c.Islands.SizeClassByID[is.SizeClass]
		if is.ID == id || sc == nil || sc.Rock || sc.Scenic {
			continue
		}
		if g := archipelago.Gap2(from, is); bestGap < 0 || g < bestGap {
			best, bestGap = is.ID, g
		}
	}
	return best
}
