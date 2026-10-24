package sim

import (
	"maps"
	"path/filepath"
	"testing"

	"github.com/ricoberger/new-shores/server/internal/content"
)

// fieldsWorld is a 24x14 grass island with a coast row, a warehouse at
// (1,1), a road along y=4 (x 2..22), a forest patch at x 4..6, y 8..9, a
// mountain tile at (20,10), and a sheep farm at (8,5) (footprint x 8..10,
// y 5..7, connected to the road), workers, gold and planks.
func fieldsWorld(t *testing.T, c *content.Catalogue) (*World, int64) {
	t.Helper()
	w := NewWorld(t0)
	w.Islands = []*Island{islandFromRows("main",
		"~~~~~~~~~~~~~~~~~~~~~~~~",
		"~~~~~cccccccccccccccccc~",
		"~......................~",
		"~......................~",
		"~......................~",
		"~......................~",
		"~......................~",
		"~......................~",
		"~...fff................~",
		"~...fff................~",
		"~...................m..~",
		"~......................~",
		"~......................~",
		"~~~~~~~~~~~~~~~~~~~~~~~~",
	)}
	if err := PlaceFree(w, c, PlaceBuilding{IslandID: "main", Type: "trading_post", X: 1, Y: 0}, nil); err != nil {
		t.Fatal(err)
	}
	w.Gold = 10_000_000
	if err := AddStock(w, c, "main", "planks", 200_000, nil); err != nil {
		t.Fatal(err)
	}
	grantWorkers(t, w, c)
	var road []Pos
	for x := 2; x <= 22; x++ {
		road = append(road, Pos{x, 4})
	}
	mustApply(t, w, c, PlaceRoad{IslandID: "main", Type: "road_dirt", Tiles: road})
	farm := w.NextBuildingID
	mustApply(t, w, c, PlaceBuilding{IslandID: "main", Type: "sheep_farm", X: 8, Y: 5})
	return w, farm
}

// validTiles returns the valid field tiles of fieldType on the first
// island in row-major order.
func validTiles(w *World, c *content.Catalogue, fieldType string) []Pos {
	is := w.Islands[0]
	var cand []Pos
	for y := range is.Height {
		for x := range is.Width {
			cand = append(cand, Pos{x, y})
		}
	}
	return ValidFieldTiles(is, c, fieldType, cand)
}

func fieldDisplay(t *testing.T, w *World, c *content.Catalogue, id int64) BuildingDisplay {
	t.Helper()
	ds, err := Display(w, c, w.LastEvaluatedAt)
	if err != nil {
		t.Fatal(err)
	}
	for _, is := range ds.Islands {
		for _, b := range is.Buildings {
			if b.ID == id {
				return b
			}
		}
	}
	t.Fatalf("building %d not displayed", id)
	return BuildingDisplay{}
}

