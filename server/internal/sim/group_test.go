package sim

import (
	"bytes"
	"errors"
	"testing"
)

// groupWorld is shoreWorld (sea above row 18, the Trading Post at
// (4,16)) with a quarter: houses at (20,24) and (23,24), a dirt road
// along y 27 from x 20 to 28, a sheep farm at (26,24) with two pastures
// east of it at (29,24) and (29,27). It returns the IDs of the houses,
// the farm and the pastures.
func groupWorld(t *testing.T) (*World, []int64) {
	t.Helper()
	c := shippedCatalogue(t)
	w := shoreWorld(t)
	is := w.Island("main")
	var ids []int64
	place := func(cmd Command) {
		t.Helper()
		mustApply(t, w, c, cmd)
		ids = append(ids, is.Buildings[len(is.Buildings)-1].ID)
	}
	place(PlaceBuilding{IslandID: "main", Type: "house_settlers", X: 20, Y: 24})
	place(PlaceBuilding{IslandID: "main", Type: "house_settlers", X: 23, Y: 24})
	mustApply(t, w, c, PlaceRoad{IslandID: "main", Type: "road_dirt", Tiles: quayRow(27, 20, 28)})
	place(PlaceBuilding{IslandID: "main", Type: "sheep_farm", X: 26, Y: 24})
	place(PlaceField{IslandID: "main", FarmID: ids[2], Type: "pasture", X: 29, Y: 24})
	place(PlaceField{IslandID: "main", FarmID: ids[2], Type: "pasture", X: 29, Y: 27})
	return w, ids
}

// expectGroup applies a MoveGroup; on failure it checks the sentinel and
// the failing building (GroupMoveError) and that the world is unchanged.
func expectGroup(t *testing.T, w *World, cmd MoveGroup, want error, failing int64) {
	t.Helper()
	c := shippedCatalogue(t)
	before := encode(t, w)
	err := Apply(w, c, cmd)
	if !errors.Is(err, want) {
		t.Fatalf("Apply(%+v) = %v, want %v", cmd, err, want)
	}
	if want == nil {
		return
	}
	if !bytes.Equal(before, encode(t, w)) {
		t.Fatalf("failed %+v changed the world", cmd)
	}
	var ge *GroupMoveError
	if failing >= 0 {
		if !errors.As(err, &ge) || ge.BuildingID != failing {
			t.Fatalf("Apply(%+v) = %v, want building %d to fail", cmd, err, failing)
		}
	}
}

// TestMoveGroupQuarter (D-074 §5): houses, a road and a farm with its
// fields move by one offset; IDs, the farm and the fields' farm stay;
// the old tiles are free, the road is re-laid; nothing is charged.
func TestMoveGroupQuarter(t *testing.T) {
	c := shippedCatalogue(t)
	w, ids := groupWorld(t)
	is := w.Island("main")
	gold := w.Gold
	expectGroup(t, w, MoveGroup{IslandID: "main", X0: 20, Y0: 24, X1: 31, Y1: 29, DX: 2, DY: 6}, nil, -1)
	for i, want := range []Pos{{22, 30}, {25, 30}, {28, 30}, {31, 30}, {31, 33}} {
		b := is.Building(ids[i])
		if b == nil || b.X != want.X || b.Y != want.Y {
			t.Fatalf("building %d at %+v, want %v", ids[i], b, want)
		}
	}
	for _, f := range ids[3:] {
		if b := is.Building(f); b.FarmID != ids[2] || b.Inactive {
			t.Errorf("pasture %d: farm %d, inactive %v", f, b.FarmID, b.Inactive)
		}
	}
	for x := 20; x <= 28; x++ {
		if is.Roads[is.index(x, 27)] != "" || is.Roads[is.index(x+2, 33)] != "road_dirt" {
			t.Fatalf("road not re-laid at x %d", x)
		}
	}
	if is.BuildingAt(c, 20, 24) != nil {
		t.Error("the old site is still occupied")
	}
	if w.Gold != gold {
		t.Errorf("the move cost %d milli-gold", gold-w.Gold)
	}
	// A one-tile shift overlaps the group's own old tiles: fine.
	expectGroup(t, w, MoveGroup{IslandID: "main", X0: 22, Y0: 30, X1: 33, Y1: 35, DX: -1, DY: 0}, nil, -1)
	if b := is.Building(ids[0]); b.X != 21 || b.Y != 30 {
		t.Errorf("house at (%d,%d) after the shift", b.X, b.Y)
	}
}

