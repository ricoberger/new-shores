package devworld

import (
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/ricoberger/new-shores/server/internal/content"
	"github.com/ricoberger/new-shores/server/internal/sim"
	"github.com/ricoberger/new-shores/server/internal/sim/scenario"
)

func catalogue(t *testing.T) *content.Catalogue {
	t.Helper()
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller failed")
	}
	c, err := content.Load(filepath.Join(filepath.Dir(file), "..", "..", "..", "content", "old_coast"))
	if err != nil {
		t.Fatal(err)
	}
	return c
}

var start = time.Date(2026, 10, 19, 12, 0, 0, 123_456_789, time.UTC)

func newWorld(t *testing.T) (*content.Catalogue, *sim.World) {
	t.Helper()
	c := catalogue(t)
	w, err := New(c, start)
	if err != nil {
		t.Fatal(err)
	}
	return c, w
}

// TestNewSeedsTheStartIsland: a new player world (default mode, New) is the
// two-island archipelago with exactly the content starting stock
// (start.json) and no dev bonus.
func TestNewSeedsTheStartIsland(t *testing.T) {
	c, w := newWorld(t)
	if want := start.Truncate(time.Millisecond); !w.LastEvaluatedAt.Equal(want) {
		t.Fatalf("LastEvaluatedAt = %s, want %s", w.LastEvaluatedAt, want)
	}
	if len(w.Islands) != 2 || w.Islands[0].ID != "start" || w.Islands[1].ID != "island2" || w.Islands[1].Name != "Island 2" {
		t.Fatalf("islands = %d", len(w.Islands))
	}
	is := w.Islands[0]
	if is.Width < 48 || is.Height < 32 {
		t.Fatalf("island %dx%d, want at least 48x32", is.Width, is.Height)
	}
	terrains := map[string]int{}
	for _, tile := range is.Tiles {
		terrains[tile.Terrain]++
	}
	for _, want := range []string{content.TerrainCoast, content.TerrainGrass, content.TerrainForest} {
		if terrains[want] == 0 {
			t.Errorf("island has no %s", want)
		}
	}
	if len(is.Buildings) != 1 || c.BuildingByID[is.Buildings[0].Type].TradingPost == nil {
		t.Fatalf("buildings = %+v, want one trading post", is.Buildings)
	}
	if w.Gold != c.Start.Gold {
		t.Errorf("gold = %d, want %d", w.Gold, c.Start.Gold)
	}
	if len(is.Inventory.Stock) != len(c.Start.Goods) {
		t.Errorf("stock = %v, want exactly %v", is.Inventory.Stock, c.Start.Goods)
	}
	for _, g := range c.Start.Goods {
		if got := is.Inventory.Stock[g.Good]; got != g.Amount {
			t.Errorf("stock %s = %d, want %d", g.Good, got, g.Amount)
		}
	}
	// Island 2: unsettled, nothing on it, coast, grass, forest and
	// infinite iron deposits on mountain tiles.
	i2 := w.Islands[1]
	terrains = map[string]int{}
	iron := 0
	for _, tile := range i2.Tiles {
		terrains[tile.Terrain]++
		if d := tile.Deposit; d != nil {
			if d.Kind != "iron" || d.Quantity != -1 || tile.Terrain != content.TerrainMountain {
				t.Errorf("deposit %+v on %s", d, tile.Terrain)
			}
			iron++
		}
	}
	for _, want := range []string{content.TerrainCoast, content.TerrainGrass, content.TerrainForest, content.TerrainMountain} {
		if terrains[want] == 0 {
			t.Errorf("island 2 has no %s", want)
		}
	}
	if iron == 0 || len(i2.Buildings) != 0 || len(i2.Inventory.Stock) != 0 || len(i2.Roads) != 0 {
		t.Errorf("island 2: %d iron tiles, %d buildings, stock %v", iron, len(i2.Buildings), i2.Inventory.Stock)
	}
	ds, err := sim.Display(w, c, w.LastEvaluatedAt)
	if err != nil || !ds.Islands[0].Settled || ds.Islands[1].Settled {
		t.Errorf("settled: %v %+v", err, ds.Islands)
	}
	s, err := scenario.Parse(IslandJSON())
	if err != nil || len(s.Steps) != 0 {
		t.Fatalf("embedded document: err=%v steps=%d", err, len(s.Steps))
	}
}