// TestFieldEfficiency (R-9, R-12): a farm starts at 0 fields with
// efficiency 0 and status low_efficiency; 8 of 16 fields give 500, 16
// give 1000 and status ok, more stay at 1000. Fields display their farm.
func TestFieldEfficiency(t *testing.T) {
	c := catalogue(t)
	w, farm := fieldsWorld(t, c)
	fd := fieldDisplay(t, w, c, farm)
	if fd.EfficiencyPermille != 0 || fd.Status != StatusLowEfficiency || fd.Fields == nil || *fd.Fields != (FieldsDisplay{0, 16}) || fd.FarmID != nil {
		t.Fatalf("farm without fields: %+v %+v", fd, fd.Fields)
	}
	if fd.Rates.Outputs["wool"] != 0 {
		t.Errorf("wool rate %d without fields", fd.Rates.Outputs["wool"])
	}
	tiles := validTiles(w, c, "pasture")
	if len(tiles) < 20 {
		t.Fatalf("only %d valid pasture tiles", len(tiles))
	}
	for _, step := range []struct {
		n    int
		eff  int64
		stat string
	}{{8, 500, StatusLowEfficiency}, {16, 1000, StatusOK}, {20, 1000, StatusOK}} {
		have := len(fieldsOf(w, c))
		mustApply(t, w, c, PlaceFields{IslandID: "main", Type: "pasture", Tiles: tiles[have:step.n]})
		fd := fieldDisplay(t, w, c, farm)
		if fd.EfficiencyPermille != step.eff || fd.Status != step.stat || *fd.Fields != (FieldsDisplay{step.n, 16}) {
			t.Errorf("%d fields: efficiency %d status %s fields %+v", step.n, fd.EfficiencyPermille, fd.Status, fd.Fields)
		}
	}
	for _, f := range fieldsOf(w, c) {
		d := fieldDisplay(t, w, c, f.ID)
		if d.FarmID == nil || *d.FarmID != farm || d.Status != StatusOK || d.Fields != nil || d.Rates != nil || d.AssignedWarehouseID != nil || d.Residents != nil {
			t.Errorf("field %d display %+v", f.ID, d)
		}
	}
	// Sequential IDs in tile order.
	fs := fieldsOf(w, c)
	for i, f := range fs {
		if f.X != tiles[i].X || f.Y != tiles[i].Y || (i > 0 && f.ID != fs[i-1].ID+1) {
			t.Fatalf("field %d = %+v", i, f)
		}
	}
	// A field cannot be paused, has no upkeep and never needs a road.
	expectApplyErr(t, w, c, SetPaused{IslandID: "main", BuildingID: fs[0].ID, Paused: true}, ErrNotPausable)
	ds, _ := Display(w, c, w.LastEvaluatedAt)
	if ds.UpkeepRatePerMin != c.BuildingByID["sheep_farm"].UpkeepPerMin {
		t.Errorf("upkeep %d", ds.UpkeepRatePerMin)
	}
}

func fieldsOf(w *World, c *content.Catalogue) []*Building {
	var out []*Building
	for _, b := range w.Islands[0].Buildings {
		if def := c.BuildingByID[b.Type]; def != nil && def.Field != nil {
			out = append(out, b)
		}
	}
	return out
}

// withCost returns a copy of the catalogue with the cost of one building
// replaced.
func withCost(base *content.Catalogue, id string, cost content.Cost) *content.Catalogue {
	c := *base
	c.BuildingByID = maps.Clone(base.BuildingByID)
	c.FieldByType = maps.Clone(base.FieldByType)
	b := *base.BuildingByID[id]
	b.Cost = cost
	c.BuildingByID[id] = &b
	if b.Field != nil {
		c.FieldByType[b.Field.Type] = &b
	}
	return &c
}

