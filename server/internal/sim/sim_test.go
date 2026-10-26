package sim

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"maps"
	"math"
	"path/filepath"
	"runtime"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/ricoberger/new-shores/server/internal/content"
)

var t0 = time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)

func repoRoot(t testing.TB) string {
	t.Helper()
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller failed")
	}
	// file = <root>/server/internal/sim/sim_test.go
	return filepath.Join(filepath.Dir(file), "..", "..", "..")
}

// catalogue loads the pre-D-054 content (server/testdata/content): the
// mechanics tests pin its footprints and costs (2x2 houses, 4x4 Trading
// Post, 2x2 pastures); the shipped content's numbers are checked by the
// content tests and the reference games.
func catalogue(t testing.TB) *content.Catalogue {
	t.Helper()
	root := repoRoot(t)
	c, err := content.LoadWithSchemas(filepath.Join(root, "server", "testdata", "content", "old_coast_pre_d054"), filepath.Join(root, "content", "schema"))
	if err != nil {
		t.Fatal(err)
	}
	return c
}

// shippedCatalogue loads the shipped content (content/old_coast, D-054
// footprints): for the tests of rules whose shape it changes (3x3
// pastures, 1x1 crop fields painted by the hundred).
func shippedCatalogue(t testing.TB) *content.Catalogue {
	t.Helper()
	c, err := content.Load(filepath.Join(repoRoot(t), "content", "old_coast"))
	if err != nil {
		t.Fatal(err)
	}
	return c
}

// varietyCatalogue loads the variety test content (server/testdata/content):
// a two-good food category, an optional chapel need, an upgradeable Citizens
// house and Citizens-tier buildings that start locked.
func varietyCatalogue(t testing.TB) *content.Catalogue {
	t.Helper()
	root := repoRoot(t)
	c, err := content.LoadWithSchemas(filepath.Join(root, "server", "testdata", "content", "old_coast_variety"), filepath.Join(root, "content", "schema"))
	if err != nil {
		t.Fatal(err)
	}
	return c
}

// islandFromRows builds an island from ASCII rows ('~' water, 'c' coast,
// '.' grass, 'f' forest, 'm' mountain).
func islandFromRows(id string, rows ...string) *Island {
	terrain := map[rune]string{'~': "water", 'c': "coast", '.': "grass", 'f': "forest", 'm': "mountain"}
	var tiles []Tile
	for _, r := range rows {
		for _, ch := range r {
			tiles = append(tiles, Tile{Terrain: terrain[ch]})
		}
	}
	return NewIsland(id, len(rows[0]), len(rows), tiles)
}

// testWorld is a 20x10 island with a seeded Trading Post at (1,0) whose
// footprint (x 1..4, y 0..3; rows 0..1 on water) touches a road row y=4
// from x=2 to x=17, plenty of gold and planks. The fisher site (16,2) has
// its front row on water.
func testWorld(t testing.TB, c *content.Catalogue) *World {
	t.Helper()
	w := NewWorld(t0)
	w.Islands = []*Island{islandFromRows("main",
		"~~~~~~~~~~~~~~~~~~~~",
		"~~~~~ffffffffcccccm~",
		"~....ffffffffccc~~m~",
		"~....ffffffff.....m~",
		"~..................~",
		"~....ffffffff......~",
		"~....ffffffff......~",
		"~..................~",
		"~..................~",
		"~~~~~~~~~~~~~~~~~~~~",
	)}
	if err := PlaceFree(w, c, PlaceBuilding{IslandID: "main", Type: "trading_post", X: 1, Y: 0}, nil); err != nil {
		t.Fatal(err)
	}
	var road []Pos
	for x := 2; x <= 17; x++ {
		road = append(road, Pos{x, 4})
	}
	w.Gold = 10_000_000
	if err := AddStock(w, c, "main", "planks", 200_000, nil); err != nil {
		t.Fatal(err)
	}
	grantWorkers(t, w, c)
	if err := Apply(w, c, PlaceRoad{IslandID: "main", Type: "road_dirt", Tiles: road}); err != nil {
		t.Fatal(err)
	}
	return w
}

// grantWorkers grants 1000 settlers of workforce, so that production tests
// without houses run at workforce factor 1 (seed-only grant, R28a).
func grantWorkers(t testing.TB, w *World, c *content.Catalogue) {
	t.Helper()
	if err := GrantWorkforce(w, c, "main", "settlers", 1_000_000); err != nil {
		t.Fatal(err)
	}
}

func mustApply(t testing.TB, w *World, c *content.Catalogue, cmd Command) {
	t.Helper()
	if err := Apply(w, c, cmd); err != nil {
		t.Fatalf("Apply(%#v): %v", cmd, err)
	}
}

func mustAdvance(t testing.TB, w *World, c *content.Catalogue, d time.Duration) []Boundary {
	t.Helper()
	bs, err := Advance(w, c, w.LastEvaluatedAt.Add(d))
	if err != nil {
		t.Fatal(err)
	}
	return bs
}

func encode(t testing.TB, w *World) []byte {
	t.Helper()
	data, err := Encode(w, "test")
	if err != nil {
		t.Fatal(err)
	}
	return data
}

func display(t testing.TB, w *World, c *content.Catalogue) DisplayState {
	t.Helper()
	ds, err := Display(w, c, w.LastEvaluatedAt)
	if err != nil {
		t.Fatal(err)
	}
	return ds
}

func buildingDisplay(t testing.TB, ds DisplayState, id int64) BuildingDisplay {
	t.Helper()
	for _, b := range ds.Islands[0].Buildings {
		if b.ID == id {
			return b
		}
	}
	t.Fatalf("building %d not displayed", id)
	return BuildingDisplay{}
}

func TestEnvelopeRoundTrip(t *testing.T) {
	c := catalogue(t)
	w := testWorld(t, c)
	mustApply(t, w, c, PlaceBuilding{IslandID: "main", Type: "lumberjack", X: 8, Y: 2})
	mustApply(t, w, c, PlaceBuilding{IslandID: "main", Type: "sawmill", X: 14, Y: 2})
	mustApply(t, w, c, PlaceBuilding{IslandID: "main", Type: "house_settlers", X: 3, Y: 5, Rotation: 180})
	mustAdvance(t, w, c, 37*time.Second+123*time.Millisecond)

	first := encode(t, w)
	w2, cv, _, err := Decode(first, nil)
	if err != nil {
		t.Fatal(err)
	}
	if cv != "test" {
		t.Errorf("content version = %q", cv)
	}
	second := encode(t, w2)
	if !bytes.Equal(first, second) {
		t.Errorf("round trip not byte-identical:\n%s\n%s", first, second)
	}
	if !strings.Contains(string(first), fmt.Sprintf(`"schema_version":%d`, SchemaVersion)) || !strings.Contains(string(first), `"last_evaluated_at":"2026-01-01T00:00:37.123Z"`) {
		t.Errorf("unexpected envelope: %s", first[:200])
	}
}

func TestDecodeRejectsSchemaVersion(t *testing.T) {
	for _, v := range []int{0, SchemaVersion + 1} {
		data, _ := json.Marshal(map[string]any{"schema_version": v, "content_version": "x", "world": map[string]any{}})
		if _, _, _, err := Decode(data, nil); !errors.Is(err, ErrSchemaVersion) {
			t.Errorf("version %d: err = %v, want ErrSchemaVersion", v, err)
		}
	}
}