// TestNewDevHasNoBonus (R-29): the balancing pass removed the dev bonus;
// the --dev world is the player world.
func TestNewDevHasNoBonus(t *testing.T) {
	c, w := newWorld(t)
	dev, err := NewDev(c, start)
	if err != nil {
		t.Fatal(err)
	}
	a, _ := sim.Encode(w, c.Region.Version)
	b, _ := sim.Encode(dev, c.Region.Version)
	if string(a) != string(b) {
		t.Error("dev world differs from the player world")
	}
	s, err := scenario.Parse(IslandJSON())
	if err != nil || s.DevBonus != nil {
		t.Errorf("dev bonus %+v (%v)", s.DevBonus, err)
	}
}

// TestDevTravelTime (R-18): a sloop leg between the two dev islands takes
// between 1 and 5 minutes.
func TestDevTravelTime(t *testing.T) {
	c, w := newWorld(t)
	a, b := w.Islands[0], w.Islands[1]
	ms := sim.TravelMs(a.X, a.Y, b.X, b.Y, c.ShipByID["sloop"].SpeedPermille, c.Region.Rules.ShipSpeedMilliTilesPerMin)
	t.Logf("dev archipelago sloop leg: %d ms", ms)
	if ms < 60_000 || ms > 300_000 {
		t.Errorf("travel time %d ms outside 1-5 min", ms)
	}
}

func TestNewIsDeterministic(t *testing.T) {
	c, w1 := newWorld(t)
	w2, err := New(c, start)
	if err != nil {
		t.Fatal(err)
	}
	a, _ := sim.Encode(w1, c.Region.Version)
	b, _ := sim.Encode(w2, c.Region.Version)
	if string(a) != string(b) {
		t.Fatal("two dev worlds differ")
	}
}

func road(t *testing.T, w *sim.World, c *content.Catalogue, x0, y0, x1, y1 int) {
	t.Helper()
	var tiles []sim.Pos
	is := w.Islands[0]
	for x := x0; ; x += sign(x1 - x0) {
		if is.RoadAt(x, y0) == "" {
			tiles = append(tiles, sim.Pos{X: x, Y: y0})
		}
		if x == x1 {
			break
		}
	}
	for y := y0; y != y1; {
		y += sign(y1 - y0)
		if is.RoadAt(x1, y) == "" {
			tiles = append(tiles, sim.Pos{X: x1, Y: y})
		}
	}
	if err := sim.Apply(w, c, sim.PlaceRoad{IslandID: is.ID, Type: "road_dirt", Tiles: tiles}); err != nil {
		t.Fatalf("road (%d,%d)-(%d,%d): %v", x0, y0, x1, y1, err)
	}
}

func sign(d int) int {
	if d < 0 {
		return -1
	}
	return 1
}

func place(t *testing.T, w *sim.World, c *content.Catalogue, typ string, x, y, rot int) *sim.Building {
	t.Helper()
	if err := sim.Apply(w, c, sim.PlaceBuilding{IslandID: w.Islands[0].ID, Type: typ, X: x, Y: y, Rotation: rot}); err != nil {
		t.Fatalf("place %s at (%d,%d) r%d: %v", typ, x, y, rot, err)
	}
	return w.Islands[0].BuildingAt(c, x, y)
}

// TestIslandIsPlayable checks the size requirements of the dev island: the
// coast takes the seeded warehouse plus four fishers and the forest lets
// three lumberjacks reach full efficiency.
func TestIslandIsPlayable(t *testing.T) {
	c, w := newWorld(t)
	w.Gold = 1_000_000_000 // enough gold for the layout test
	if err := sim.AddStock(w, c, "start", "planks", 100_000, nil); err != nil {
		t.Fatal(err)
	}
	road(t, w, c, 3, 4, 45, 4)
	road(t, w, c, 6, 3, 18, 3)
	for _, x := range []int{7, 10, 13, 16} {
		if b := place(t, w, c, "fisher", x, 1, 0); b.AssignedWarehouseID == 0 {
			t.Errorf("fisher at x=%d not connected", x)
		}
	}
	road(t, w, c, 45, 4, 45, 26)
	var ljs []*sim.Building
	ljs = append(ljs, place(t, w, c, "lumberjack", 43, 10, 270))
	ljs = append(ljs, place(t, w, c, "lumberjack", 43, 20, 270))
	ljs = append(ljs, place(t, w, c, "lumberjack", 46, 15, 90))
	for _, b := range ljs {
		if b.Efficiency != 1000 {
			t.Errorf("lumberjack %d efficiency %d, want 1000", b.ID, b.Efficiency)
		}
	}
}