// TestPlaceFieldsErrors (R-6, R-11): every rule of the field site in its
// order, the command shape and cost; a failing command (also with valid
// tiles before the failing one) leaves the world byte-identical and
// returns the first failing tile's error.
func TestPlaceFieldsErrors(t *testing.T) {
	c := catalogue(t)
	w, _ := fieldsWorld(t, c)
	ok := Pos{7, 8} // valid pasture tile
	place := func(typ string, tiles ...Pos) PlaceFields {
		return PlaceFields{IslandID: "main", Type: typ, Tiles: tiles}
	}
	many := make([]Pos, MaxFieldTiles+1)
	for i := range many {
		many[i] = Pos{i % 24, i / 24}
	}
	for _, tt := range []struct {
		name string
		cmd  Command
		want error
	}{
		{"unknown island", PlaceFields{IslandID: "x", Type: "pasture", Tiles: []Pos{ok}}, ErrUnknownIsland},
		{"not a field type", place("sheep_farm", ok), ErrFieldTypeMismatch},
		{"unknown type", place("hop_field", ok), ErrFieldTypeMismatch},
		{"no tiles", place("pasture"), ErrInvalidCommand},
		{"too many tiles", place("pasture", many...), ErrInvalidCommand},
		{"duplicate tile", place("pasture", ok, Pos{6, 8}, ok), ErrInvalidCommand},
		{"out of bounds", place("pasture", ok, Pos{-1, 5}), ErrOutOfBounds},
		{"forest", place("pasture", ok, Pos{5, 8}), ErrTerrain},
		{"water", place("pasture", Pos{0, 6}), ErrTerrain},
		{"coast", place("pasture", Pos{9, 1}), ErrTerrain},
		{"road", place("pasture", Pos{9, 4}), ErrOccupied},
		{"farm footprint", place("pasture", Pos{9, 6}), ErrOccupied},
		{"far away", place("pasture", ok, Pos{20, 12}), ErrNoFarmInRange},
		{"just outside the radius", place("pasture", Pos{14, 6}), ErrNoFarmInRange},
		{"first failing tile wins", place("pasture", ok, Pos{20, 12}, Pos{5, 8}), ErrNoFarmInRange},
		{"tier locked", place("wheat_field", ok), ErrTierLocked},
		{"single placement out of range", PlaceBuilding{IslandID: "main", Type: "pasture", X: 20, Y: 12}, ErrNoFarmInRange},
		{"single placement on forest", PlaceBuilding{IslandID: "main", Type: "pasture", X: 4, Y: 8}, ErrTerrain},
	} {
		t.Run(tt.name, func(t *testing.T) {
			expectApplyErr(t, w, c, tt.cmd, tt.want)
		})
	}
	// The radius boundary: (13,6) is inside the disc of the farm at (8,5),
	// (14,6) is not: (2*13+1-19)^2 + (2*6+1-13)^2 = 64 <= 64.
	if len(ValidFieldTiles(w.Islands[0], c, "pasture", []Pos{{13, 6}, {14, 6}})) != 1 {
		t.Error("radius boundary")
	}

	// Fertility: the island lacks wheat.
	w.UnlockedTiers = []string{"citizens"}
	if err := AddStock(w, c, "main", "stone", 50_000, nil); err != nil {
		t.Fatal(err)
	}
	expectApplyErr(t, w, c, PlaceBuilding{IslandID: "main", Type: "wheat_farm", X: 16, Y: 5}, ErrNoFertility)
	w.Islands[0].Fertilities = []string{"wheat"}
	mustApply(t, w, c, PlaceBuilding{IslandID: "main", Type: "wheat_farm", X: 16, Y: 5})
	w.Islands[0].Fertilities = []string{"hemp"}
	expectApplyErr(t, w, c, place("wheat_field", Pos{17, 9}), ErrNoFertility)
	// A pasture is not a wheat field: no farm accepts it there.
	expectApplyErr(t, w, c, place("pasture", Pos{20, 6}), ErrNoFarmInRange)
	// Fertility is checked before the farm range.
	expectApplyErr(t, w, c, place("wheat_field", Pos{1, 12}), ErrNoFertility)

	// Cost x n is checked and charged (gold and materials).
	cc := withCost(c, "pasture", content.Cost{Gold: 2_000, Materials: []content.GoodAmount{{Good: "planks", Amount: 1_000}}})
	gold, planks := w.Gold, w.Islands[0].Inventory.Stock["planks"]
	mustApply(t, w, cc, place("pasture", ok, Pos{7, 9}))
	if w.Gold != gold-4_000 || w.Islands[0].Inventory.Stock["planks"] != planks-2_000 {
		t.Errorf("gold %d planks %d", gold-w.Gold, planks-w.Islands[0].Inventory.Stock["planks"])
	}
	w.Gold = 1_000
	expectApplyErr(t, w, cc, place("pasture", Pos{8, 9}), ErrInsufficientGold)
	w.Gold = 10_000_000
	w.Islands[0].Inventory.Stock["planks"] = 1_000
	expectApplyErr(t, w, cc, place("pasture", Pos{9, 9}, Pos{10, 9}), ErrInsufficientMaterials)
	// Settlement is required.
	w2, _ := fieldsWorld(t, c)
	w2.Islands = append(w2.Islands, islandFromRows("wild", "~~~~", "~..~", "~~~~"))
	expectApplyErr(t, w2, c, PlaceFields{IslandID: "wild", Type: "pasture", Tiles: []Pos{{1, 1}}}, ErrIslandNotSettled)
}