func TestApplyLeavesWorldUnchangedOnError(t *testing.T) {
	c := catalogue(t)
	tests := []struct {
		name string
		cmd  Command
		want error
	}{
		{"unknown island", PlaceBuilding{IslandID: "x", Type: "sawmill", X: 14, Y: 2}, ErrUnknownIsland},
		{"unknown type", PlaceBuilding{IslandID: "main", Type: "castle", X: 14, Y: 2}, ErrUnknownBuilding},
		{"footprint out of bounds", PlaceBuilding{IslandID: "main", Type: "sawmill", X: 19, Y: 2}, ErrOutOfBounds},
		{"negative position", PlaceBuilding{IslandID: "main", Type: "sawmill", X: -1, Y: 2}, ErrOutOfBounds},
		{"max x", PlaceBuilding{IslandID: "main", Type: "sawmill", X: math.MaxInt, Y: 2}, ErrOutOfBounds},
		{"max y", PlaceBuilding{IslandID: "main", Type: "sawmill", X: 14, Y: math.MaxInt}, ErrOutOfBounds},
		{"min x", PlaceBuilding{IslandID: "main", Type: "sawmill", X: math.MinInt, Y: 2}, ErrOutOfBounds},
		{"min y", PlaceBuilding{IslandID: "main", Type: "sawmill", X: 14, Y: math.MinInt}, ErrOutOfBounds},
		{"water", PlaceBuilding{IslandID: "main", Type: "sawmill", X: 14, Y: 0}, ErrTerrain},
		{"mountain", PlaceBuilding{IslandID: "main", Type: "sawmill", X: 17, Y: 2}, ErrTerrain},
		{"occupied by building", PlaceBuilding{IslandID: "main", Type: "sawmill", X: 3, Y: 2}, ErrOccupied},
		{"occupied by road", PlaceBuilding{IslandID: "main", Type: "sawmill", X: 14, Y: 3}, ErrOccupied},
		{"not on water", PlaceBuilding{IslandID: "main", Type: "fisher", X: 14, Y: 5}, ErrNotOnWater},
		{"water-edge land row on water", PlaceBuilding{IslandID: "main", Type: "fisher", X: 16, Y: 2, Rotation: 180}, ErrTerrain},
		{"no work area", PlaceBuilding{IslandID: "main", Type: "lumberjack", X: 16, Y: 7}, ErrNoWorkArea},
		{"bad rotation", PlaceBuilding{IslandID: "main", Type: "sawmill", X: 14, Y: 2, Rotation: 45}, ErrInvalidCommand},
		{"road on road", PlaceRoad{IslandID: "main", Type: "road_dirt", Tiles: []Pos{{1, 7}, {2, 4}}}, ErrOccupied},
		{"road on water", PlaceRoad{IslandID: "main", Type: "road_dirt", Tiles: []Pos{{1, 7}, {0, 7}}}, ErrTerrain},
		{"demolish road without road", DemolishRoad{IslandID: "main", Tiles: []Pos{{2, 4}, {2, 7}}}, ErrNoRoad},
		{"demolish missing building", Demolish{IslandID: "main", BuildingID: 99}, ErrBuildingNotFound},
		{"pause warehouse", SetPaused{IslandID: "main", BuildingID: 1, Paused: true}, ErrNotPausable},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			w := testWorld(t, c)
			before := encode(t, w)
			err := Apply(w, c, tt.cmd)
			if !errors.Is(err, tt.want) {
				t.Fatalf("err = %v, want %v", err, tt.want)
			}
			if !bytes.Equal(before, encode(t, w)) {
				t.Error("world changed on error")
			}
		})
	}

	t.Run("insufficient gold", func(t *testing.T) {
		w := testWorld(t, c)
		w.Gold = 79_999
		before := encode(t, w)
		if err := Apply(w, c, PlaceBuilding{IslandID: "main", Type: "sawmill", X: 14, Y: 2}); !errors.Is(err, ErrInsufficientGold) {
			t.Fatalf("err = %v", err)
		}
		if !bytes.Equal(before, encode(t, w)) {
			t.Error("world changed on error")
		}
	})
	t.Run("insufficient materials", func(t *testing.T) {
		w := testWorld(t, c)
		w.Islands[0].Inventory.setFine("planks", 7_999*SubPerMilli)
		before := encode(t, w)
		if err := Apply(w, c, PlaceBuilding{IslandID: "main", Type: "sawmill", X: 14, Y: 2}); !errors.Is(err, ErrInsufficientMaterials) {
			t.Fatalf("err = %v", err)
		}
		if !bytes.Equal(before, encode(t, w)) {
			t.Error("world changed on error")
		}
	})
	t.Run("surplus loss", func(t *testing.T) {
		w := testWorld(t, c)
		before := encode(t, w)
		if err := Apply(w, c, Demolish{IslandID: "main", BuildingID: 1}); !errors.Is(err, ErrSurplusLoss) {
			t.Fatalf("err = %v", err)
		}
		if !bytes.Equal(before, encode(t, w)) {
			t.Error("world changed on error")
		}
	})
}

func TestPlaceChargesWorldGoldAndIslandMaterials(t *testing.T) {
	c := catalogue(t)
	w := testWorld(t, c)
	mustApply(t, w, c, PlaceBuilding{IslandID: "main", Type: "sawmill", X: 14, Y: 2})
	if w.Gold != 10_000_000-80_000 {
		t.Errorf("gold = %d", w.Gold)
	}
	if got := w.Islands[0].Inventory.Stock["planks"]; got != 200_000-8_000 {
		t.Errorf("planks = %d", got)
	}
	// Road tiles (4,4) next to the warehouse to (14,4) next to the sawmill:
	// d = 11, delay 10 s + 11 x 1 s.
	b := w.Islands[0].Building(2)
	if b == nil || b.ID != 2 || w.NextBuildingID != 3 || b.AssignedWarehouseID != 1 || b.RoadDistance != 11 || b.TransferDelayMs != 21_000 {
		t.Errorf("building = %+v next %d", b, w.NextBuildingID)
	}
}

func TestPlaceZeroCostRoadWithEmptyInventoryAndNoGold(t *testing.T) {
	c := catalogue(t)
	w := NewWorld(t0)
	w.Islands = []*Island{islandFromRows("main", "~~~~", "~~~~", "....", "....", "....", "....")}
	// Unsettled island: even a zero-cost road is rejected (R-34).
	if err := Apply(w, c, PlaceRoad{IslandID: "main", Type: "road_dirt", Tiles: []Pos{{0, 4}}}); !errors.Is(err, ErrIslandNotSettled) {
		t.Fatalf("road on an unsettled island: %v", err)
	}
	if err := Apply(w, c, PlaceBuilding{IslandID: "main", Type: "road_dirt", X: 0, Y: 4}); !errors.Is(err, ErrIslandNotSettled) {
		t.Fatalf("road building on an unsettled island: %v", err)
	}
	if err := PlaceFree(w, c, PlaceBuilding{IslandID: "main", Type: "trading_post", X: 0, Y: 0}, nil); err != nil {
		t.Fatal(err)
	}
	mustApply(t, w, c, PlaceRoad{IslandID: "main", Type: "road_dirt", Tiles: []Pos{{0, 4}, {1, 4}}})
	mustApply(t, w, c, PlaceBuilding{IslandID: "main", Type: "road_dirt", X: 2, Y: 4})
	if w.Gold != 0 || len(w.Islands[0].Roads) != 3 || w.Islands[0].Inventory.Stock != nil {
		t.Errorf("gold %d roads %v stock %v", w.Gold, w.Islands[0].Roads, w.Islands[0].Inventory.Stock)
	}
}

func TestHouseStartsAtFloor(t *testing.T) {
	c := catalogue(t)
	w := testWorld(t, c)
	mustApply(t, w, c, PlaceBuilding{IslandID: "main", Type: "house_settlers", X: 3, Y: 5, Rotation: 180})
	ds := display(t, w, c)
	if b := buildingDisplay(t, ds, 2); b.Residents == nil || *b.Residents != 2000 {
		t.Errorf("house = %+v", b)
	}
}

