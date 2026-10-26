package sim

import (
	"errors"
	"maps"
	"slices"
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

// putField places a field of the farm at (x, y) and returns its ID.
func putField(t *testing.T, w *World, c *content.Catalogue, farm int64, typ string, x, y int) int64 {
	t.Helper()
	id := w.NextBuildingID
	mustApply(t, w, c, PlaceField{IslandID: "main", FarmID: farm, Type: typ, X: x, Y: y})
	return id
}

// TestFieldEfficiency: a farm starts at 0 fields with efficiency 0 and
// status low_efficiency; every active field adds 1/required (4 pastures)
// to the efficiency, status ok at the requirement (which is also the
// maximum: fields.max equals fields.required). Fields display their farm and whether they are
// active; the farm displays active/required/max and its field IDs.
func TestFieldEfficiency(t *testing.T) {
	c := catalogue(t)
	w, farm := fieldsWorld(t, c)
	fd := fieldDisplay(t, w, c, farm)
	if fd.EfficiencyPermille != 0 || fd.Status != StatusLowEfficiency || fd.Fields == nil || fd.Fields.Active != 0 || fd.Fields.Required != 4 ||
		fd.Fields.Max != 4 || len(fd.Fields.IDs) != 0 || fd.Fields.IDs == nil || fd.FarmID != nil || fd.Active != nil {
		t.Fatalf("farm without fields: %+v %+v", fd, fd.Fields)
	}
	if fd.Rates.Outputs["wool"] != 0 {
		t.Errorf("wool rate %d without fields", fd.Rates.Outputs["wool"])
	}
	spots := [][2]int{{11, 5}, {11, 7}, {13, 5}, {13, 7}}
	var ids []int64
	for i, p := range spots {
		ids = append(ids, putField(t, w, c, farm, "pasture", p[0], p[1]))
		fd := fieldDisplay(t, w, c, farm)
		n := i + 1
		wantEff, wantStat := int64(min(n, 4)*250), StatusLowEfficiency
		if n >= 4 {
			wantStat = StatusOK
		}
		if fd.EfficiencyPermille != wantEff || fd.Status != wantStat || fd.Fields.Active != n || len(fd.Fields.IDs) != n {
			t.Errorf("%d fields: efficiency %d status %s fields %+v", n, fd.EfficiencyPermille, fd.Status, fd.Fields)
		}
	}
	if fd := fieldDisplay(t, w, c, farm); !slices.Equal(fd.Fields.IDs, ids) {
		t.Errorf("ids %v, want %v", fd.Fields.IDs, ids)
	}
	for _, id := range ids {
		d := fieldDisplay(t, w, c, id)
		if d.FarmID == nil || *d.FarmID != farm || d.Active == nil || !*d.Active || d.Status != StatusOK || d.Fields != nil || d.Rates != nil ||
			d.AssignedWarehouseID != nil || d.Residents != nil {
			t.Errorf("field %d display %+v", id, d)
		}
	}
	// A field cannot be paused, has no upkeep and never needs a road.
	expectApplyErr(t, w, c, SetPaused{IslandID: "main", BuildingID: ids[0], Paused: true}, ErrNotPausable)
	ds, _ := Display(w, c, w.LastEvaluatedAt)
	if ds.UpkeepRatePerMin != c.BuildingByID["sheep_farm"].UpkeepPerMin {
		t.Errorf("upkeep %d", ds.UpkeepRatePerMin)
	}
}

// TestFieldChain: farm -> f1 -> f2 is a chain; demolishing f1 leaves f2
// inactive (not deleted, status not_adjacent, counts nothing, FarmID kept)
// and a field that touches only an inactive field cannot be placed;
// re-placing f1 reactivates f2.
func TestFieldChain(t *testing.T) {
	c := catalogue(t)
	w, farm := fieldsWorld(t, c)
	f1 := putField(t, w, c, farm, "pasture", 11, 5)
	f2 := putField(t, w, c, farm, "pasture", 13, 5)
	is := w.Islands[0]
	if is.Building(farm).Efficiency != 500 || is.Building(f2).Inactive {
		t.Fatalf("chain: efficiency %d, f2 inactive %v", is.Building(farm).Efficiency, is.Building(f2).Inactive)
	}
	mustApply(t, w, c, Demolish{IslandID: "main", BuildingID: f1})
	if b := is.Building(f2); b == nil || !b.Inactive || b.FarmID != farm || is.Building(farm).Efficiency != 0 {
		t.Fatalf("after breaking the chain: f2 %+v, efficiency %d", b, is.Building(farm).Efficiency)
	}
	d := fieldDisplay(t, w, c, f2)
	if d.Status != StatusNotAdjacent || d.Active == nil || *d.Active || d.FarmID == nil || *d.FarmID != farm {
		t.Errorf("inactive field display %+v", d)
	}
	if fd := fieldDisplay(t, w, c, farm); fd.Fields.Active != 0 || !slices.Equal(fd.Fields.IDs, []int64{f2}) || fd.Status != StatusLowEfficiency {
		t.Errorf("farm display %+v %+v", fd, fd.Fields)
	}
	// Touching only an inactive field does not count.
	expectApplyErr(t, w, c, PlaceField{IslandID: "main", FarmID: farm, Type: "pasture", X: 15, Y: 5}, ErrFieldNotAdjacent)
	// An inactive field still occupies its tiles.
	expectApplyErr(t, w, c, PlaceField{IslandID: "main", FarmID: farm, Type: "pasture", X: 13, Y: 6}, ErrOccupied)
	// Re-placing the intermediate field reconnects it.
	putField(t, w, c, farm, "pasture", 11, 5)
	if b := is.Building(f2); b.Inactive || is.Building(farm).Efficiency != 500 {
		t.Errorf("after reconnecting: f2 inactive %v, efficiency %d", b.Inactive, is.Building(farm).Efficiency)
	}
}

// TestFieldAdjacencyIsFourEdge: sharing an edge segment counts; a corner
// alone and a gap of one tile do not (MECHANICS §4).
func TestFieldAdjacencyIsFourEdge(t *testing.T) {
	c := catalogue(t)
	w, farm := fieldsWorld(t, c)
	// Farm footprint x 8..10, y 5..7.
	expectApplyErr(t, w, c, PlaceField{IslandID: "main", FarmID: farm, Type: "pasture", X: 12, Y: 5}, ErrFieldNotAdjacent) // gap at x=11
	expectApplyErr(t, w, c, PlaceField{IslandID: "main", FarmID: farm, Type: "pasture", X: 11, Y: 9}, ErrFieldNotAdjacent) // gap at y=8
	expectApplyErr(t, w, c, PlaceField{IslandID: "main", FarmID: farm, Type: "pasture", X: 11, Y: 8}, ErrFieldNotAdjacent) // corner (10,7)-(11,8) only
	expectApplyErr(t, w, c, PlaceField{IslandID: "main", FarmID: farm, Type: "pasture", X: 6, Y: 8}, ErrTerrain)           // (forest; the corner case again below)
	putField(t, w, c, farm, "pasture", 6, 5)                                                                               // edge, west
	putField(t, w, c, farm, "pasture", 11, 7)                                                                              // edge, east (one row overlap)
	// A field touching a field only at a corner is not adjacent either.
	expectApplyErr(t, w, c, PlaceField{IslandID: "main", FarmID: farm, Type: "pasture", X: 13, Y: 9}, ErrFieldNotAdjacent) // corner of (11,7)
	if w.Islands[0].Building(farm).Efficiency != 500 {
		t.Errorf("efficiency %d", w.Islands[0].Building(farm).Efficiency)
	}
}

// TestFieldMax: a farm owns at most fields.max fields; inactive fields
// count; demolishing one frees a slot.
func TestFieldMax(t *testing.T) {
	c := catalogue(t)
	w, farm := fieldsWorld(t, c)
	var ids []int64
	for _, p := range [][2]int{{11, 5}, {11, 7}, {13, 5}, {13, 7}} {
		ids = append(ids, putField(t, w, c, farm, "pasture", p[0], p[1]))
	}
	next := PlaceField{IslandID: "main", FarmID: farm, Type: "pasture", X: 15, Y: 5}
	expectApplyErr(t, w, c, next, ErrFieldMaxReached)
	// The maximum is checked before the site: even an invalid site reports it.
	expectApplyErr(t, w, c, PlaceField{IslandID: "main", FarmID: farm, Type: "pasture", X: 0, Y: 0}, ErrFieldMaxReached)
	// Inactive fields count: breaking the chain at (11,5) keeps 4 fields.
	mustApply(t, w, c, Demolish{IslandID: "main", BuildingID: ids[0]})
	if len(fieldsOf(w, c)) != 3 {
		t.Fatalf("%d fields", len(fieldsOf(w, c)))
	}
	mustApply(t, w, c, PlaceField{IslandID: "main", FarmID: farm, Type: "pasture", X: 11, Y: 5})
	expectApplyErr(t, w, c, next, ErrFieldMaxReached)
}

// TestFieldsOfOtherFarmsDoNotChain: a field type of another farm type
// never chains and cannot be placed from the wrong farm; fields of another
// farm instance of the same type neither chain nor count.
func TestFieldsOfOtherFarmsDoNotChain(t *testing.T) {
	c := catalogue(t)
	w, sheepA := fieldsWorld(t, c)
	w.UnlockedTiers = []string{"citizens"}
	w.Islands[0].Fertilities = []string{"wheat"}
	if err := AddStock(w, c, "main", "stone", 50_000, nil); err != nil {
		t.Fatal(err)
	}
	wheat := w.NextBuildingID
	mustApply(t, w, c, PlaceBuilding{IslandID: "main", Type: "wheat_farm", X: 14, Y: 5})
	sheepB := w.NextBuildingID
	mustApply(t, w, c, PlaceBuilding{IslandID: "main", Type: "sheep_farm", X: 8, Y: 9})
	is := w.Islands[0]

	// Wrong farm type: a pasture from the wheat farm, a wheat field from a
	// sheep farm, a field from a building that is no farm.
	expectApplyErr(t, w, c, PlaceField{IslandID: "main", FarmID: wheat, Type: "pasture", X: 12, Y: 8}, ErrFieldWrongFarm)
	expectApplyErr(t, w, c, PlaceField{IslandID: "main", FarmID: sheepA, Type: "wheat_field", X: 11, Y: 6}, ErrFieldWrongFarm)
	expectApplyErr(t, w, c, PlaceField{IslandID: "main", FarmID: 1, Type: "pasture", X: 11, Y: 6}, ErrFieldWrongFarm)

	// A pasture of farm A (x 11..12, y 6..7); a wheat field that touches
	// the pasture but not the wheat farm cannot chain over it.
	pasture := putField(t, w, c, sheepA, "pasture", 11, 6)
	expectApplyErr(t, w, c, PlaceField{IslandID: "main", FarmID: wheat, Type: "wheat_field", X: 12, Y: 8}, ErrFieldNotAdjacent)
	// A wheat field next to the wheat farm that also touches the pasture
	// belongs to the wheat farm only.
	wf := putField(t, w, c, wheat, "wheat_field", 13, 6)
	if is.Building(wf).FarmID != wheat || is.Building(pasture).FarmID != sheepA {
		t.Fatalf("owners %d %d", is.Building(wf).FarmID, is.Building(pasture).FarmID)
	}
	if is.Building(sheepA).Efficiency != 250 || is.Building(wheat).Efficiency != 62 {
		t.Errorf("efficiencies %d %d", is.Building(sheepA).Efficiency, is.Building(wheat).Efficiency)
	}

	// Another instance of the same type: B's pasture touches A's pasture
	// but is B's own; A cannot chain from B's field.
	bp := putField(t, w, c, sheepB, "pasture", 11, 8)
	expectApplyErr(t, w, c, PlaceField{IslandID: "main", FarmID: sheepA, Type: "pasture", X: 13, Y: 9}, ErrFieldNotAdjacent)
	if is.Building(bp).FarmID != sheepB || is.Building(sheepB).Efficiency != 250 || is.Building(sheepA).Efficiency != 250 {
		t.Errorf("B pasture %+v, efficiencies %d %d", is.Building(bp), is.Building(sheepA).Efficiency, is.Building(sheepB).Efficiency)
	}
	// Demolishing A leaves B's field active.
	mustApply(t, w, c, Demolish{IslandID: "main", BuildingID: sheepA})
	if is.Building(pasture) != nil || is.Building(bp).Inactive || is.Building(sheepB).Efficiency != 250 || is.Building(wf) == nil {
		t.Errorf("after demolishing farm A")
	}
}

// TestFieldMoveFarmKeepsFields: moving a farm keeps its fields, which
// become inactive when the farm is no longer adjacent and active again
// when it returns; the farm cannot move onto its own fields; a field
// cannot be moved.
func TestFieldMoveFarmKeepsFields(t *testing.T) {
	c := catalogue(t)
	w, farm := fieldsWorld(t, c)
	f1 := putField(t, w, c, farm, "pasture", 11, 5)
	f2 := putField(t, w, c, farm, "pasture", 13, 5)
	is := w.Islands[0]
	expectApplyErr(t, w, c, MoveBuilding{IslandID: "main", BuildingID: farm, X: 9, Y: 5}, ErrOccupied)
	expectApplyErr(t, w, c, MoveBuilding{IslandID: "main", BuildingID: f1, X: 11, Y: 7}, ErrInvalidCommand)
	// Away: nothing adjacent any more.
	mustApply(t, w, c, MoveBuilding{IslandID: "main", BuildingID: farm, X: 17, Y: 9})
	if is.Building(f1) == nil || is.Building(f2) == nil || !is.Building(f1).Inactive || !is.Building(f2).Inactive || is.Building(farm).Efficiency != 0 {
		t.Fatalf("after moving away: %+v %+v efficiency %d", is.Building(f1), is.Building(f2), is.Building(farm).Efficiency)
	}
	if is.Building(f1).FarmID != farm {
		t.Errorf("owner %d", is.Building(f1).FarmID)
	}
	// Partial: the farm now touches f2 (x 13..14, y 5..6) from below but
	// not f1; f2 alone is active.
	mustApply(t, w, c, MoveBuilding{IslandID: "main", BuildingID: farm, X: 13, Y: 7})
	// f1 touches f2 (x 11..12 | 13..14), so the chain farm -> f2 -> f1 is intact.
	if is.Building(f1).Inactive || is.Building(f2).Inactive {
		t.Errorf("chain through f2: f1 inactive %v f2 inactive %v", is.Building(f1).Inactive, is.Building(f2).Inactive)
	}
	if is.Building(farm).Efficiency != 500 {
		t.Errorf("efficiency %d", is.Building(farm).Efficiency)
	}
	mustApply(t, w, c, MoveBuilding{IslandID: "main", BuildingID: farm, X: 8, Y: 5})
	if is.Building(f1).Inactive || is.Building(f2).Inactive {
		t.Error("fields inactive after the farm returned")
	}
}

// TestFarmDemolishRefundsEachFieldOnce: demolishing a farm demolishes its
// fields with the refund of each (floor of half the planks), once.
func TestFarmDemolishRefundsEachFieldOnce(t *testing.T) {
	c := catalogue(t)
	w, farm := fieldsWorld(t, c)
	putField(t, w, c, farm, "pasture", 11, 5)
	putField(t, w, c, farm, "pasture", 13, 5)
	putField(t, w, c, farm, "pasture", 8, 8)
	// A field refunds half of its 2 planks; a 3-plank field would refund 1:
	// the per-field rounding is visible with an odd cost.
	cc := withCost(c, "pasture", content.Cost{Gold: 15_000, Materials: []content.GoodAmount{{Good: "planks", Amount: 3_000}}})
	is := w.Islands[0]
	planks, gold := is.Inventory.Stock["planks"], w.Gold
	mustApply(t, w, cc, Demolish{IslandID: "main", BuildingID: farm})
	// Farm 10 planks -> 5; three pastures at 3 planks -> 1 each (not 4 for a bulk 9/2).
	if got := is.Inventory.Stock["planks"] - planks; got != 5_000+3*1_000 || w.Gold != gold {
		t.Errorf("refund %d planks, %d gold", got, w.Gold-gold)
	}
	if len(fieldsOf(w, c)) != 0 || is.Building(farm) != nil {
		t.Errorf("%d fields left", len(fieldsOf(w, c)))
	}
	// Never twice.
	expectApplyErr(t, w, cc, Demolish{IslandID: "main", BuildingID: farm}, ErrBuildingNotFound)
	// A single field refunds its own half (2 planks -> 1) and never gold;
	// the shipped pasture costs gold only, so it refunds nothing.
	for _, tc := range []struct {
		cat  *content.Catalogue
		want Qty
	}{{withCost(c, "pasture", content.Cost{Gold: 15_000, Materials: []content.GoodAmount{{Good: "planks", Amount: 2_000}}}), 1_000}, {c, 0}} {
		w2, farm2 := fieldsWorld(t, tc.cat)
		f := putField(t, w2, tc.cat, farm2, "pasture", 11, 5)
		p2, g2 := w2.Islands[0].Inventory.Stock["planks"], w2.Gold
		mustApply(t, w2, tc.cat, Demolish{IslandID: "main", BuildingID: f})
		if got := w2.Islands[0].Inventory.Stock["planks"] - p2; got != tc.want || w2.Gold != g2 {
			t.Errorf("field refund %d planks, %d gold, want %d planks", got, w2.Gold-g2, tc.want)
		}
	}
}

// TestPlaceFieldErrors: every rule of the field site in its order, the
// command shape and the cost; a failing command leaves the world
// byte-identical.
func TestPlaceFieldErrors(t *testing.T) {
	c := catalogue(t)
	w, farm := fieldsWorld(t, c)
	place := func(typ string, x, y int) PlaceField {
		return PlaceField{IslandID: "main", FarmID: farm, Type: typ, X: x, Y: y}
	}
	for _, tt := range []struct {
		name string
		cmd  Command
		want error
	}{
		{"unknown island", PlaceField{IslandID: "x", FarmID: farm, Type: "pasture", X: 11, Y: 5}, ErrUnknownIsland},
		{"unknown type", place("hop_field", 11, 5), ErrUnknownBuilding},
		{"not a field type", place("sheep_farm", 11, 5), ErrFieldTypeMismatch},
		{"unknown farm", PlaceField{IslandID: "main", FarmID: 999, Type: "pasture", X: 11, Y: 5}, ErrBuildingNotFound},
		{"bad rotation", PlaceField{IslandID: "main", FarmID: farm, Type: "pasture", X: 11, Y: 5, Rotation: 45}, ErrInvalidCommand},
		{"tier locked", place("wheat_field", 11, 5), ErrTierLocked},
		{"out of bounds east", place("pasture", 23, 5), ErrOutOfBounds},
		{"out of bounds negative", place("pasture", -1, 5), ErrOutOfBounds},
		{"forest", place("pasture", 6, 8), ErrTerrain},
		{"water", place("pasture", 0, 5), ErrTerrain},
		{"coast", place("pasture", 8, 1), ErrTerrain},
		{"road", place("pasture", 9, 3), ErrOccupied},
		{"farm footprint", place("pasture", 9, 6), ErrOccupied},
		{"not adjacent", place("pasture", 14, 8), ErrFieldNotAdjacent},
		{"free-standing building placement", PlaceBuilding{IslandID: "main", Type: "pasture", X: 11, Y: 5}, ErrFieldNeedsFarm},
	} {
		t.Run(tt.name, func(t *testing.T) {
			expectApplyErr(t, w, c, tt.cmd, tt.want)
		})
	}
	// Free placement of a field is refused as well.
	if err := PlaceFree(w, c, PlaceBuilding{IslandID: "main", Type: "pasture", X: 11, Y: 5}, nil); !errors.Is(err, ErrFieldNeedsFarm) {
		t.Errorf("PlaceFree = %v", err)
	}

	// Fertility is checked before adjacency.
	w.UnlockedTiers = []string{"citizens"}
	if err := AddStock(w, c, "main", "stone", 50_000, nil); err != nil {
		t.Fatal(err)
	}
	w.Islands[0].Fertilities = []string{"wheat"}
	wheat := w.NextBuildingID
	mustApply(t, w, c, PlaceBuilding{IslandID: "main", Type: "wheat_farm", X: 16, Y: 5})
	w.Islands[0].Fertilities = []string{"hemp"}
	expectApplyErr(t, w, c, PlaceField{IslandID: "main", FarmID: wheat, Type: "wheat_field", X: 1, Y: 12}, ErrNoFertility)
	expectApplyErr(t, w, c, PlaceField{IslandID: "main", FarmID: wheat, Type: "wheat_field", X: 15, Y: 5}, ErrNoFertility)

	// Cost: gold (15) is charged, checked after the site; materials are
	// charged too when a content cost has them.
	gold, planks := w.Gold, w.Islands[0].Inventory.Stock["planks"]
	mustApply(t, w, c, place("pasture", 11, 5))
	if gold-w.Gold != 15_000 || planks != w.Islands[0].Inventory.Stock["planks"] {
		t.Errorf("charged %d gold, %d planks", gold-w.Gold, planks-w.Islands[0].Inventory.Stock["planks"])
	}
	w.Gold = 14_999
	expectApplyErr(t, w, c, place("pasture", 13, 5), ErrInsufficientGold)
	w.Gold = 10_000_000
	cc := withCost(c, "pasture", content.Cost{Gold: 15_000, Materials: []content.GoodAmount{{Good: "planks", Amount: 2_000}}})
	planks = w.Islands[0].Inventory.Stock["planks"]
	mustApply(t, w, cc, place("pasture", 13, 5))
	if got := planks - w.Islands[0].Inventory.Stock["planks"]; got != 2_000 {
		t.Errorf("charged %d planks", got)
	}
	w.Islands[0].Inventory.Stock["planks"] = 1_999
	expectApplyErr(t, w, cc, place("pasture", 11, 7), ErrInsufficientMaterials)
	// A crop field costs 5 gold.
	if c.BuildingByID["wheat_field"].Cost.Gold != 5_000 {
		t.Errorf("wheat field cost %+v", c.BuildingByID["wheat_field"].Cost)
	}
	// Settlement is required.
	w2, farm2 := fieldsWorld(t, c)
	w2.Islands = append(w2.Islands, islandFromRows("wild", "~~~~", "~..~", "~~~~"))
	expectApplyErr(t, w2, c, PlaceField{IslandID: "wild", FarmID: farm2, Type: "pasture", X: 1, Y: 1}, ErrBuildingNotFound)
}

// TestFarmPlacementWithoutWorkArea: a farm with fields is placed and moved
// where no grass is free (no no_work_area); the lumberjack keeps its rule.
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

// TestDiagonalOnlyFieldIsInactive: a farm moved so that it meets its field
// at a corner only leaves the field inactive; an edge restores it.
func TestDiagonalOnlyFieldIsInactive(t *testing.T) {
	c := catalogue(t)
	w, farm := fieldsWorld(t, c)
	f := putField(t, w, c, farm, "pasture", 11, 5) // x 11..12, y 5..6, touches the farm's east edge
	is := w.Islands[0]
	// Farm at (8,7): x 8..10, y 7..9 meets the field at the corner (10,7)-(11,6) only.
	mustApply(t, w, c, MoveBuilding{IslandID: "main", BuildingID: farm, X: 8, Y: 7})
	if !is.Building(f).Inactive || is.Building(farm).Efficiency != 0 {
		t.Fatalf("diagonal contact: inactive %v, efficiency %d", is.Building(f).Inactive, is.Building(farm).Efficiency)
	}
	// Farm at (8,6): x 8..10, y 6..8 shares the edge segment y = 6.
	mustApply(t, w, c, MoveBuilding{IslandID: "main", BuildingID: farm, X: 8, Y: 6})
	if is.Building(f).Inactive || is.Building(farm).Efficiency != 250 {
		t.Fatalf("edge contact: inactive %v, efficiency %d", is.Building(f).Inactive, is.Building(farm).Efficiency)
	}
}