// TestFarmPlacementWithoutWorkArea (R-7): a farm with fields is placed and
// moved where no grass is free (no no_work_area); the lumberjack keeps it.
func TestFarmPlacementWithoutWorkArea(t *testing.T) {
	c := catalogue(t)
	w := testWorld(t, c)
	// Surrounded by forest and water.
	is := w.Islands[0]
	for i := range is.Tiles {
		if is.Tiles[i].Terrain == content.TerrainGrass {
			is.Tiles[i].Terrain = content.TerrainForest
		}
	}
	is.Tiles[is.index(13, 5)].Terrain = content.TerrainGrass
	mustApply(t, w, c, PlaceBuilding{IslandID: "main", Type: "sheep_farm", X: 14, Y: 5})
	id := w.NextBuildingID - 1
	mustApply(t, w, c, MoveBuilding{IslandID: "main", BuildingID: id, X: 15, Y: 5})
	if b := is.Building(id); b.Efficiency != 0 {
		t.Errorf("efficiency %d", b.Efficiency)
	}
	// The lumberjack still needs forest.
	for i := range is.Tiles {
		if is.Tiles[i].Terrain == content.TerrainForest {
			is.Tiles[i].Terrain = content.TerrainGrass
		}
	}
	expectApplyErr(t, w, c, PlaceBuilding{IslandID: "main", Type: "lumberjack", X: 6, Y: 5}, ErrNoWorkArea)
}

// TestDemolishFields (R-10, R-11): shape errors, building_not_found,
// not_a_field, all or nothing; demolished fields lower the efficiency and
// refund 50 % of materials rounded down (a 1-plank field refunds nothing).
func TestDemolishFields(t *testing.T) {
	c := catalogue(t)
	w, farm := fieldsWorld(t, c)
	tiles := validTiles(w, c, "pasture")[:16]
	mustApply(t, w, c, PlaceFields{IslandID: "main", Type: "pasture", Tiles: tiles})
	demo := func(tiles ...Pos) DemolishFields { return DemolishFields{IslandID: "main", Tiles: tiles} }
	many := make([]Pos, MaxFieldTiles+1)
	for i := range many {
		many[i] = Pos{i % 24, i / 24}
	}
	for _, tt := range []struct {
		name string
		cmd  DemolishFields
		want error
	}{
		{"unknown island", DemolishFields{IslandID: "x", Tiles: tiles[:1]}, ErrUnknownIsland},
		{"no tiles", demo(), ErrInvalidCommand},
		{"too many", demo(many...), ErrInvalidCommand},
		{"duplicate", demo(tiles[0], tiles[0]), ErrInvalidCommand},
		{"out of bounds", demo(tiles[0], Pos{30, 1}), ErrOutOfBounds},
		{"empty tile", demo(tiles[0], Pos{20, 12}), ErrBuildingNotFound},
		{"road tile", demo(Pos{9, 4}), ErrBuildingNotFound},
		{"farm", demo(tiles[0], Pos{9, 6}), ErrNotAField},
		{"warehouse", demo(Pos{2, 2}), ErrNotAField},
	} {
		t.Run(tt.name, func(t *testing.T) {
			expectApplyErr(t, w, c, tt.cmd, tt.want)
		})
	}
	mustApply(t, w, c, demo(tiles[:4]...))
	if b := w.Islands[0].Building(farm); b.Efficiency != 750 || len(fieldsOf(w, c)) != 12 {
		t.Errorf("efficiency %d with %d fields", b.Efficiency, len(fieldsOf(w, c)))
	}
	// Demolish by ID works too.
	mustApply(t, w, c, Demolish{IslandID: "main", BuildingID: fieldsOf(w, c)[0].ID})
	if b := w.Islands[0].Building(farm); b.Efficiency != 687 {
		t.Errorf("efficiency %d", b.Efficiency)
	}

	// Refund: 1 plank refunds 0 (50 % rounded down), 4 planks refund 2.
	for _, tc := range []struct{ cost, refund Qty }{{1_000, 0}, {4_000, 2_000}} {
		cc := withCost(c, "pasture", content.Cost{Materials: []content.GoodAmount{{Good: "planks", Amount: tc.cost}}})
		w, _ := fieldsWorld(t, cc)
		ts := validTiles(w, cc, "pasture")[:3]
		mustApply(t, w, cc, PlaceFields{IslandID: "main", Type: "pasture", Tiles: ts})
		before, gold := w.Islands[0].Inventory.Stock["planks"], w.Gold
		mustApply(t, w, cc, DemolishFields{IslandID: "main", Tiles: ts})
		if got := w.Islands[0].Inventory.Stock["planks"] - before; got != 3*tc.refund || w.Gold != gold {
			t.Errorf("cost %d: refund %d, gold %d", tc.cost, got, w.Gold-gold)
		}
	}
}