func TestDemolishRefund(t *testing.T) {
	c := catalogue(t)
	w := testWorld(t, c)
	mustApply(t, w, c, PlaceBuilding{IslandID: "main", Type: "sawmill", X: 14, Y: 2})
	gold := w.Gold
	l := NewLedger()
	if err := ApplyWithLedger(w, c, Demolish{IslandID: "main", BuildingID: 2}, l); err != nil {
		t.Fatal(err)
	}
	// 50 % of 8 planks back into the island inventory, no gold.
	if got := w.Islands[0].Inventory.Stock["planks"]; got != 200_000-8_000+4_000 {
		t.Errorf("planks = %d", got)
	}
	if w.Gold != gold {
		t.Errorf("gold changed: %d -> %d", gold, w.Gold)
	}
	if f := l.Flow("main", "planks"); f.Refunded != 4_000*SubPerMilli || f.Lost != 0 {
		t.Errorf("flow = %+v", f)
	}

	t.Run("odd cost rounds down to whole units", func(t *testing.T) {
		if refundAmount(5_000) != 2_000 || refundAmount(15_000) != 7_000 || refundAmount(1_000) != 0 {
			t.Error("refundAmount")
		}
	})

	t.Run("clamped at capacity", func(t *testing.T) {
		w := testWorld(t, c)
		mustApply(t, w, c, PlaceBuilding{IslandID: "main", Type: "sawmill", X: 14, Y: 2})
		if err := AddStock(w, c, "main", "planks", 300_000-192_000-1_500, nil); err != nil {
			t.Fatal(err)
		}
		l := NewLedger()
		if err := ApplyWithLedger(w, c, Demolish{IslandID: "main", BuildingID: 2}, l); err != nil {
			t.Fatal(err)
		}
		if got := w.Islands[0].Inventory.Stock["planks"]; got != 300_000 {
			t.Errorf("planks = %d, want capacity", got)
		}
		if f := l.Flow("main", "planks"); f.Refunded != 4_000*SubPerMilli || f.Lost != 2_500*SubPerMilli {
			t.Errorf("flow = %+v", f)
		}
	})
}

func TestDemolishWarehouseSurplus(t *testing.T) {
	c := catalogue(t)
	w := testWorld(t, c)
	mustApply(t, w, c, PlaceBuilding{IslandID: "main", Type: "fisher", X: 16, Y: 2})
	mustAdvance(t, w, c, time.Minute)
	// The Trading Post cannot go while another building stands (R-35).
	if err := Apply(w, c, Demolish{IslandID: "main", BuildingID: 1, AcceptSurplusLoss: true}); !errors.Is(err, ErrLastTradingPost) {
		t.Fatalf("err = %v", err)
	}
	// An inland Warehouse next to the fisher's road collects its output
	// (nearest collector); demolishing it leaves the capacity unchanged
	// (no surplus) and hands the fisher back to the Trading Post.
	mustApply(t, w, c, PlaceBuilding{IslandID: "main", Type: "warehouse", X: 16, Y: 5})
	if b := w.Islands[0].Building(2); b.AssignedWarehouseID != 3 {
		t.Errorf("fisher assigned to %d, want the warehouse", b.AssignedWarehouseID)
	}
	mustApply(t, w, c, Demolish{IslandID: "main", BuildingID: 3})
	if b := w.Islands[0].Building(2); b.AssignedWarehouseID != 1 {
		t.Errorf("fisher assigned to %d, want the Trading Post", b.AssignedWarehouseID)
	}
	mustAdvance(t, w, c, time.Minute)
	// The fisher goes; its goods in transit are delivered.
	mustApply(t, w, c, Demolish{IslandID: "main", BuildingID: 2})
	// Only the Trading Post is left: demolishing it unsettles the island,
	// the stock above the new capacity 0 follows the surplus-loss rule.
	if err := Apply(w, c, Demolish{IslandID: "main", BuildingID: 1}); !errors.Is(err, ErrSurplusLoss) {
		t.Fatalf("err = %v", err)
	}
	l := NewLedger()
	planks := w.Islands[0].Inventory.fine("planks")
	fish := committedFine(w.Islands[0], "fish", w.LastEvaluatedAt.UnixMilli())
	if fish == 0 {
		t.Fatal("no fish to lose")
	}
	if err := ApplyWithLedger(w, c, Demolish{IslandID: "main", BuildingID: 1, AcceptSurplusLoss: true}, l); err != nil {
		t.Fatal(err)
	}
	is := w.Islands[0]
	if is.Inventory.Stock != nil || settled(is, c) || len(is.Roads) == 0 {
		t.Errorf("stock %v after losing the Trading Post (roads %d)", is.Inventory.Stock, len(is.Roads))
	}
	// Planks: stock lost plus the whole refund (no capacity left).
	if f := l.Flow("main", "planks"); f.Lost != planks+refundAmount(material(c.BuildingByID["trading_post"].Cost, "planks"))*SubPerMilli {
		t.Errorf("planks flow = %+v", f)
	}
	if f := l.Flow("main", "fish"); f.Lost != fish {
		t.Errorf("fish flow = %+v, want lost %d", f, fish)
	}
	if err := Apply(w, c, PlaceBuilding{IslandID: "main", Type: "fisher", X: 16, Y: 2}); !errors.Is(err, ErrIslandNotSettled) {
		t.Errorf("placement on the unsettled island: %v", err)
	}
}

func TestPauseAndResume(t *testing.T) {
	c := catalogue(t)
	w := testWorld(t, c)
	mustApply(t, w, c, PlaceBuilding{IslandID: "main", Type: "fisher", X: 16, Y: 2})
	mustApply(t, w, c, SetPaused{IslandID: "main", BuildingID: 2, Paused: true})
	mustAdvance(t, w, c, 10*time.Minute)
	ds := display(t, w, c)
	b := buildingDisplay(t, ds, 2)
	if b.Status != StatusPaused || b.PausedReason != PausedReasonPlayer || b.Rates.Outputs["fish"] != 0 || ds.Islands[0].Inventory["fish"].Stock != 0 {
		t.Errorf("paused fisher = %+v", b)
	}

	// Resuming is also allowed for buildings paused for insolvency.
	w.Islands[0].Building(2).PausedReason = PausedReasonUnpaid
	mustApply(t, w, c, SetPaused{IslandID: "main", BuildingID: 2, Paused: false})
	if b := w.Islands[0].Building(2); b.Paused || b.PausedReason != "" {
		t.Errorf("resumed = %+v", b)
	}
	mustAdvance(t, w, c, 10*time.Minute)
	// 1.5 fish/min for 10 min minus the 23 s transfer delay.
	if got := display(t, w, c).Islands[0].Inventory["fish"].Stock; got != (600-23)*1000/40 {
		t.Errorf("fish = %d", got)
	}

	// Goods in transit still arrive while paused.
	mustApply(t, w, c, SetPaused{IslandID: "main", BuildingID: 2, Paused: true})
	mustAdvance(t, w, c, time.Minute)
	if got := display(t, w, c).Islands[0].Inventory["fish"]; got.Stock != 15_000 || got.InTransit != 0 {
		t.Errorf("fish after pause = %+v", got)
	}
}