// Smoke test coordinates (client/e2e/smoke.spec.ts): a lumberjack placed
// before any road is not connected (D-042); a dirt road from below the
// warehouse to the forest edge connects it; a settler house and a sawmill
// on that road produce planks; then the house and the sawmill are moved
// along the road, keeping their IDs, the house its residents and the island
// its planks, and the sawmill produces again.
func TestSmokeLayoutProducesPlanks(t *testing.T) {
	c, w := newWorld(t)
	lj := place(t, w, c, "lumberjack", 35, 5, 180)
	if lj.AssignedWarehouseID != 0 {
		t.Fatal("lumberjack connected without a road")
	}
	road(t, w, c, 3, 4, 36, 4)
	if lj.AssignedWarehouseID == 0 {
		t.Fatal("lumberjack not connected by the road")
	}
	house := place(t, w, c, "house_settlers", 8, 5, 180)
	sm := place(t, w, c, "sawmill", 20, 5, 180)
	if lj.Efficiency == 0 {
		t.Fatal("lumberjack has no usable forest")
	}
	advance := func(d time.Duration) sim.DisplayState {
		t.Helper()
		at := w.LastEvaluatedAt.Add(d)
		if _, err := sim.Advance(w, c, at); err != nil {
			t.Fatal(err)
		}
		ds, err := sim.Display(w, c, at)
		if err != nil {
			t.Fatal(err)
		}
		return ds
	}
	planksRate := func(ds sim.DisplayState) int64 {
		t.Helper()
		for _, b := range ds.Islands[0].Buildings {
			if b.ID == sm.ID {
				return b.Rates.Outputs["planks"]
			}
		}
		t.Fatal("sawmill not in display")
		return 0
	}
	if ds := advance(90 * time.Second); planksRate(ds) <= 0 {
		t.Fatalf("sawmill planks rate %d after 90 s", planksRate(ds))
	}

	residents, count := house.House.Residents, len(w.Islands[0].Buildings)
	if err := sim.Apply(w, c, sim.MoveBuilding{IslandID: "start", BuildingID: house.ID, X: 11, Y: 5, Rotation: 180}); err != nil {
		t.Fatal(err)
	}
	if b := w.Islands[0].BuildingAt(c, 11, 5); b != house || b.House.Residents != residents || len(w.Islands[0].Buildings) != count {
		t.Fatalf("moved house = %+v", b)
	}
	ds := advance(time.Second)
	planks := ds.Islands[0].Inventory["planks"]
	if err := sim.Apply(w, c, sim.MoveBuilding{IslandID: "start", BuildingID: sm.ID, X: 24, Y: 5, Rotation: 180}); err != nil {
		t.Fatal(err)
	}
	if b := w.Islands[0].BuildingAt(c, 24, 5); b != sm || b.AssignedWarehouseID == 0 {
		t.Fatalf("moved sawmill = %+v", b)
	}
	ds = advance(0)
	if got := ds.Islands[0].Inventory["planks"]; got.Stock+got.InTransit < planks.Stock+planks.InTransit {
		t.Errorf("planks %+v after the move, before %+v", got, planks)
	}
	if ds := advance(90 * time.Second); planksRate(ds) <= 0 {
		t.Errorf("moved sawmill planks rate %d after 90 s", planksRate(ds))
	}
}