// TestFieldMoveAndFarmDemolish (R-8, R-10): a moved field is validated by
// the field rule and reassigned; demolishing a farm reassigns its fields to
// another accepting farm in range or leaves them unassigned (no_farm).
func TestFieldMoveAndFarmDemolish(t *testing.T) {
	c := catalogue(t)
	w, farm := fieldsWorld(t, c)
	mustApply(t, w, c, PlaceFields{IslandID: "main", Type: "pasture", Tiles: []Pos{{7, 8}, {12, 6}, {13, 6}}})
	fs := fieldsOf(w, c)
	expectApplyErr(t, w, c, MoveBuilding{IslandID: "main", BuildingID: fs[0].ID, X: 20, Y: 12}, ErrNoFarmInRange)
	expectApplyErr(t, w, c, MoveBuilding{IslandID: "main", BuildingID: fs[0].ID, X: 5, Y: 8}, ErrTerrain)
	expectApplyErr(t, w, c, MoveBuilding{IslandID: "main", BuildingID: fs[0].ID, X: 12, Y: 6}, ErrOccupied)
	// The own tile counts as free.
	mustApply(t, w, c, MoveBuilding{IslandID: "main", BuildingID: fs[0].ID, X: 7, Y: 8, Rotation: 90})

	// A second farm at (15,5): (13,6) is nearer to it, (12,6) to the first.
	second := w.NextBuildingID
	mustApply(t, w, c, PlaceBuilding{IslandID: "main", Type: "sheep_farm", X: 15, Y: 5})
	is := w.Islands[0]
	if is.BuildingAt(c, 12, 6).FarmID != farm || is.BuildingAt(c, 13, 6).FarmID != second {
		t.Fatalf("assignment %d %d", is.BuildingAt(c, 12, 6).FarmID, is.BuildingAt(c, 13, 6).FarmID)
	}
	// Moving a field next to the second farm reassigns it.
	mustApply(t, w, c, MoveBuilding{IslandID: "main", BuildingID: fs[0].ID, X: 18, Y: 8})
	if fs[0].FarmID != second || is.Building(second).Efficiency != 125 || is.Building(farm).Efficiency != 62 {
		t.Errorf("after move: field farm %d, efficiencies %d %d", fs[0].FarmID, is.Building(second).Efficiency, is.Building(farm).Efficiency)
	}
	// Demolishing the first farm: (12,6) is in the second farm's radius
	// and moves over; a field only the first farm reached becomes no_farm.
	mustApply(t, w, c, PlaceFields{IslandID: "main", Type: "pasture", Tiles: []Pos{{5, 6}}})
	lone := is.BuildingAt(c, 5, 6)
	mustApply(t, w, c, Demolish{IslandID: "main", BuildingID: farm})
	if is.BuildingAt(c, 12, 6).FarmID != second || lone.FarmID != 0 || is.Building(second).Efficiency != 187 {
		t.Errorf("after demolish: %d %d %d", is.BuildingAt(c, 12, 6).FarmID, lone.FarmID, is.Building(second).Efficiency)
	}
	d := fieldDisplay(t, w, c, lone.ID)
	if d.Status != StatusNoFarm || d.FarmID != nil {
		t.Errorf("lone field display %+v", d)
	}
	// It still stands and can be demolished, but not moved to its own
	// place's neighbour without a farm in range.
	expectApplyErr(t, w, c, MoveBuilding{IslandID: "main", BuildingID: lone.ID, X: 5, Y: 7}, ErrNoFarmInRange)
	mustApply(t, w, c, Demolish{IslandID: "main", BuildingID: lone.ID})
}