func TestStarvationSharesInflow(t *testing.T) {
	c := catalogue(t)
	w := NewWorld(t0)
	// Lumberjack with 18 forest tiles: efficiency 750 -> 1.5 wood/min.
	w.Islands = []*Island{islandFromRows("main",
		"~~~~~~~~~~~~~~~~~~~~",
		"~~~~~...............",
		"~.......ffffff......",
		"~.......ffffff......",
		"~...................",
		"~.......ffffff......",
		"~.......ffffff......",
		"~...................",
	)}
	if err := PlaceFree(w, c, PlaceBuilding{IslandID: "main", Type: "trading_post", X: 1, Y: 0}, nil); err != nil {
		t.Fatal(err)
	}
	w.Gold = 1_000_000
	if err := AddStock(w, c, "main", "planks", 100_000, nil); err != nil {
		t.Fatal(err)
	}
	grantWorkers(t, w, c)
	var road []Pos
	for x := 2; x <= 19; x++ {
		road = append(road, Pos{x, 4})
	}
	mustApply(t, w, c, PlaceRoad{IslandID: "main", Type: "road_dirt", Tiles: road})
	mustApply(t, w, c, PlaceBuilding{IslandID: "main", Type: "lumberjack", X: 10, Y: 2})
	mustApply(t, w, c, PlaceBuilding{IslandID: "main", Type: "sawmill", X: 16, Y: 2})
	mustAdvance(t, w, c, 10*time.Minute)

	ds := display(t, w, c)
	lj, sm := buildingDisplay(t, ds, 2), buildingDisplay(t, ds, 3)
	if lj.EfficiencyPermille != 750 || lj.Status != StatusLowEfficiency || lj.Rates.Outputs["wood"] != 1500 {
		t.Errorf("lumberjack = %s eff %d rate %d", lj.Status, lj.EfficiencyPermille, lj.Rates.Outputs["wood"])
	}
	if sm.Status != StatusInputStarved || sm.Rates.Inputs["wood"] != 1500 || sm.Rates.Outputs["planks"] != 1500 {
		t.Errorf("sawmill = %s rates %+v", sm.Status, sm.Rates)
	}
	if inv := ds.Islands[0].Inventory["wood"]; inv.Stock != 0 || inv.RatePerMin != 0 {
		t.Errorf("wood = %+v", inv)
	}

	// A second sawmill shares the same inflow: 0.75 wood/min each.
	mustApply(t, w, c, PlaceBuilding{IslandID: "main", Type: "sawmill", X: 6, Y: 5, Rotation: 180})
	mustAdvance(t, w, c, time.Minute)
	ds = display(t, w, c)
	for _, id := range []int64{3, 4} {
		if b := buildingDisplay(t, ds, id); b.Status != StatusInputStarved || b.Rates.Inputs["wood"] != 750 {
			t.Errorf("sawmill %d = %s %+v", id, b.Status, b.Rates)
		}
	}
}

func TestEfficiencyRecomputedWhenNeighboursChange(t *testing.T) {
	c := catalogue(t)
	w := testWorld(t, c)
	mustApply(t, w, c, PlaceBuilding{IslandID: "main", Type: "lumberjack", X: 8, Y: 2})
	if eff := w.Islands[0].Building(2).Efficiency; eff != 1000 {
		t.Fatalf("efficiency = %d", eff)
	}
	// Houses on forest tiles in the work area reduce the matching tiles.
	mustApply(t, w, c, PlaceBuilding{IslandID: "main", Type: "house_settlers", X: 5, Y: 5, Rotation: 180})
	mustApply(t, w, c, PlaceBuilding{IslandID: "main", Type: "house_settlers", X: 7, Y: 5, Rotation: 180})
	mustApply(t, w, c, PlaceBuilding{IslandID: "main", Type: "house_settlers", X: 10, Y: 5, Rotation: 180})
	reduced := w.Islands[0].Building(2).Efficiency
	if reduced >= 1000 {
		t.Fatalf("efficiency not reduced: %d", reduced)
	}
	mustApply(t, w, c, Demolish{IslandID: "main", BuildingID: 4})
	if eff := w.Islands[0].Building(2).Efficiency; eff <= reduced {
		t.Errorf("efficiency not restored: %d", eff)
	}
}

// unconnectedLumberjack places a lumberjack (x 9..10, y 6..7) on its own
// road piece below the main road of testWorld, runs it until its buffer is
// full and returns it.
func unconnectedLumberjack(t *testing.T, w *World, c *content.Catalogue) *Building {
	t.Helper()
	mustApply(t, w, c, PlaceRoad{IslandID: "main", Type: "road_dirt", Tiles: []Pos{{9, 8}, {10, 8}}})
	mustApply(t, w, c, PlaceBuilding{IslandID: "main", Type: "lumberjack", X: 9, Y: 6, Rotation: 0})
	b := w.Islands[0].Building(2)
	if b.AssignedWarehouseID != 0 {
		t.Fatal("unexpectedly connected")
	}
	mustAdvance(t, w, c, 10*time.Minute)
	if got := buildingDisplay(t, display(t, w, c), 2); got.Status != StatusNotConnected || got.Buffer == nil || got.Buffer.Stock["wood"] != 5_000 {
		t.Fatalf("lumberjack = %s buffer %+v", got.Status, got.Buffer)
	}
	return b
}

// connectRoad links the lumberjack's road to the main road at (8,4).
var connectRoad = PlaceRoad{IslandID: "main", Type: "road_dirt", Tiles: []Pos{{8, 5}, {8, 6}, {8, 7}, {8, 8}}}

func woodTotal(w *World) int64 {
	return total(w.Islands[0], "wood", w.LastEvaluatedAt.UnixMilli())
}

// TestBufferLeavesWithOutputStreamOnConnect: after connecting, the buffered
// goods leave first with the producer's output stream; nothing is lost.
func TestBufferLeavesWithOutputStreamOnConnect(t *testing.T) {
	c := catalogue(t)
	w := testWorld(t, c)
	b := unconnectedLumberjack(t, w, c)
	before := woodTotal(w)

	l := NewLedger()
	if err := ApplyWithLedger(w, c, connectRoad, l); err != nil {
		t.Fatal(err)
	}
	if b.AssignedWarehouseID != 1 || woodTotal(w) != before || l.Flow("main", "wood").Lost != 0 {
		t.Fatalf("after connect: warehouse %d total %d -> %d lost %d", b.AssignedWarehouseID, before, woodTotal(w), l.Flow("main", "wood").Lost)
	}
	if _, err := AdvanceWithLedger(w, c, w.LastEvaluatedAt.Add(10*time.Minute), l); err != nil {
		t.Fatal(err)
	}
	f := l.Flow("main", "wood")
	if b.Buffer != nil || b.BufferSub != nil || f.Lost != 0 || woodTotal(w) != before+f.Produced {
		t.Errorf("buffer %v sub %v, total %d, want %d + produced %d", b.Buffer, b.BufferSub, woodTotal(w), before, f.Produced)
	}
	// The stream ran at the producer's rate the whole time: the buffer left
	// first, so production is 10 minutes of output minus the buffer.
	if stream := b.Efficiency * 2 * 10 * SubPerMilli; f.Produced != stream-before {
		t.Errorf("produced %d, want %d", f.Produced, stream-before)
	}
}

// TestBufferKeptWhenConnectingToFullInventory: connecting while the good is
// at capacity keeps the buffer instead of losing it; it leaves once there is
// consumption.
func TestBufferKeptWhenConnectingToFullInventory(t *testing.T) {
	c := catalogue(t)
	w := testWorld(t, c)
	b := unconnectedLumberjack(t, w, c)
	if err := AddStock(w, c, "main", "wood", 300_000, nil); err != nil {
		t.Fatal(err)
	}
	before := woodTotal(w) // 300 in stock + 5 buffered

	l := NewLedger()
	if err := ApplyWithLedger(w, c, connectRoad, l); err != nil {
		t.Fatal(err)
	}
	if _, err := AdvanceWithLedger(w, c, w.LastEvaluatedAt.Add(time.Hour), l); err != nil {
		t.Fatal(err)
	}
	if got := woodTotal(w); got != before || l.Flow("main", "wood").Lost != 0 {
		t.Fatalf("wood total %d, want %d; lost %d", got, before, l.Flow("main", "wood").Lost)
	}
	if got := buildingDisplay(t, display(t, w, c), 2); got.Status != StatusWarehouseFull || got.Buffer == nil || got.Buffer.Stock["wood"] != 5_000 {
		t.Fatalf("lumberjack = %s buffer %+v", got.Status, got.Buffer)
	}

	// A sawmill consumes wood; the buffer leaves with the stream.
	mustApply(t, w, c, PlaceBuilding{IslandID: "main", Type: "sawmill", X: 14, Y: 2})
	if _, err := AdvanceWithLedger(w, c, w.LastEvaluatedAt.Add(time.Hour), l); err != nil {
		t.Fatal(err)
	}
	f := l.Flow("main", "wood")
	if b.Buffer != nil || f.Lost != 0 || woodTotal(w) != before+f.Produced-f.Consumed {
		t.Errorf("buffer %v lost %d total %d", b.Buffer, f.Lost, woodTotal(w))
	}
}

