package devworld

import (
	"errors"
	"fmt"
	"time"

	"github.com/ricoberger/new-shores/server/internal/content"
	"github.com/ricoberger/new-shores/server/internal/sim"
)

// Dev fixtures: worlds the dev server's reset endpoint (POST
// /api/v1/dev/reset, --dev only) seeds for the E2E specs, so that no spec
// depends on what an earlier one left in the shared in-memory world. Each
// fixture is the dev island plus the layout an E2E flow builds, replayed
// through sim.Apply over a short world-time history that ends at now; the
// player was last seen at now (no "while you were away" summary).
//
//   - seafaring: the start state as NewDev builds it (D-051): no island
//     settled, the start ship at sea with the starting stock.
//   - default: the start island founded from the start ship at the
//     standard site (Trading Post at (2, 0)) at once; the sloop idle there.
//   - town: default plus the smoke spec's result plus FixtureGold: a road along the north, a connected
//     lumberjack and sawmill (both moved once), four settler houses, the
//     quests that layout completes claimed, and a sheep farm with 16
//     pastures.
//   - settled: town plus the voyage spec's result: a shipyard on the south
//     coast, a second sloop (ship 2), island 2 founded by it (Trading Post,
//     road, two houses, a fisher) and ship 2 sailing the route "Fish home";
//     the start sloop (ship 1) idle at the start island.
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
// planks, the sloop and the first fish the layouts need, and for the
// planks the specs starting from them build with (the archipelago spec's
// four rotation houses on settled).
const (
	foundHistory   = time.Minute
	townHistory    = foundHistory + 12*time.Minute
	settledHistory = foundHistory + 40*time.Minute
)

// FixtureGold (milli-gold) is granted to the town and settled fixtures: an
// E2E spec that starts from them runs for up to an hour of world time on a
// slow CI runner (wall time × the E2E time scale) while it adds upkeep (a
// shipyard, the sloop, island 2), so the fixtures start rich instead of
// the specs earning gold or pausing buildings to stay solvent.
const FixtureGold = 3_000_000

// NewFixture builds the named dev fixture evaluated at now (truncated to
// milliseconds); "" is the default.
func NewFixture(c *content.Catalogue, name string, now time.Time) (*sim.World, error) {
	now = now.UTC().Truncate(time.Millisecond)
	switch name {
	case FixtureSeafaring:
		return NewDev(c, now)
	case "", FixtureDefault:
		return replay(c, now, foundHistory, foundStart)
	case FixtureTown:
		return replay(c, now, townHistory, func(f *fixture) {
			foundStart(f)
			town(f)
		})
	case FixtureSettled:
		return replay(c, now, settledHistory, func(f *fixture) {
			foundStart(f)
			town(f)
			settle(f)
		})
	}
	return nil, fmt.Errorf("%w %q (known: %v)", ErrUnknownFixture, name, Fixtures())
}

// fixture replays commands on a world; the first error sticks.
type fixture struct {
	c   *content.Catalogue
	w   *sim.World
	err error
}

func (f *fixture) apply(cmd sim.Command) {
	if f.err != nil {
		return
	}
	if err := sim.Apply(f.w, f.c, cmd); err != nil {
		f.err = fmt.Errorf("%#v: %w", cmd, err)
	}
}

func (f *fixture) advance(d time.Duration) {
	if f.err != nil {
		return
	}
	if _, err := sim.Advance(f.w, f.c, f.w.LastEvaluatedAt.Add(d)); err != nil {
		f.err = err
	}
}

// road places a road from (x0, y0) along x, then along y to (x1, y1), skipping road tiles.
func (f *fixture) road(island string, x0, y0, x1, y1 int) {
	is := f.w.Island(island)
	if is == nil {
		f.err = cmp(f.err, fmt.Errorf("no island %q", island))
		return
	}
	var tiles []sim.Pos
	add := func(x, y int) {
		if is.RoadAt(x, y) == "" {
			tiles = append(tiles, sim.Pos{X: x, Y: y})
		}
	}
	for x := x0; ; x += stepSign(x1 - x0) {
		add(x, y0)
		if x == x1 {
			break
		}
	}
	for y := y0; y != y1; {
		y += stepSign(y1 - y0)
		add(x1, y)
	}
	f.apply(sim.PlaceRoad{IslandID: island, Type: "road_dirt", Tiles: tiles})
}

func (f *fixture) place(island, typ string, x, y, rot int) {
	f.apply(sim.PlaceBuilding{IslandID: island, Type: typ, X: x, Y: y, Rotation: rot})
}

// move moves the building at (x, y) of the start island to (tx, ty).
func (f *fixture) move(x, y, tx, ty, rot int) {
	if f.err != nil {
		return
	}
	b := f.w.Island(startIsland).BuildingAt(f.c, x, y)
	if b == nil {
		f.err = fmt.Errorf("no building at (%d,%d)", x, y)
		return
	}
	f.apply(sim.MoveBuilding{IslandID: startIsland, BuildingID: b.ID, X: tx, Y: ty, Rotation: rot})
}

func cmp(a, b error) error {
	if a != nil {
		return a
	}
	return b
}

func stepSign(d int) int {
	if d < 0 {
		return -1
	}
	return 1
}

const (
	startIsland = "start"
	island2     = "island2"
)