// TestSharedPasture (R-34): on test content with sheep_farm and
// dairy_farm (both accept pasture) the pastures between them go to the
// nearer farm, ties to the lower ID; moving a farm recomputes it.
func TestSharedPasture(t *testing.T) {
	root := repoRoot(t)
	c, err := content.LoadWithSchemas(filepath.Join(root, "server", "testdata", "content", "old_coast_dairy"), filepath.Join(root, "content", "schema"))
	if err != nil {
		t.Fatal(err)
	}
	w, sheep := fieldsWorld(t, c)
	// The dairy farm at (14,5): doubled centres (19,13) and (31,13).
	dairy := w.NextBuildingID
	mustApply(t, w, c, PlaceBuilding{IslandID: "main", Type: "dairy_farm", X: 14, Y: 5})
	// Tiles of row 8 from x 11 to 13: x=11 -> d(sheep)=(23-19)^2+(17-13)^2=32,
	// d(dairy)=(23-31)^2+16=80; x=12 -> 52 vs 52 (tie: lower ID, sheep);
	// x=13 -> 80 vs 32.
	mustApply(t, w, c, PlaceFields{IslandID: "main", Type: "pasture", Tiles: []Pos{{11, 8}, {12, 8}, {13, 8}}})
	is := w.Islands[0]
	want := map[int]int64{11: sheep, 12: sheep, 13: dairy}
	for x, farm := range want {
		if got := is.BuildingAt(c, x, 8).FarmID; got != farm {
			t.Errorf("pasture (%d,8) -> %d, want %d", x, got, farm)
		}
	}
	if is.Building(sheep).Efficiency != 125 || is.Building(dairy).Efficiency != 62 {
		t.Errorf("efficiencies %d %d", is.Building(sheep).Efficiency, is.Building(dairy).Efficiency)
	}
	// The dairy farm moves one tile left: (12,8) is now nearer to it.
	mustApply(t, w, c, MoveBuilding{IslandID: "main", BuildingID: dairy, X: 13, Y: 5})
	if got := is.BuildingAt(c, 12, 8).FarmID; got != dairy {
		t.Errorf("after move (12,8) -> %d", got)
	}
	if is.Building(sheep).Efficiency != 62 || is.Building(dairy).Efficiency != 125 {
		t.Errorf("efficiencies after move %d %d", is.Building(sheep).Efficiency, is.Building(dairy).Efficiency)
	}
	// A field outside the dairy farm's radius but inside the sheep farm's
	// stays with the sheep farm although it is no tie.
	mustApply(t, w, c, PlaceFields{IslandID: "main", Type: "pasture", Tiles: []Pos{{5, 6}}})
	if got := is.BuildingAt(c, 5, 6).FarmID; got != sheep {
		t.Errorf("(5,6) -> %d", got)
	}
	ds, err := Display(w, c, w.LastEvaluatedAt)
	if err != nil {
		t.Fatal(err)
	}
	for _, b := range ds.Islands[0].Buildings {
		if b.ID == dairy && (b.Fields == nil || b.Fields.Assigned != 2) {
			t.Errorf("dairy display %+v", b.Fields)
		}
	}
}