func TestAdvanceTimeRules(t *testing.T) {
	c := catalogue(t)
	w := testWorld(t, c)
	if _, err := Advance(w, c, t0.Add(-time.Millisecond)); !errors.Is(err, ErrTimeBackwards) {
		t.Errorf("err = %v", err)
	}
	before := encode(t, w)
	if bs, err := Advance(w, c, t0); err != nil || bs != nil || !bytes.Equal(before, encode(t, w)) {
		t.Errorf("no-op advance changed the world: %v %v", bs, err)
	}
	mustApply(t, w, c, PlaceBuilding{IslandID: "main", Type: "fisher", X: 16, Y: 2})
	gold := w.Gold
	mustAdvance(t, w, c, 2*time.Hour)
	// Upkeep of the fisher (1/min; the warehouse has none), no houses, no
	// taxes.
	if want := gold - 120*1_000; w.Gold != want || w.GoldSub != 0 {
		t.Errorf("gold after 2h = %d (sub %d), want %d", w.Gold, w.GoldSub, want)
	}
	if _, err := Display(w, c, w.LastEvaluatedAt.Add(time.Second)); !errors.Is(err, ErrDisplayTime) {
		t.Errorf("Display at another time: %v", err)
	}
}

func TestIterationCapFallback(t *testing.T) {
	base := catalogue(t)
	c := *base
	c.Region.Rules.IterationCap = 3
	w := testWorld(t, &c)
	w.Gold = 1_000_000_000 // 90 days of upkeep (7 gold/min) without pauses
	mustApply(t, w, &c, PlaceBuilding{IslandID: "main", Type: "lumberjack", X: 8, Y: 2})
	mustApply(t, w, &c, PlaceBuilding{IslandID: "main", Type: "sawmill", X: 14, Y: 2})
	l := NewLedger()
	bs, err := AdvanceWithLedger(w, &c, w.LastEvaluatedAt.Add(90*24*time.Hour), l)
	if err != nil {
		t.Fatal(err)
	}
	coarse := 0
	for _, b := range bs {
		if b.Kind == BoundaryCoarseMode {
			coarse++
		}
	}
	if coarse != 1 || len(bs) != 4 || bs[3].Kind != BoundaryCoarseMode {
		t.Fatalf("boundaries = %+v", bs)
	}
	if !w.LastEvaluatedAt.Equal(t0.Add(90 * 24 * time.Hour)) {
		t.Errorf("last evaluated = %s", w.LastEvaluatedAt)
	}
	is := w.Islands[0]
	for _, good := range []string{"wood", "planks"} {
		if s := is.Inventory.fine(good); s < 0 || s > capacityFine(is, &c) {
			t.Errorf("%s = %d out of bounds", good, s)
		}
	}
	if got := display(t, w, &c).Islands[0].Inventory["planks"].Stock; got != 300_000 {
		t.Errorf("planks = %d, want capacity after 90 days", got)
	}
}

func TestDisplayFieldsAndNextChange(t *testing.T) {
	c := catalogue(t)
	w := testWorld(t, c)
	mustApply(t, w, c, PlaceBuilding{IslandID: "main", Type: "lumberjack", X: 8, Y: 2})
	mustApply(t, w, c, PlaceBuilding{IslandID: "main", Type: "sawmill", X: 14, Y: 2})
	mustApply(t, w, c, PlaceBuilding{IslandID: "main", Type: "house_settlers", X: 3, Y: 5, Rotation: 180})
	mustAdvance(t, w, c, 5*time.Second)

	before := encode(t, w)
	ds := display(t, w, c)
	if !bytes.Equal(before, encode(t, w)) {
		t.Error("Display mutated the world")
	}
	data, err := json.Marshal(ds)
	if err != nil {
		t.Fatal(err)
	}
	var doc map[string]any
	if err := json.Unmarshal(data, &doc); err != nil {
		t.Fatal(err)
	}
	requireKeys(t, "state", doc, "evaluated_at", "next_change_at", "gold", "islands")
	island := doc["islands"].([]any)[0].(map[string]any)
	requireKeys(t, "island", island, "id", "width", "height", "inventory", "roads", "buildings")
	requireKeys(t, "inventory", island["inventory"].(map[string]any)["wood"].(map[string]any), "stock", "capacity", "in_transit", "rate_per_min")
	common := []string{"id", "type", "x", "y", "rotation", "paused", "paused_reason", "status", "efficiency_permille", "throughput_factor_permille"}
	for _, b := range island["buildings"].([]any) {
		b := b.(map[string]any)
		requireKeys(t, b["type"].(string), b, common...)
		switch b["type"] {
		case "trading_post":
			requireKeys(t, "trading_post", b, "level", "capacity", "throughput_per_min", "load_permille")
		case "house_settlers":
			requireKeys(t, "house", b, "residents")
		default:
			requireKeys(t, b["type"].(string), b, "rates", "cycle_seconds", "cycle_progress_permille", "transfer_delay_ms", "assigned_warehouse_id", "road_distance")
		}
	}
	if ds.EvaluatedAt != "2026-01-01T00:00:05.000Z" {
		t.Errorf("evaluated_at = %s", ds.EvaluatedAt)
	}

	// next_change_at is the first boundary of the next Advance: wood starts
	// arriving at 10 s + 5 tiles (4,4)..(8,4) = 15 s.
	if ds.NextChangeAt == nil || *ds.NextChangeAt != "2026-01-01T00:00:15.000Z" {
		t.Fatalf("next_change_at = %v", ds.NextChangeAt)
	}
	bs := mustAdvance(t, w, c, time.Hour)
	if got := bs[0].At.Format(timeLayout); got != *ds.NextChangeAt {
		t.Errorf("first boundary %s != next_change_at %s", got, *ds.NextChangeAt)
	}

	// An idle world with only a warehouse never changes: the warehouse
	// cannot be paused and therefore has no upkeep.
	idle := testWorld(t, c)
	gold := idle.Gold
	if ds := display(t, idle, c); ds.NextChangeAt != nil || ds.BalanceRatePerMin != 0 {
		t.Errorf("idle next_change_at = %v balance %d", ds.NextChangeAt, ds.BalanceRatePerMin)
	}
	bs = mustAdvance(t, idle, c, 2500*time.Minute)
	if len(bs) != 0 || idle.Gold != gold || idle.GoldSub != 0 {
		t.Errorf("idle boundaries %+v gold %d", bs, idle.Gold)
	}
	// With the upkeep the warehouse had before it was folded into its
	// price (4 gold/min), the 10 000 gold run out after 2500 minutes; the
	// warehouse cannot be paused, so gold is then held at zero and nothing
	// changes any more (MECHANICS §7).
	lc := legacyUpkeep(c)
	held := testWorld(t, lc)
	if ds := display(t, held, lc); ds.NextChangeAt == nil || *ds.NextChangeAt != "2026-01-02T17:40:00.000Z" {
		t.Errorf("legacy idle next_change_at = %v", ds.NextChangeAt)
	}
	bs = mustAdvance(t, held, lc, 2500*time.Minute)
	if len(bs) != 1 || bs[0].Kind != BoundaryGoldZero || held.Gold != 0 || held.GoldSub != 0 {
		t.Errorf("legacy idle boundaries %+v gold %d", bs, held.Gold)
	}
	if ds := display(t, held, lc); ds.NextChangeAt != nil || ds.BalanceRatePerMin != -4_000 {
		t.Errorf("held idle world: next %v balance %d", ds.NextChangeAt, ds.BalanceRatePerMin)
	}
}

func requireKeys(t *testing.T, what string, m map[string]any, keys ...string) {
	t.Helper()
	for _, k := range keys {
		if _, ok := m[k]; !ok {
			t.Errorf("%s: missing %q", what, k)
		}
	}
}

