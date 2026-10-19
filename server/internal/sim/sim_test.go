package sim

import (
	"bytes"
	"encoding/json"
	"errors"
	"maps"
	"math"
	"path/filepath"
	"runtime"
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

func catalogue(t testing.TB) *content.Catalogue {
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

// prodCatalogue returns the shipped catalogue without workforce blocks, for
// tests of the production and logistics rules that run without houses.
func prodCatalogue(t testing.TB) *content.Catalogue {
	t.Helper()
	base := catalogue(t)
	c := *base
	c.BuildingByID = maps.Clone(base.BuildingByID)
	c.Buildings = nil
	for _, b := range base.Buildings {
		nb := *b
		nb.Workforce = nil
		c.Buildings = append(c.Buildings, &nb)
		c.BuildingByID[nb.ID] = &nb
	}
	return &c
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

// testWorld is a 20x10 island with a seeded warehouse at (1,1) whose
// entrance (2,3) touches a road row y=4 from x=2 to x=17, plenty of gold and
// planks.
func testWorld(t testing.TB, c *content.Catalogue) *World {
	t.Helper()
	w := NewWorld(t0)
	w.Islands = []*Island{islandFromRows("main",
		"~~~~~~~~~~~~~~~~~~~~",
		"~ccccffffffffcccccm~",
		"~....ffffffffcccccm~",
		"~....ffffffff.....m~",
		"~..................~",
		"~....ffffffff......~",
		"~....ffffffff......~",
		"~..................~",
		"~..................~",
		"~~~~~~~~~~~~~~~~~~~~",
	)}
	if err := PlaceFree(w, c, PlaceBuilding{IslandID: "main", Type: "warehouse", X: 1, Y: 1}, nil); err != nil {
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
	if err := Apply(w, c, PlaceRoad{IslandID: "main", Type: "road_dirt", Tiles: road}); err != nil {
		t.Fatal(err)
	}
	return w
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
	w2, cv, err := Decode(first)
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
	if !strings.Contains(string(first), `"schema_version":1`) || !strings.Contains(string(first), `"last_evaluated_at":"2026-01-01T00:00:37.123Z"`) {
		t.Errorf("unexpected envelope: %s", first[:200])
	}
}

func TestDecodeRejectsSchemaVersion(t *testing.T) {
	for _, v := range []int{0, 2} {
		data, _ := json.Marshal(map[string]any{"schema_version": v, "content_version": "x", "world": map[string]any{}})
		if _, _, err := Decode(data); !errors.Is(err, ErrSchemaVersion) {
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
		{"water", PlaceBuilding{IslandID: "main", Type: "sawmill", X: 14, Y: 0}, ErrTerrain},
		{"mountain", PlaceBuilding{IslandID: "main", Type: "sawmill", X: 17, Y: 2}, ErrTerrain},
		{"occupied by building", PlaceBuilding{IslandID: "main", Type: "sawmill", X: 3, Y: 2}, ErrOccupied},
		{"occupied by road", PlaceBuilding{IslandID: "main", Type: "sawmill", X: 14, Y: 3}, ErrOccupied},
		{"not coastal", PlaceBuilding{IslandID: "main", Type: "fisher", X: 14, Y: 5}, ErrNotCoastal},
		{"no road at entrance", PlaceBuilding{IslandID: "main", Type: "sawmill", X: 14, Y: 6}, ErrNoRoadAtEntrance},
		{"no work area", PlaceBuilding{IslandID: "main", Type: "lumberjack", X: 16, Y: 2}, ErrNoWorkArea},
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
	b := w.Islands[0].Building(2)
	if b == nil || b.ID != 2 || w.NextBuildingID != 3 || b.AssignedWarehouseID != 1 || b.RoadDistance != 13 || b.TransferDelayMs != 23_000 {
		t.Errorf("building = %+v next %d", b, w.NextBuildingID)
	}
}

func TestPlaceZeroCostRoadWithEmptyInventoryAndNoGold(t *testing.T) {
	c := catalogue(t)
	w := NewWorld(t0)
	w.Islands = []*Island{islandFromRows("main", "....", "....")}
	mustApply(t, w, c, PlaceRoad{IslandID: "main", Type: "road_dirt", Tiles: []Pos{{0, 0}, {1, 0}}})
	mustApply(t, w, c, PlaceBuilding{IslandID: "main", Type: "road_dirt", X: 2, Y: 0})
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
	c := prodCatalogue(t)
	w := testWorld(t, c)
	mustApply(t, w, c, PlaceBuilding{IslandID: "main", Type: "fisher", X: 14, Y: 2})
	mustAdvance(t, w, c, time.Minute)
	if err := Apply(w, c, Demolish{IslandID: "main", BuildingID: 1}); !errors.Is(err, ErrSurplusLoss) {
		t.Fatalf("err = %v", err)
	}
	l := NewLedger()
	planks := w.Islands[0].Inventory.fine("planks")
	fish := committedFine(w.Islands[0], "fish", w.LastEvaluatedAt.UnixMilli())
	if err := ApplyWithLedger(w, c, Demolish{IslandID: "main", BuildingID: 1, AcceptSurplusLoss: true}, l); err != nil {
		t.Fatal(err)
	}
	is := w.Islands[0]
	if is.Inventory.Stock != nil || transitFine(is, "fish", w.LastEvaluatedAt.UnixMilli()) != 0 {
		t.Errorf("stock %v after losing the only warehouse", is.Inventory.Stock)
	}
	// Planks: stock lost plus the whole refund (no capacity left).
	if f := l.Flow("main", "planks"); f.Lost != planks+15_000*SubPerMilli {
		t.Errorf("planks flow = %+v", f)
	}
	if f := l.Flow("main", "fish"); f.Lost != fish {
		t.Errorf("fish flow = %+v, want lost %d", f, fish)
	}
	if b := is.Building(2); b.AssignedWarehouseID != 0 {
		t.Error("fisher still connected")
	}
}

func TestPauseAndResume(t *testing.T) {
	c := prodCatalogue(t)
	w := testWorld(t, c)
	mustApply(t, w, c, PlaceBuilding{IslandID: "main", Type: "fisher", X: 14, Y: 2})
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
	c := prodCatalogue(t)
	w := NewWorld(t0)
	// Lumberjack with 18 forest tiles: efficiency 750 -> 1.5 wood/min.
	w.Islands = []*Island{islandFromRows("main",
		"~~~~~~~~~~~~~~~~~~~~",
		"~cccc...............",
		"~.......ffffff......",
		"~.......ffffff......",
		"~...................",
		"~.......ffffff......",
		"~.......ffffff......",
		"~...................",
	)}
	if err := PlaceFree(w, c, PlaceBuilding{IslandID: "main", Type: "warehouse", X: 1, Y: 1}, nil); err != nil {
		t.Fatal(err)
	}
	w.Gold = 1_000_000
	if err := AddStock(w, c, "main", "planks", 100_000, nil); err != nil {
		t.Fatal(err)
	}
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
	c := prodCatalogue(t)
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

// unconnectedLumberjack places a lumberjack on its own road piece below the
// main road of testWorld, runs it until its buffer is full and returns it.
func unconnectedLumberjack(t *testing.T, w *World, c *content.Catalogue) *Building {
	t.Helper()
	mustApply(t, w, c, PlaceRoad{IslandID: "main", Type: "road_dirt", Tiles: []Pos{{9, 7}, {10, 7}}})
	mustApply(t, w, c, PlaceBuilding{IslandID: "main", Type: "lumberjack", X: 9, Y: 5, Rotation: 0})
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
var connectRoad = PlaceRoad{IslandID: "main", Type: "road_dirt", Tiles: []Pos{{8, 5}, {8, 6}, {8, 7}}}

func woodTotal(w *World) int64 {
	return total(w.Islands[0], "wood", w.LastEvaluatedAt.UnixMilli())
}

// TestBufferLeavesWithOutputStreamOnConnect: after connecting, the buffered
// goods leave first with the producer's output stream; nothing is lost.
func TestBufferLeavesWithOutputStreamOnConnect(t *testing.T) {
	c := prodCatalogue(t)
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
	c := prodCatalogue(t)
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
	c := prodCatalogue(t)
	w := testWorld(t, c)
	if _, err := Advance(w, c, t0.Add(-time.Millisecond)); !errors.Is(err, ErrTimeBackwards) {
		t.Errorf("err = %v", err)
	}
	before := encode(t, w)
	if bs, err := Advance(w, c, t0); err != nil || bs != nil || !bytes.Equal(before, encode(t, w)) {
		t.Errorf("no-op advance changed the world: %v %v", bs, err)
	}
	mustApply(t, w, c, PlaceBuilding{IslandID: "main", Type: "fisher", X: 14, Y: 2})
	gold := w.Gold
	mustAdvance(t, w, c, 2*time.Hour)
	// Upkeep of warehouse (4/min) and fisher (1/min), no houses, no taxes.
	if want := gold - 120*5_000; w.Gold != want || w.GoldSub != 0 {
		t.Errorf("gold after 2h = %d (sub %d), want %d", w.Gold, w.GoldSub, want)
	}
	if _, err := Display(w, c, w.LastEvaluatedAt.Add(time.Second)); !errors.Is(err, ErrDisplayTime) {
		t.Errorf("Display at another time: %v", err)
	}
}

func TestIterationCapFallback(t *testing.T) {
	base := prodCatalogue(t)
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
	c := prodCatalogue(t)
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
	common := []string{"id", "type", "x", "y", "rotation", "entrance", "paused", "paused_reason", "status", "efficiency_permille", "throughput_factor_permille"}
	for _, b := range island["buildings"].([]any) {
		b := b.(map[string]any)
		requireKeys(t, b["type"].(string), b, common...)
		switch b["type"] {
		case "warehouse":
			requireKeys(t, "warehouse", b, "level", "capacity", "throughput_per_min", "load_permille")
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
	// arriving at 10 s + 7 tiles = 17 s.
	if ds.NextChangeAt == nil || *ds.NextChangeAt != "2026-01-01T00:00:17.000Z" {
		t.Fatalf("next_change_at = %v", ds.NextChangeAt)
	}
	bs := mustAdvance(t, w, c, time.Hour)
	if got := bs[0].At.Format(timeLayout); got != *ds.NextChangeAt {
		t.Errorf("first boundary %s != next_change_at %s", got, *ds.NextChangeAt)
	}

	// An idle world only changes when the warehouse upkeep (4 gold/min)
	// has used up the 10 000 gold: gold_zero after 2500 minutes. The
	// warehouse cannot be paused, so gold is then held at zero and nothing
	// changes any more.
	idle := testWorld(t, c)
	if ds := display(t, idle, c); ds.NextChangeAt == nil || *ds.NextChangeAt != "2026-01-02T17:40:00.000Z" {
		t.Errorf("idle next_change_at = %v", ds.NextChangeAt)
	}
	bs = mustAdvance(t, idle, c, 2500*time.Minute)
	if len(bs) != 1 || bs[0].Kind != BoundaryGoldZero || idle.Gold != 0 || idle.GoldSub != 0 {
		t.Errorf("idle boundaries %+v gold %d", bs, idle.Gold)
	}
	if ds := display(t, idle, c); ds.NextChangeAt != nil || ds.BalanceRatePerMin != -4_000 {
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

func TestEntranceRule(t *testing.T) {
	def := &content.Building{Width: 3, Height: 2}
	tests := []struct {
		rot  int
		want Pos
	}{
		{0, Pos{11, 21}},  // 3x2: bottom edge, middle
		{90, Pos{10, 21}}, // 2x3: west edge, middle
		{180, Pos{11, 20}},
		{270, Pos{11, 21}},
	}
	for _, tt := range tests {
		if got := entrance(def, 10, 20, tt.rot); got != tt.want {
			t.Errorf("rotation %d: entrance = %v, want %v", tt.rot, got, tt.want)
		}
	}
	def = &content.Building{Width: 2, Height: 2}
	if got := entrance(def, 0, 0, 0); got != (Pos{0, 1}) {
		t.Errorf("2x2 rot 0 = %v", got)
	}
	if got := entrance(def, 0, 0, 180); got != (Pos{1, 0}) {
		t.Errorf("2x2 rot 180 = %v", got)
	}
}

// TestFullWithConsumer: a full good with ongoing consumption limits its
// producers to the consumption rate instead of oscillating between stop and
// resume (no Zeno boundaries).
func TestFullWithConsumer(t *testing.T) {
	c := prodCatalogue(t)
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
	base := prodCatalogue(t)
	whDef := *base.BuildingByID["warehouse"]
	wh := *whDef.Warehouse
	wh.Levels = []content.WarehouseLevel{{Capacity: 300_000, ThroughputPerMin: 3_000}}
	whDef.Warehouse = &wh
	c := *base
	c.BuildingByID = maps.Clone(base.BuildingByID)
	c.BuildingByID["warehouse"] = &whDef

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