// replay builds the dev island at now − history, runs build on it and
// advances to now; the player was last seen at now.
func replay(c *content.Catalogue, now time.Time, history time.Duration, build func(*fixture)) (*sim.World, error) {
	w, err := NewDev(c, now.Add(-history))
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
	sim.MarkSeen(w)
	w.PendingSummary = nil
	return w, nil
}

// Start site of the dev fixtures: the start island's Trading Post (its
// water rows on the north bay).
const (
	startTPX = 2
	startTPY = 0
)

// foundStart sails the start ship to the start island and founds it at
// the standard site; the starting stock is unloaded into the Trading Post.
func foundStart(f *fixture) {
	if f.err != nil {
		return
	}
	if len(f.w.Ships) == 0 {
		f.err = errors.New("no start ship")
		return
	}
	s := f.w.Ships[0]
	f.apply(sim.SailShip{ShipID: s.ID, ToIslandID: startIsland})
	if f.err != nil || s.Leg == nil {
		f.err = cmp(f.err, errors.New("the start ship did not sail"))
		return
	}
	f.advance(time.Duration(s.Leg.ArriveAtMs-f.w.LastEvaluatedAt.UnixMilli()) * time.Millisecond)
	f.apply(sim.FoundIsland{ShipID: s.ID, IslandID: startIsland, BuildingType: tradingPostType(f.c), X: startTPX, Y: startTPY})
}

// tradingPostType is the first building with a trading_post block.
func tradingPostType(c *content.Catalogue) string {
	for _, b := range c.Buildings {
		if b.TradingPost != nil {
			return b.ID
		}
	}
	return ""
}

// town replays the smoke spec (client/e2e/smoke.spec.ts, constants.ts).
func town(f *fixture) {
	f.w.Gold += FixtureGold
	f.place(startIsland, "lumberjack", 35, 5, 180)
	f.road(startIsland, 3, 4, 36, 4)
	f.place(startIsland, "house_settlers", 8, 5, 180)
	f.place(startIsland, "sawmill", 20, 5, 180)
	f.advance(90 * time.Second)
	f.move(8, 5, 11, 5, 180)
	f.move(20, 5, 24, 5, 180)
	f.advance(2 * time.Minute)
	for _, x := range []int{14, 16, 18} {
		f.place(startIsland, "house_settlers", x, 5, 180)
	}
	f.advance(10 * time.Second)
	// The quests this layout completed (the first three of the content).
	for _, q := range f.c.Quests {
		if st, ok := f.w.Quests[q.ID]; f.err == nil && ok && !st.Claimed && sim.QuestCompleted(f.w, q.ID) {
			f.apply(sim.ClaimQuest{QuestID: q.ID, IslandID: startIsland})
		}
	}
	f.place(startIsland, "sheep_farm", 28, 5, 0)
	var tiles []sim.Pos
	for _, p := range [][2]int{{26, 7}, {27, 7}, {31, 7}, {32, 7}, {26, 8}, {27, 8}, {28, 8}, {29, 8}, {30, 8}, {31, 8}, {32, 8}, {27, 9}, {28, 9}, {29, 9}, {30, 9}, {31, 9}} {
		tiles = append(tiles, sim.Pos{X: p[0], Y: p[1]})
	}
	f.apply(sim.PlaceFields{IslandID: startIsland, Type: "pasture", Tiles: tiles})
	f.advance(time.Minute)
}

// settle replays the voyage spec (client/e2e/voyage.spec.ts).
func settle(f *fixture) {
	f.road(startIsland, 2, 4, 2, 34)
	f.road(startIsland, 3, 34, 4, 34)
	f.place(startIsland, "shipyard", 5, 34, 180)
	if f.err != nil {
		return
	}
	yard := f.w.Island(startIsland).BuildingAt(f.c, 5, 34)
	f.apply(sim.OrderShip{IslandID: startIsland, BuildingID: yard.ID, ShipType: "sloop"})
	f.advance(2*time.Minute + 10*time.Second)
	if f.err == nil && (len(f.w.Ships) != 2 || f.w.Ships[1].State != sim.ShipIdle) {
		f.err = errors.New("the sloop is not idle after its build time")
		return
	}
	ship := f.w.Ships[len(f.w.Ships)-1].ID
	f.apply(sim.ManualShipment{ShipID: ship, ToIslandID: island2, Cargo: []sim.CargoAmount{{Good: "planks", Amount: 60_000}}})
	f.advance(2*time.Minute + 30*time.Second)
	f.apply(sim.FoundIsland{ShipID: ship, IslandID: island2, BuildingType: tradingPostType(f.c), X: 2, Y: 0})
	f.road(island2, 2, 4, 20, 4)
	f.place(island2, "house_settlers", 8, 5, 0)
	f.place(island2, "house_settlers", 10, 5, 0)
	f.place(island2, "fisher", 12, 2, 0)
	f.advance(2 * time.Minute)
	f.apply(sim.CreateRoute{Name: "Fish home", Stops: []sim.Stop{
		{IslandID: island2, Load: []sim.LoadRule{{Good: "fish", MaxAmount: 50_000}}},
		{IslandID: startIsland, Unload: []string{"fish"}},
	}})
	if f.err != nil {
		return
	}
	route := f.w.Routes[len(f.w.Routes)-1].ID
	f.apply(sim.AssignShip{ShipID: ship, RouteID: route})
	f.advance(time.Minute)
}