// withFootprint returns a catalogue copy in which building id has the given
// footprint at rotation 0.
func withFootprint(base *content.Catalogue, id string, w, h int) *content.Catalogue {
	c := *base
	c.BuildingByID = maps.Clone(base.BuildingByID)
	def := *base.BuildingByID[id]
	def.Width, def.Height = w, h
	c.BuildingByID[id] = &def
	return &c
}

// TestRoadAdjacencyEveryEdge: a building is connected through a road on
// any tile 4-adjacent to any footprint tile, for every side and rotation; a
// road only diagonally next to a corner does not connect (D-042).
func TestRoadAdjacencyEveryEdge(t *testing.T) {
	c := withFootprint(catalogue(t), "sawmill", 3, 2)
	rows := make([]string, 20)
	for y := range rows {
		switch y {
		case 0, 19:
			rows[y] = strings.Repeat("~", 24)
		case 1:
			rows[y] = "~~~~~" + strings.Repeat("c", 18) + "~"
		default:
			rows[y] = "~" + strings.Repeat(".", 22) + "~"
		}
	}
	for _, rot := range []int{0, 90, 180, 270} {
		w := NewWorld(t0)
		w.Islands = []*Island{islandFromRows("main", rows...)}
		if err := PlaceFree(w, c, PlaceBuilding{IslandID: "main", Type: "trading_post", X: 1, Y: 0}, nil); err != nil {
			t.Fatal(err)
		}
		const bx, by = 10, 9
		fw, fh := footprint(c.BuildingByID["sawmill"], rot)
		// A ring of road two tiles around the footprint, linked to the
		// warehouse: it touches no footprint tile.
		var road []Pos
		for x := 2; x <= bx-2; x++ {
			road = append(road, Pos{x, 4})
		}
		for y := 5; y < by-2; y++ {
			road = append(road, Pos{bx - 2, y})
		}
		for x := bx - 2; x <= bx+fw+1; x++ {
			road = append(road, Pos{x, by - 2}, Pos{x, by + fh + 1})
		}
		for y := by - 1; y <= by+fh; y++ {
			road = append(road, Pos{bx - 2, y}, Pos{bx + fw + 1, y})
		}
		mustApply(t, w, c, PlaceRoad{IslandID: "main", Type: "road_dirt", Tiles: road})
		if err := PlaceFree(w, c, PlaceBuilding{IslandID: "main", Type: "sawmill", X: bx, Y: by, Rotation: rot}, nil); err != nil {
			t.Fatal(err)
		}
		if b := w.Islands[0].Building(2); b.AssignedWarehouseID != 0 {
			t.Fatalf("rotation %d: connected without an adjacent road", rot)
		}
		// Every tile of the one-tile frame around the footprint touches the
		// ring; the non-corner ones also touch the footprint.
		for y := by - 1; y <= by+fh; y++ {
			for x := bx - 1; x <= bx+fw; x++ {
				if x >= bx && x < bx+fw && y >= by && y < by+fh {
					continue
				}
				corner := (x == bx-1 || x == bx+fw) && (y == by-1 || y == by+fh)
				cw := w.Clone()
				mustApply(t, cw, c, PlaceRoad{IslandID: "main", Type: "road_dirt", Tiles: []Pos{{x, y}}})
				b := cw.Islands[0].Building(2)
				if connected := b.AssignedWarehouseID == 1; connected == corner {
					t.Errorf("rotation %d road (%d,%d): connected %v, corner %v", rot, x, y, connected, corner)
				}
				if !corner {
					if st := buildingDisplay(t, display(t, cw, c), 2).Status; st == StatusNotConnected {
						t.Errorf("rotation %d road (%d,%d): status %s", rot, x, y, st)
					}
				}
			}
		}
	}
}

// TestRoadDistanceOneSharedTile: one road tile touching the warehouse and
// the producer footprint gives d = 1 and a delay of 10 s + 1 s.
func TestRoadDistanceOneSharedTile(t *testing.T) {
	c := catalogue(t)
	w := NewWorld(t0)
	w.Islands = []*Island{islandFromRows("main",
		"~~~~~~~~~~~~",
		"~~~~~......~",
		"~..........~",
		"~..........~",
		"~..........~",
		"~~~~~~~~~~~~",
	)}
	if err := PlaceFree(w, c, PlaceBuilding{IslandID: "main", Type: "trading_post", X: 1, Y: 0}, nil); err != nil {
		t.Fatal(err)
	}
	// (5,3) touches the Trading Post (x 1..4, y 0..3) and the sawmill
	// (x 6..7, y 2..3).
	mustApply(t, w, c, PlaceRoad{IslandID: "main", Type: "road_dirt", Tiles: []Pos{{5, 3}}})
	if err := PlaceFree(w, c, PlaceBuilding{IslandID: "main", Type: "sawmill", X: 6, Y: 2}, nil); err != nil {
		t.Fatal(err)
	}
	if b := w.Islands[0].Building(2); b.AssignedWarehouseID != 1 || b.RoadDistance != 1 || b.TransferDelayMs != 11_000 {
		t.Errorf("sawmill = %+v", b)
	}
}

// TestPlaceWithoutRoad: placement never requires a road; the building is
// not_connected until a road reaches any footprint edge.
func TestPlaceWithoutRoad(t *testing.T) {
	c := catalogue(t)
	w := testWorld(t, c)
	gold := w.Gold
	mustApply(t, w, c, PlaceBuilding{IslandID: "main", Type: "sawmill", X: 14, Y: 6})
	if w.Gold != gold-80_000 {
		t.Errorf("gold = %d, want charged", w.Gold)
	}
	b := buildingDisplay(t, display(t, w, c), 2)
	if b.Status != StatusNotConnected || *b.AssignedWarehouseID != 0 {
		t.Fatalf("sawmill = %s assigned %d", b.Status, *b.AssignedWarehouseID)
	}
	// (16,6) touches the east edge of the footprint (x 14..15, y 6..7).
	mustApply(t, w, c, PlaceRoad{IslandID: "main", Type: "road_dirt", Tiles: []Pos{{16, 5}, {16, 6}}})
	if b := buildingDisplay(t, display(t, w, c), 2); b.Status == StatusNotConnected || *b.AssignedWarehouseID != 1 {
		t.Errorf("after road: %s assigned %d", b.Status, *b.AssignedWarehouseID)
	}
}

