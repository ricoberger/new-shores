package devworld

import (
	"path/filepath"
	"runtime"
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

func TestNewSeedsTheStartIsland(t *testing.T) {
	c, w := newWorld(t)
	if want := start.Truncate(time.Millisecond); !w.LastEvaluatedAt.Equal(want) {
		t.Fatalf("LastEvaluatedAt = %s, want %s", w.LastEvaluatedAt, want)
	}
	if len(w.Islands) != 1 {
		t.Fatalf("islands = %d, want 1", len(w.Islands))
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
	if len(is.Buildings) != 1 || c.BuildingByID[is.Buildings[0].Type].Warehouse == nil {
		t.Fatalf("buildings = %+v, want one warehouse", is.Buildings)
	}
	if w.Gold != c.Start.Gold {
		t.Errorf("gold = %d, want %d", w.Gold, c.Start.Gold)
	}
	for _, g := range c.Start.Goods {
		if got := is.Inventory.Stock[g.Good]; got != g.Amount {
			t.Errorf("stock %s = %d, want %d", g.Good, got, g.Amount)
		}
	}
	s, err := scenario.Parse(IslandJSON())
	if err != nil || len(s.Steps) != 0 {
		t.Fatalf("embedded document: err=%v steps=%d", err, len(s.Steps))
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

// Smoke test coordinates (client/e2e/smoke.spec.ts): a dirt road from the
// tile next to the warehouse entrance to the forest edge, a settler house,
// a lumberjack and a sawmill on that road produce planks.
func TestSmokeLayoutProducesPlanks(t *testing.T) {
	c, w := newWorld(t)
	road(t, w, c, 3, 4, 36, 4)
	place(t, w, c, "house_settlers", 8, 5, 180)
	lj := place(t, w, c, "lumberjack", 35, 5, 180)
	sm := place(t, w, c, "sawmill", 20, 5, 180)
	if lj.Efficiency == 0 {
		t.Fatal("lumberjack has no usable forest")
	}
	at := w.LastEvaluatedAt.Add(90 * time.Second)
	if _, err := sim.Advance(w, c, at); err != nil {
		t.Fatal(err)
	}
	ds, err := sim.Display(w, c, at)
	if err != nil {
		t.Fatal(err)
	}
	for _, b := range ds.Islands[0].Buildings {
		if b.ID == sm.ID {
			if b.Rates.Outputs["planks"] <= 0 {
				t.Fatalf("sawmill planks rate %d after 90 s, status %s", b.Rates.Outputs["planks"], b.Status)
			}
			return
		}
	}
	t.Fatal("sawmill not in display")
}