// Shipping layout (client/e2e/voyage.spec.ts): a road from below the
// warehouse along the west coast to the south coast connects a shipyard;
// a sloop founds island 2 with 60 planks (warehouse + 40), two houses and
// a fisher stand on island 2, and a route brings fish to the start island.
// Since the balancing pass the starting stock alone covers the whole flow
// together with the smoke test's plank chain (no dev bonus).
func TestShippingLayoutFoundsIsland2(t *testing.T) {
	c := catalogue(t)
	w, err := NewDev(c, start)
	if err != nil {
		t.Fatal(err)
	}
	// The smoke test runs first on the same world: a lumberjack, a sawmill
	// and a house.
	road(t, w, c, 3, 4, 36, 4)
	place(t, w, c, "lumberjack", 35, 5, 180)
	place(t, w, c, "house_settlers", 8, 5, 180)
	place(t, w, c, "sawmill", 20, 5, 180)
	road(t, w, c, 2, 4, 2, 34)
	road(t, w, c, 3, 34, 4, 34)
	yard := place(t, w, c, "shipyard", 5, 34, 180)
	if yard.AssignedWarehouseID == 0 {
		t.Fatal("shipyard not connected")
	}
	advance := func(d time.Duration) {
		t.Helper()
		if _, err := sim.Advance(w, c, w.LastEvaluatedAt.Add(d)); err != nil {
			t.Fatal(err)
		}
	}
	apply := func(cmd sim.Command) {
		t.Helper()
		if err := sim.Apply(w, c, cmd); err != nil {
			t.Fatalf("%#v: %v", cmd, err)
		}
	}
	apply(sim.OrderShip{IslandID: "start", BuildingID: yard.ID, ShipType: "sloop"})
	advance(2 * time.Minute)
	if len(w.Ships) != 1 || w.Ships[0].State != sim.ShipIdle {
		t.Fatalf("ships = %+v", w.Ships)
	}
	apply(sim.ManualShipment{ShipID: 1, ToIslandID: "island2", Cargo: []sim.CargoAmount{{Good: "planks", Amount: 60_000}}})
	advance(2*time.Minute + 30*time.Second)
	apply(sim.FoundIsland{ShipID: 1, IslandID: "island2", BuildingType: "trading_post", X: 2, Y: 0})
	var tiles []sim.Pos
	for x := 2; x <= 20; x++ {
		tiles = append(tiles, sim.Pos{X: x, Y: 4})
	}
	apply(sim.PlaceRoad{IslandID: "island2", Type: "road_dirt", Tiles: tiles})
	apply(sim.PlaceBuilding{IslandID: "island2", Type: "house_settlers", X: 8, Y: 5})
	apply(sim.PlaceBuilding{IslandID: "island2", Type: "house_settlers", X: 10, Y: 5})
	apply(sim.PlaceBuilding{IslandID: "island2", Type: "fisher", X: 12, Y: 2})
	apply(sim.CreateRoute{Name: "Fish home", Stops: []sim.Stop{
		{IslandID: "island2", Load: []sim.LoadRule{{Good: "fish", MaxAmount: 50_000}}},
		{IslandID: "start", Unload: []string{"fish"}},
	}})
	advance(3 * time.Minute)
	apply(sim.AssignShip{ShipID: 1, RouteID: 1})
	advance(10 * time.Minute)
	if fish := w.Islands[0].Inventory.Stock["fish"]; fish <= 0 {
		t.Errorf("no fish arrived at the start island")
	}
	if w.Gold < 0 {
		t.Errorf("gold %d", w.Gold)
	}

	// No unit was auto-paused on the way: the starting stock carries the
	// flow (R-29).
	for _, is := range w.Islands {
		for _, b := range is.Buildings {
			if b.Paused {
				t.Errorf("%s %d paused (%s)", b.Type, b.ID, b.PausedReason)
			}
		}
	}

	// Balance: the flow's construction costs against the starting stock.
	var gold, planks int64
	for _, id := range []string{"lumberjack", "sawmill", "house_settlers", "shipyard", "trading_post", "house_settlers", "house_settlers", "fisher"} {
		gold += c.BuildingByID[id].Cost.Gold
		for _, m := range c.BuildingByID[id].Cost.Materials {
			if m.Good == "planks" {
				planks += m.Amount
			}
		}
	}
	gold += c.ShipByID["sloop"].Cost.Gold
	planks += c.ShipByID["sloop"].Cost.Materials[0].Amount + 40_000
	t.Logf("smoke + first settlement flow: %d gold, %d planks (start: %d gold, %d planks)", gold/1000, planks/1000, c.Start.Gold/1000, c.Start.Goods[0].Amount/1000)
	if gold > c.Start.Gold {
		t.Errorf("the starting gold does not cover the flow")
	}
}