func TestMoveBuildingErrorsLeaveWorldUnchanged(t *testing.T) {
	c := catalogue(t)
	setup := func(t *testing.T) *World {
		w := testWorld(t, c)
		mustApply(t, w, c, PlaceBuilding{IslandID: "main", Type: "lumberjack", X: 8, Y: 2}) // ID 2
		mustApply(t, w, c, PlaceBuilding{IslandID: "main", Type: "sawmill", X: 14, Y: 2})   // ID 3
		return w
	}
	tests := []struct {
		name string
		cmd  MoveBuilding
		want error
	}{
		{"unknown island", MoveBuilding{IslandID: "x", BuildingID: 3, X: 14, Y: 5}, ErrUnknownIsland},
		{"missing building", MoveBuilding{IslandID: "main", BuildingID: 99, X: 14, Y: 5}, ErrBuildingNotFound},
		{"bad rotation", MoveBuilding{IslandID: "main", BuildingID: 3, X: 14, Y: 5, Rotation: 45}, ErrInvalidCommand},
		{"out of bounds", MoveBuilding{IslandID: "main", BuildingID: 3, X: 19, Y: 5}, ErrOutOfBounds},
		{"max x", MoveBuilding{IslandID: "main", BuildingID: 3, X: math.MaxInt, Y: 5}, ErrOutOfBounds},
		{"max y", MoveBuilding{IslandID: "main", BuildingID: 3, X: 14, Y: math.MaxInt}, ErrOutOfBounds},
		{"max x rotated", MoveBuilding{IslandID: "main", BuildingID: 3, X: math.MaxInt - 1, Y: 5, Rotation: 90}, ErrOutOfBounds},
		{"min x", MoveBuilding{IslandID: "main", BuildingID: 3, X: math.MinInt, Y: 5}, ErrOutOfBounds},
		{"min y", MoveBuilding{IslandID: "main", BuildingID: 3, X: 14, Y: math.MinInt}, ErrOutOfBounds},
		{"terrain", MoveBuilding{IslandID: "main", BuildingID: 3, X: 17, Y: 2}, ErrTerrain},
		{"occupied by building", MoveBuilding{IslandID: "main", BuildingID: 3, X: 9, Y: 2}, ErrOccupied},
		{"occupied by road", MoveBuilding{IslandID: "main", BuildingID: 3, X: 14, Y: 3}, ErrOccupied},
		{"trading post not on water", MoveBuilding{IslandID: "main", BuildingID: 1, X: 1, Y: 5}, ErrNotOnWater},
		{"no work area", MoveBuilding{IslandID: "main", BuildingID: 2, X: 16, Y: 7}, ErrNoWorkArea},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			w := setup(t)
			before := encode(t, w)
			if err := Apply(w, c, tt.cmd); !errors.Is(err, tt.want) {
				t.Fatalf("err = %v, want %v", err, tt.want)
			}
			if !bytes.Equal(before, encode(t, w)) {
				t.Error("world changed on error")
			}
		})
	}
	t.Run("road definition", func(t *testing.T) {
		// Roads are tiles without an ID; a building record with a road type
		// is rejected defensively.
		w := setup(t)
		w.Islands[0].Buildings = append(w.Islands[0].Buildings, &Building{ID: 50, Type: "road_dirt", X: 1, Y: 7, Efficiency: 1000})
		before := encode(t, w)
		if err := Apply(w, c, MoveBuilding{IslandID: "main", BuildingID: 50, X: 2, Y: 7}); !errors.Is(err, ErrInvalidCommand) {
			t.Fatalf("err = %v", err)
		}
		if !bytes.Equal(before, encode(t, w)) {
			t.Error("world changed on error")
		}
	})
}

// TestMoveBuildingKeepsState: a one-tile shift overlapping the old footprint
// is valid; ID, progress and transit are kept, nothing is charged, and the
// road distance is recomputed. Goods in transit still arrive.
func TestMoveBuildingKeepsState(t *testing.T) {
	c := catalogue(t)
	w := testWorld(t, c)
	mustApply(t, w, c, PlaceBuilding{IslandID: "main", Type: "lumberjack", X: 8, Y: 2})
	mustAdvance(t, w, c, 37*time.Second+500*time.Millisecond)
	is := w.Islands[0]
	b := is.Building(2)
	progress, transit := b.Progress, append([]TransitSegment(nil), b.Transit...)
	now := w.LastEvaluatedAt.UnixMilli()
	inTransit := transitFine(is, "wood", now)
	gold, goldSub, stock, next := w.Gold, w.GoldSub, maps.Clone(is.Inventory.Stock), w.NextBuildingID
	if progress == 0 || inTransit == 0 || b.RoadDistance != 5 {
		t.Fatalf("setup: progress %d transit %d distance %d", progress, inTransit, b.RoadDistance)
	}

	l := NewLedger()
	if err := ApplyWithLedger(w, c, MoveBuilding{IslandID: "main", BuildingID: 2, X: 9, Y: 2, Rotation: 90}, l); err != nil {
		t.Fatal(err)
	}
	if is.Building(2) != b || b.X != 9 || b.Y != 2 || b.Rotation != 90 || b.Progress != progress || !slices.Equal(b.Transit, transit) {
		t.Errorf("moved = %+v", b)
	}
	if w.Gold != gold || w.GoldSub != goldSub || !maps.Equal(is.Inventory.Stock, stock) || w.NextBuildingID != next {
		t.Errorf("move charged or changed stock: gold %d stock %v next %d", w.Gold, is.Inventory.Stock, w.NextBuildingID)
	}
	if len(l.Islands) != 0 {
		t.Errorf("ledger = %+v", l.Islands)
	}
	// Footprint x 9..10: road (9,4) is 6 tiles from (4,4).
	if b.AssignedWarehouseID != 1 || b.RoadDistance != 6 || b.TransferDelayMs != 16_000 {
		t.Errorf("connection = %d d %d delay %d", b.AssignedWarehouseID, b.RoadDistance, b.TransferDelayMs)
	}
	stockBefore := is.Inventory.fine("wood")
	mustAdvance(t, w, c, 30*time.Second)
	if got := is.Inventory.fine("wood"); got < stockBefore+inTransit {
		t.Errorf("wood stock %d, want >= %d + %d in transit", got, stockBefore, inTransit)
	}

	// Moving to the identical position and rotation is a valid no-op.
	before := encode(t, w)
	mustApply(t, w, c, MoveBuilding{IslandID: "main", BuildingID: 2, X: 9, Y: 2, Rotation: 90})
	cw, _, _, err := Decode(before, nil)
	if err != nil {
		t.Fatal(err)
	}
	clearRegimes(cw.Islands[0])
	if !bytes.Equal(encode(t, cw), encode(t, w)) {
		t.Error("no-op move changed the world")
	}
}

// TestMoveZeroEfficiencyInPlace: a work-area building whose efficiency has
// dropped to 0 (its forest covered by roads) can still be "moved" to its
// identical position and rotation (a no-op) and turned on the same
// footprint; a different position is still checked.
func TestMoveZeroEfficiencyInPlace(t *testing.T) {
	c := catalogue(t)
	w := testWorld(t, c)
	mustApply(t, w, c, PlaceBuilding{IslandID: "main", Type: "lumberjack", X: 8, Y: 2})
	is := w.Islands[0]
	occ := is.occupancy(c)
	var road []Pos
	for y := range is.Height {
		for x := range is.Width {
			i := is.index(x, y)
			if is.Tiles[i].Terrain == content.TerrainForest && occ[i] == 0 && is.Roads[i] == "" {
				road = append(road, Pos{x, y})
			}
		}
	}
	mustApply(t, w, c, PlaceRoad{IslandID: "main", Type: "road_dirt", Tiles: road})
	b := is.Building(2)
	if b.Efficiency != 0 {
		t.Fatalf("efficiency = %d, want 0", b.Efficiency)
	}
	before := encode(t, w)
	mustApply(t, w, c, MoveBuilding{IslandID: "main", BuildingID: 2, X: 8, Y: 2})
	if !bytes.Equal(before, encode(t, w)) {
		t.Error("identical-position move changed the world")
	}
	// Same footprint rectangle, other rotation (2x2): allowed, still 0.
	mustApply(t, w, c, MoveBuilding{IslandID: "main", BuildingID: 2, X: 8, Y: 2, Rotation: 180})
	if b.Rotation != 180 || b.Efficiency != 0 || b.X != 8 || b.Y != 2 {
		t.Errorf("rotated in place = %+v", b)
	}
	before = encode(t, w)
	if err := Apply(w, c, MoveBuilding{IslandID: "main", BuildingID: 2, X: 15, Y: 6}); !errors.Is(err, ErrNoWorkArea) {
		t.Fatalf("move elsewhere at zero efficiency: %v", err)
	}
	if !bytes.Equal(before, encode(t, w)) {
		t.Error("world changed on error")
	}
}

// TestMoveBuildingKeepsBuffer: an unconnected producer keeps its buffer
// when moved; once a road reaches it the buffer leaves with its output.
func TestMoveBuildingKeepsBuffer(t *testing.T) {
	c := catalogue(t)
	w := testWorld(t, c)
	b := unconnectedLumberjack(t, w, c)
	buf := maps.Clone(b.Buffer)
	mustApply(t, w, c, MoveBuilding{IslandID: "main", BuildingID: b.ID, X: 11, Y: 6})
	if !maps.Equal(b.Buffer, buf) || b.AssignedWarehouseID != 0 {
		t.Errorf("buffer %v assigned %d", b.Buffer, b.AssignedWarehouseID)
	}
	// Back next to the road stub at y=8, still unconnected.
	mustApply(t, w, c, MoveBuilding{IslandID: "main", BuildingID: b.ID, X: 9, Y: 6})
	mustApply(t, w, c, connectRoad)
	if b.AssignedWarehouseID != 1 || !maps.Equal(b.Buffer, buf) {
		t.Errorf("after connect: assigned %d buffer %v", b.AssignedWarehouseID, b.Buffer)
	}
}

