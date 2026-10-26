package devworld

import (
	"errors"
	"fmt"
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
// any seed:
//
//   - seafaring: the start state as New builds it (D-051): no island
//     settled, the start ship at sea with the starting stock.
//   - default: the home candidate (the archipelago's first island)
//     founded from the start ship at its roomiest Trading Post site; the
//     sloop idle there.
//   - town: default plus FixtureGold, a street inland from the Trading
//     Post, a connected lumberjack and sawmill, four settler houses (one
//     house and the sawmill moved once), the quests that layout completes
//     claimed, and a sheep farm with its three 3x3 pastures painted in
//     one place_fields drag (D-054).
//   - settled: town plus a shipyard on the coast, a second sloop (ship 2),
//     the nearest habitable island founded by it (Trading Post, street,
//     two houses, a fisher) and ship 2 sailing the route "Fish home"; the
//     start sloop (ship 1) idle at the home island.
const (
	FixtureDefault   = "default"
	FixtureSeafaring = "seafaring"
	FixtureTown      = "town"
	FixtureSettled   = "settled"
)

// ErrUnknownFixture reports a fixture name that NewFixture does not know.
var ErrUnknownFixture = errors.New("unknown dev fixture")

// Fixtures lists the fixture names.
func Fixtures() []string {
	return []string{FixtureDefault, FixtureSeafaring, FixtureTown, FixtureSettled}
}

// History of the fixtures before now (world time): long enough for the
// voyages from the spawn and between islands, the planks, the sloop and
// the first fish the layouts need.
const (
	foundHistory   = 20 * time.Minute
	townHistory    = foundHistory + 12*time.Minute
	settledHistory = townHistory + 60*time.Minute
)

// FixtureGold (milli-gold) is granted to the town and settled fixtures, so
// that a shot session on them never runs into insolvency while it adds
// upkeep (a shipyard, the sloop, island 2).
const FixtureGold = 3_000_000

// NewFixture builds the named dev fixture on the archipelago of seed
// evaluated at now (truncated to milliseconds); "" is the default.
func NewFixture(c *content.Catalogue, name string, seed uint64, now time.Time) (*sim.World, error) {
	now = now.UTC().Truncate(time.Millisecond)
	switch name {
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
	f.placeNear(home, "lumberjack", f.forestAnchor(home, f.streetEnd(home)))
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
// island with it.
func settle(f *fixture) {
	if f.err != nil {
		return
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
	// spareForest keeps sites and roads off the forest (planner).
	spareForest bool
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
	if err := sim.Apply(w, f.c, cmd); err != nil {
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
		if is.ID == id || sc == nil || sc.Rock {
			continue
		}
		if g := archipelago.Gap2(from, is); bestGap < 0 || g < bestGap {
			best, bestGap = is.ID, g
		}
	}
	return best
}