// TestMoveGroupPartialOverlap: a building only partly inside the
// rectangle stays; the group may not land on it (the first failing
// building is named).
func TestMoveGroupPartialOverlap(t *testing.T) {
	w, ids := groupWorld(t)
	// x 20..27 holds both houses whole; the farm (26..28) is only partly in.
	expectGroup(t, w, MoveGroup{IslandID: "main", X0: 20, Y0: 24, X1: 27, Y1: 26, DX: 3, DY: 0}, ErrOccupied, ids[1])
	// Without overlap the houses move and the farm stays.
	expectGroup(t, w, MoveGroup{IslandID: "main", X0: 20, Y0: 24, X1: 27, Y1: 26, DX: -6, DY: 0}, nil, -1)
	is := w.Island("main")
	if b := is.Building(ids[2]); b.X != 26 || b.Y != 24 {
		t.Errorf("the farm moved to (%d,%d)", b.X, b.Y)
	}
	if b := is.Building(ids[1]); b.X != 17 {
		t.Errorf("house 2 at x %d", b.X)
	}
}

// TestMoveGroupCoast: onto the coast row is fine, into the sea is not
// (terrain), off the island is out of bounds.
func TestMoveGroupCoast(t *testing.T) {
	w, ids := groupWorld(t)
	expectGroup(t, w, MoveGroup{IslandID: "main", X0: 20, Y0: 24, X1: 25, Y1: 26, DX: 0, DY: -7}, ErrTerrain, ids[0])
	expectGroup(t, w, MoveGroup{IslandID: "main", X0: 20, Y0: 24, X1: 25, Y1: 26, DX: 30, DY: 0}, ErrOutOfBounds, ids[0])
	expectGroup(t, w, MoveGroup{IslandID: "main", X0: 20, Y0: 24, X1: 25, Y1: 26, DX: 0, DY: -6}, nil, -1)
	if b := w.Island("main").Building(ids[0]); b.Y != 18 {
		t.Errorf("house at y %d, want the coast row 18", b.Y)
	}
}

// TestMoveGroupRotation: the group turns about its rectangle; a building
// turns with it and a road tile follows.
func TestMoveGroupRotation(t *testing.T) {
	c := shippedCatalogue(t)
	w := shoreWorld(t)
	is := w.Island("main")
	mustApply(t, w, c, PlaceBuilding{IslandID: "main", Type: "house_settlers", X: 20, Y: 24})
	house := is.Buildings[len(is.Buildings)-1].ID
	mustApply(t, w, c, PlaceRoad{IslandID: "main", Type: "road_dirt", Tiles: quayRow(27, 20, 23)})
	// The rectangle x 20..23, y 24..27 (4 × 4) turned 90° clockwise: the
	// road row y 27 becomes the column x 20; the house moves to x 21.
	expectGroup(t, w, MoveGroup{IslandID: "main", X0: 20, Y0: 24, X1: 23, Y1: 27, Rotation: 90}, nil, -1)
	if b := is.Building(house); b.X != 21 || b.Y != 24 || b.Rotation != 90 {
		t.Errorf("house at (%d,%d) rotation %d", b.X, b.Y, b.Rotation)
	}
	for y := 24; y <= 27; y++ {
		if is.Roads[is.index(20, y)] != "road_dirt" {
			t.Errorf("no road at (20,%d)", y)
		}
	}
	expectGroup(t, w, MoveGroup{IslandID: "main", X0: 20, Y0: 24, X1: 23, Y1: 27, Rotation: 45}, ErrInvalidCommand, -1)
}

// TestMoveGroupRules: an empty rectangle, a rectangle off the island and
// a quay moved into a harbour lane (D-078 §1, a road tile: no building)
// fail.
func TestMoveGroupRules(t *testing.T) {
	c := shippedCatalogue(t)
	w := shoreWorld(t)
	expectGroup(t, w, MoveGroup{IslandID: "main", X0: 30, Y0: 30, X1: 32, Y1: 32, DX: 1}, ErrInvalidCommand, -1)
	expectGroup(t, w, MoveGroup{IslandID: "main", X0: 38, Y0: 38, X1: 40, Y1: 40, DX: 1}, ErrOutOfBounds, -1)
	expectGroup(t, w, MoveGroup{IslandID: "nowhere", X0: 1, Y0: 1, X1: 2, Y1: 2}, ErrUnknownIsland, -1)
	mustApply(t, w, c, PlaceRoad{IslandID: "main", Type: "quay", Tiles: []Pos{{14, 17}}})
	// The Trading Post's lane is x 3..10, y 12..15.
	expectGroup(t, w, MoveGroup{IslandID: "main", X0: 14, Y0: 17, X1: 14, Y1: 17, DX: -4, DY: -2}, ErrHarbourLane, 0)
	// Beside the coast it stays anchored.
	expectGroup(t, w, MoveGroup{IslandID: "main", X0: 14, Y0: 17, X1: 14, Y1: 17, DX: 2}, nil, -1)
	// Out on the open water it would float.
	expectGroup(t, w, MoveGroup{IslandID: "main", X0: 16, Y0: 17, X1: 16, Y1: 17, DY: -3}, ErrQuayDisconnected, 0)
}