// TestSeedFertilitiesAndDeposits (R-29): the start island has wheat and
// apple fertility and at least four stone deposit tiles (MECHANICS §10:
// stone on the start island, iron and hemp on the second island only);
// island 2 has hemp and iron. Deposits lie on mountain tiles only.
func TestSeedFertilitiesAndDeposits(t *testing.T) {
	_, w := newWorld(t)
	want := map[string]struct {
		fertilities string
		deposit     string
		min         int
	}{
		"start":   {"wheat,apple", "stone", 4},
		"island2": {"hemp", "iron", 4},
	}
	for _, is := range w.Islands {
		wt := want[is.ID]
		if got := strings.Join(is.Fertilities, ","); got != wt.fertilities {
			t.Errorf("%s fertilities = %s, want %s", is.ID, got, wt.fertilities)
		}
		n := 0
		for i, tile := range is.Tiles {
			if d := tile.Deposit; d != nil {
				if tile.Terrain != content.TerrainMountain || d.Kind != wt.deposit || d.Quantity != -1 {
					t.Errorf("%s tile %d: deposit %+v on %s", is.ID, i, d, tile.Terrain)
				}
				n++
			}
		}
		if n < wt.min {
			t.Errorf("%s has %d %s deposit tiles, want >= %d", is.ID, n, wt.deposit, wt.min)
		}
	}
}

// TestDepositBuildingsCanReachARoad: roads cannot be built on mountains, so
// every footprint of a deposit building (every rotation and anchor) that
// covers a deposit tile of its kind and stands on valid terrain must have a
// 4-adjacent tile on which a road can be built; otherwise the mine could
// never be connected (user note on R-11). Two quarries fit side by side on
// the start island's stone deposits.
func TestDepositBuildingsCanReachARoad(t *testing.T) {
	c, w := newWorld(t)
	buildable := func(terrain string) bool {
		return terrain == content.TerrainCoast || terrain == content.TerrainGrass || terrain == content.TerrainForest
	}
	checked := 0
	for _, is := range w.Islands {
		for _, def := range c.Buildings {
			if def.RequiresDeposit == "" {
				continue
			}
			for _, size := range [][2]int{{def.Width, def.Height}, {def.Height, def.Width}} {
				fw, fh := size[0], size[1]
				for y := 0; y+fh <= is.Height; y++ {
					for x := 0; x+fw <= is.Width; x++ {
						covers, valid := false, true
						for ty := y; ty < y+fh; ty++ {
							for tx := x; tx < x+fw; tx++ {
								tile := is.Tile(tx, ty)
								if !buildable(tile.Terrain) && tile.Terrain != content.TerrainMountain {
									valid = false
								}
								if d := tile.Deposit; d != nil && d.Kind == def.RequiresDeposit {
									covers = true
								}
							}
						}
						if !valid || !covers {
							continue
						}
						checked++
						reach := false
						for ty := y - 1; ty <= y+fh && !reach; ty++ {
							for tx := x - 1; tx <= x+fw; tx++ {
								inside := tx >= x && tx < x+fw && ty >= y && ty < y+fh
								corner := (tx == x-1 || tx == x+fw) && (ty == y-1 || ty == y+fh)
								if inside || corner || !is.InBounds(tx, ty) {
									continue
								}
								if buildable(is.Tile(tx, ty).Terrain) {
									reach = true
									break
								}
							}
						}
						if !reach {
							t.Errorf("%s: %s at (%d,%d) %dx%d has no buildable neighbour for a road", is.ID, def.ID, x, y, fw, fh)
						}
					}
				}
			}
		}
	}
	if checked == 0 {
		t.Fatal("no deposit footprint checked")
	}

	// Two quarries side by side, each connected by a road below the block.
	w.Gold = 1_000_000_000
	w.UnlockedTiers = []string{"citizens"}
	road(t, w, c, 3, 33, 22, 33)
	road(t, w, c, 3, 4, 3, 33)
	for _, x := range []int{16, 19} {
		if b := place(t, w, c, "quarry", x, 30, 0); b.AssignedWarehouseID == 0 {
			t.Errorf("quarry at x=%d not connected", x)
		}
	}
}