// TestMoveWarehouseReassignsProducers: moving a Warehouse closer to a
// producer re-assigns it from the Trading Post by the normal rule
// (nearest collector); capacity and stock are unchanged.
func TestMoveWarehouseReassignsProducers(t *testing.T) {
	c := catalogue(t)
	w := NewWorld(t0)
	w.Islands = []*Island{islandFromRows("main",
		"~~~~~~~~~~~~~~~~~~~~~~~~~~",
		"~~~~~cccccccccccccccccccc~",
		"~........................~",
		"~........................~",
		"~........................~",
		"~........................~",
		"~~~~~~~~~~~~~~~~~~~~~~~~~~",
	)}
	if err := PlaceFree(w, c, PlaceBuilding{IslandID: "main", Type: "trading_post", X: 1, Y: 0}, nil); err != nil {
		t.Fatal(err)
	}
	if err := PlaceFree(w, c, PlaceBuilding{IslandID: "main", Type: "warehouse", X: 20, Y: 2}, nil); err != nil {
		t.Fatal(err)
	}
	var road []Pos
	for x := 1; x <= 24; x++ {
		road = append(road, Pos{x, 4})
	}
	mustApply(t, w, c, PlaceRoad{IslandID: "main", Type: "road_dirt", Tiles: road})
	if err := AddStock(w, c, "main", "planks", 100_000, nil); err != nil {
		t.Fatal(err)
	}
	if err := PlaceFree(w, c, PlaceBuilding{IslandID: "main", Type: "sawmill", X: 8, Y: 2}, nil); err != nil {
		t.Fatal(err)
	}
	is := w.Islands[0]
	sm := is.Building(3)
	if sm.AssignedWarehouseID != 1 || sm.RoadDistance != 5 {
		t.Fatalf("before: %+v", sm)
	}
	capBefore, stock := capacityFine(is, c), maps.Clone(is.Inventory.Stock)
	mustApply(t, w, c, MoveBuilding{IslandID: "main", BuildingID: 2, X: 10, Y: 2})
	if sm.AssignedWarehouseID != 2 || sm.RoadDistance != 2 {
		t.Errorf("after: assigned %d distance %d", sm.AssignedWarehouseID, sm.RoadDistance)
	}
	if capacityFine(is, c) != capBefore || !maps.Equal(is.Inventory.Stock, stock) {
		t.Error("warehouse move changed capacity or stock")
	}
}

// TestFullWithConsumer: a full good with ongoing consumption limits its
// producers to the consumption rate instead of oscillating between stop and
// resume (no Zeno boundaries).
func TestFullWithConsumer(t *testing.T) {
	c := catalogue(t)
	w := testWorld(t, c)
	mustApply(t, w, c, PlaceBuilding{IslandID: "main", Type: "lumberjack", X: 8, Y: 2})
	mustApply(t, w, c, PlaceBuilding{IslandID: "main", Type: "lumberjack", X: 10, Y: 2})
	mustApply(t, w, c, PlaceBuilding{IslandID: "main", Type: "sawmill", X: 14, Y: 2})
	w.Islands[0].Inventory.setFine("planks", 0) // keep planks far from capacity
	if err := AddStock(w, c, "main", "wood", 299_000, nil); err != nil {
		t.Fatal(err)
	}
	bs := mustAdvance(t, w, c, time.Hour)
	if len(bs) > 20 {
		t.Errorf("%d boundaries in one hour: %+v", len(bs), bs)
	}
	ds := display(t, w, c)
	var total Qty
	for _, id := range []int64{2, 3} {
		b := buildingDisplay(t, ds, id)
		if b.Status != StatusWarehouseFull {
			t.Errorf("lumberjack %d status %s", id, b.Status)
		}
		total += b.Rates.Outputs["wood"]
	}
	sm := buildingDisplay(t, ds, 4)
	if sm.Status != StatusOK || sm.Rates.Inputs["wood"] != 2000 {
		t.Errorf("sawmill = %s %+v", sm.Status, sm.Rates)
	}
	if total > 2000 || total < 1999 {
		t.Errorf("lumberjacks produce %d/min, want the consumption of 2000/min", total)
	}
	// Rounding the producer rates down lets stock + in-transit drift below
	// the capacity by a few milli-units per hour; it never exceeds it.
	wood := ds.Islands[0].Inventory["wood"]
	if c := wood.Stock + wood.InTransit; c > wood.Capacity || c < wood.Capacity-50 {
		t.Errorf("wood = %+v, want committed at capacity", wood)
	}
}

func TestAddStockRejectsOversizedGrants(t *testing.T) {
	c := catalogue(t)
	w := testWorld(t, c) // 200 planks, capacity 300
	for _, qty := range []Qty{math.MaxInt64, math.MaxInt64 / SubPerMilli, 100_001} {
		before := encode(t, w)
		if err := AddStock(w, c, "main", "planks", qty, nil); !errors.Is(err, ErrOverCapacity) {
			t.Errorf("AddStock(%d) = %v, want ErrOverCapacity", qty, err)
		}
		if !bytes.Equal(before, encode(t, w)) {
			t.Errorf("AddStock(%d) changed the world", qty)
		}
	}
	if err := AddStock(w, c, "main", "planks", 100_000, nil); err != nil {
		t.Errorf("AddStock up to capacity: %v", err)
	}
	if got := w.Islands[0].Inventory.Stock["planks"]; got != 300_000 {
		t.Errorf("planks = %d", got)
	}
}

// TestThroughputSharedOnlyAmongRunningProducers: producers stopped because
// their chain is blocked downstream (planks full -> sawmill stopped -> wood
// full -> lumberjack stopped) do not count towards the warehouse load.
func TestThroughputSharedOnlyAmongRunningProducers(t *testing.T) {
	base := catalogue(t)
	whDef := *base.BuildingByID["trading_post"]
	wh := *whDef.TradingPost
	wh.Levels = []content.TradingPostLevel{{Capacity: 300_000, ThroughputPerMin: 3_000, Berths: 1}}
	whDef.TradingPost = &wh
	c := *base
	c.BuildingByID = maps.Clone(base.BuildingByID)
	c.BuildingByID["trading_post"] = &whDef

	w := testWorld(t, &c)
	mustApply(t, w, &c, PlaceBuilding{IslandID: "main", Type: "lumberjack", X: 8, Y: 2})
	mustApply(t, w, &c, PlaceBuilding{IslandID: "main", Type: "sawmill", X: 14, Y: 2})
	mustApply(t, w, &c, PlaceBuilding{IslandID: "main", Type: "fisher", X: 16, Y: 2})
	for _, good := range []string{"wood", "planks"} {
		free := 300_000 - w.Islands[0].Inventory.Stock[good]
		if err := AddStock(w, &c, "main", good, free, nil); err != nil {
			t.Fatal(err)
		}
	}
	mustAdvance(t, w, &c, 10*time.Minute)

	ds := display(t, w, &c)
	for _, id := range []int64{2, 3} {
		if b := buildingDisplay(t, ds, id); b.Status != StatusWarehouseFull {
			t.Errorf("%s status = %s", b.Type, b.Status)
		}
	}
	fisher := buildingDisplay(t, ds, 4)
	if fisher.Status != StatusOK || fisher.ThroughputFactorPermille != 1000 || fisher.Rates.Outputs["fish"] != 1500 {
		t.Errorf("fisher = %s factor %d rate %d", fisher.Status, fisher.ThroughputFactorPermille, fisher.Rates.Outputs["fish"])
	}
	if load := *buildingDisplay(t, ds, 1).LoadPermille; load != 500 {
		t.Errorf("warehouse load = %d, want 500", load)
	}
}
