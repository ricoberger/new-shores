package sim

import (
	"bytes"
	"encoding/json"
	"errors"
	"flag"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
)

// laneWorld is a world on rows with the Trading Post at (x, y) and the
// rotation, plenty of gold, stone and planks, Citizens and Merchants open.
func laneWorld(t *testing.T, rows []string, x, y, rotation int) *World {
	t.Helper()
	c := shippedCatalogue(t)
	w := NewWorld(t0)
	w.SetIslands(islandFromRows("main", rows...))
	if err := PlaceFree(w, c, PlaceBuilding{IslandID: "main", Type: "trading_post", X: x, Y: y, Rotation: rotation}, nil); err != nil {
		t.Fatal(err)
	}
	w.Gold = 100_000_000
	w.UnlockedTiers = append(w.UnlockedTiers, "citizens", "merchants", "patricians")
	for _, g := range []string{"stone", "planks", "bricks"} {
		if err := AddStock(w, c, "main", g, 290_000, nil); err != nil {
			t.Fatal(err)
		}
	}
	return w
}

// expectLane applies cmd and checks the error (nil or ErrHarbourLane or
// another sentinel); a failed command leaves the world unchanged.
func expectLane(t *testing.T, w *World, cmd Command, want error) {
	t.Helper()
	c := shippedCatalogue(t)
	before := encode(t, w)
	if err := Apply(w, c, cmd); !errors.Is(err, want) {
		t.Fatalf("Apply(%#v) = %v, want %v", cmd, err, want)
	}
	if want != nil && string(before) != string(encode(t, w)) {
		t.Fatalf("failed %#v changed the world", cmd)
	}
}

// TestLaneTiles (D-078 §1): the lane is the footprint's width plus one
// column on each side, four rows in front of the water edge, for every
// rotation; buildings without harbour_lane have none.
func TestLaneTiles(t *testing.T) {
	c := shippedCatalogue(t)
	is := NewIsland("main", 40, 40, make([]Tile, 1600))
	tp := c.BuildingByID["trading_post"] // 6 × 6
	for _, tc := range []struct {
		rotation       int
		x0, y0, x1, y1 int // the lane's bounding box
	}{
		{0, 9, 6, 16, 9},
		{90, 16, 9, 19, 16},
		{180, 9, 16, 16, 19},
		{270, 6, 9, 9, 16},
	} {
		tiles := laneTiles(is, tp, 10, 10, tc.rotation)
		if len(tiles) != 8*4 {
			t.Fatalf("rotation %d: %d tiles, want 32", tc.rotation, len(tiles))
		}
		for _, p := range tiles {
			if p.X < tc.x0 || p.X > tc.x1 || p.Y < tc.y0 || p.Y > tc.y1 {
				t.Fatalf("rotation %d: tile %v outside (%d,%d)-(%d,%d)", tc.rotation, p, tc.x0, tc.y0, tc.x1, tc.y1)
			}
		}
	}
	for _, id := range []string{"trading_post", "trading_pier", "depot", "shipyard", "kontor", "repair_crane"} {
		if !c.BuildingByID[id].HarbourLane {
			t.Errorf("%s holds no harbour lane", id)
		}
	}
	for _, id := range []string{"fisher", "harbour_tower", "harbour_statue", "quay", "salt_pans"} {
		if def := c.BuildingByID[id]; def != nil && (def.HarbourLane || laneTiles(is, def, 10, 10, 0) != nil) {
			t.Errorf("%s holds a harbour lane", id)
		}
	}
}

// TestHarbourLaneQuays (D-078 §1): quays stay off the Trading Post's lane
// in front of it and on its corner tiles (diagonally in front); right
// beside the Trading Post and beside the lane they are fine. With the
// Trading Post turned to the east the lane turns with it.
func TestHarbourLaneQuays(t *testing.T) {
	// shoreWorld: sea above row 18; the Trading Post at (4,16), lane
	// x 3..10, y 12..15.
	w := shoreWorld(t)
	expectLane(t, w, PlaceRoad{IslandID: "main", Type: "quay", Tiles: []Pos{{6, 15}}}, ErrHarbourLane)
	expectLane(t, w, PlaceRoad{IslandID: "main", Type: "quay", Tiles: []Pos{{3, 12}}}, ErrHarbourLane)
	expectLane(t, w, PlaceRoad{IslandID: "main", Type: "quay", Tiles: []Pos{{10, 15}}}, ErrHarbourLane)
	expectLane(t, w, PlaceRoad{IslandID: "main", Type: "quay", Tiles: quayColumn(10, 16, 17)}, nil)
	expectLane(t, w, PlaceRoad{IslandID: "main", Type: "quay", Tiles: quayColumn(11, 11, 17)}, nil)
	// Just beyond the lane, anchored to the column at x 11: fine.
	expectLane(t, w, PlaceRoad{IslandID: "main", Type: "quay", Tiles: quayRow(11, 4, 10)}, nil)
	// Planned quays obey the same rule.
	expectLane(t, w, PlaceRoad{IslandID: "main", Type: "quay", Tiles: []Pos{{6, 14}}, Planned: true}, ErrHarbourLane)

	// Sea to the east (x >= 20); the Trading Post at (16,10) turned 90°:
	// its front is the column x 21, the lane x 22..25, y 9..16.
	rows := make([]string, 0, 30)
	for range 30 {
		rows = append(rows, strings.Repeat(".", 19)+"c"+strings.Repeat("~", 20))
	}
	w = laneWorld(t, rows, 16, 10, 90)
	expectLane(t, w, PlaceRoad{IslandID: "main", Type: "quay", Tiles: []Pos{{22, 12}}}, ErrHarbourLane)
	expectLane(t, w, PlaceRoad{IslandID: "main", Type: "quay", Tiles: []Pos{{25, 16}}}, ErrHarbourLane)
	expectLane(t, w, PlaceRoad{IslandID: "main", Type: "quay", Tiles: quayRow(17, 20, 26)}, nil)
	expectLane(t, w, PlaceRoad{IslandID: "main", Type: "quay", Tiles: quayColumn(26, 9, 16)}, nil)
}

// TestHarbourLaneShoreBuildings (D-078 §1): a shore building may not
// reach into another berth holder's lane (placed, planned or moved
// there); a berth holder's own lane may not cover a quay, a shore
// building or a paint tile; a building never blocks itself when moved.
func TestHarbourLaneShoreBuildings(t *testing.T) {
	c := shippedCatalogue(t)
	w := shoreWorld(t)
	is := w.Island("main")
	// A depot on the beach whose left column is the lane's side column.
	expectLane(t, w, PlaceBuilding{IslandID: "main", Type: "depot", X: 10, Y: 7}, ErrHarbourLane)
	expectLane(t, w, PlaceBuilding{IslandID: "main", Type: "depot", X: 10, Y: 7, Planned: true}, ErrHarbourLane)
	mustApply(t, w, c, PlaceBuilding{IslandID: "main", Type: "depot", X: 11, Y: 7})
	depot := is.Buildings[len(is.Buildings)-1]
	// Moved back into the Trading Post's lane: refused; moved forward by
	// one, into its own old lane: fine.
	expectLane(t, w, MoveBuilding{IslandID: "main", BuildingID: depot.ID, X: 10, Y: 7}, ErrHarbourLane)
	expectLane(t, w, MoveBuilding{IslandID: "main", BuildingID: depot.ID, X: 11, Y: 6}, ErrShoreBackEdge)
	expectLane(t, w, MoveBuilding{IslandID: "main", BuildingID: depot.ID, X: 11, Y: 8}, nil)
	expectLane(t, w, MoveBuilding{IslandID: "main", BuildingID: depot.ID, X: 11, Y: 7}, nil)

	// A pier further along (lane x 23..30, y 8..11, flanks x 23 and 30):
	// quays on its flank are fine, a harbour statue standing on them
	// inside the lane is not.
	expectLane(t, w, PlaceBuilding{IslandID: "main", Type: "trading_pier", X: 24, Y: 12}, nil)
	expectLane(t, w, PlaceRoad{IslandID: "main", Type: "quay", Tiles: append(quayColumn(31, 12, 17), Pos{30, 12})}, nil)
	expectLane(t, w, PlaceBuilding{IslandID: "main", Type: "harbour_statue", X: 30, Y: 10}, ErrHarbourLane)

	// A planned trading pier's lane (x 16..23, y 8..11) counts like a
	// built one's.
	expectLane(t, w, PlaceBuilding{IslandID: "main", Type: "trading_pier", X: 17, Y: 12, Planned: true}, nil)
	expectLane(t, w, PlaceRoad{IslandID: "main", Type: "quay", Tiles: []Pos{{16, 11}}}, ErrHarbourLane)
	expectLane(t, w, PlaceRoad{IslandID: "main", Type: "quay", Tiles: []Pos{{16, 11}}, Planned: true}, ErrHarbourLane)

	// Symmetric: a depot whose lane would cover the quay column x 16.
	w = shoreWorld(t)
	mustApply(t, w, c, PlaceRoad{IslandID: "main", Type: "quay", Tiles: quayColumn(16, 10, 17)})
	expectLane(t, w, PlaceBuilding{IslandID: "main", Type: "depot", X: 17, Y: 12}, ErrHarbourLane)
	expectLane(t, w, PlaceBuilding{IslandID: "main", Type: "depot", X: 18, Y: 12}, nil)
}

// TestHarbourLanePaint (D-078 §1): paint tiles stay off a lane where it
// reaches land (a spit beside the Trading Post).
func TestHarbourLanePaint(t *testing.T) {
	rows := make([]string, 0, 30)
	for y := range 30 {
		switch {
		case y < 12:
			rows = append(rows, strings.Repeat("~", 30))
		case y < 18:
			// A spit of coast in column 10, beside the Trading Post.
			rows = append(rows, strings.Repeat("~", 10)+"c"+strings.Repeat("~", 19))
		case y == 18:
			rows = append(rows, strings.Repeat("c", 30))
		default:
			rows = append(rows, strings.Repeat(".", 30))
		}
	}
	w := laneWorld(t, rows, 4, 16, 0)
	res := paintAt(t, w, PlacePaint{IslandID: "main", Type: "hedge", Tiles: []Pos{{10, 13}, {10, 16}, {10, 15}}})
	for i, want := range []error{ErrHarbourLane, nil, ErrHarbourLane} {
		if !errors.Is(res[i].Err, want) {
			t.Fatalf("tile %v: %v, want %v", res[i], res[i].Err, want)
		}
	}
}

var updateLanes = flag.Bool("update-lanes", false, "regenerate server/testdata/lane/lanes.json")

type laneFixture struct {
	Type     string `json:"type"`
	Width    int    `json:"width"`
	Height   int    `json:"height"`
	X        int    `json:"x"`
	Y        int    `json:"y"`
	Rotation int    `json:"rotation"`
	IslandW  int    `json:"island_width"`
	IslandH  int    `json:"island_height"`
	Tiles    []Pos  `json:"tiles"`
}

// TestLaneFixture writes the lanes of every shipped berth holder at each
// rotation, inside an island and clipped at its corner, for the client's
// lane ghost (client/src/display/lane.test.ts).
func TestLaneFixture(t *testing.T) {
	c := shippedCatalogue(t)
	rows := make([]string, 24)
	for i := range rows {
		rows[i] = strings.Repeat(".", 24)
	}
	is := islandFromRows("main", rows...)
	var out []laneFixture
	for _, def := range c.Buildings {
		if !def.HarbourLane {
			continue
		}
		for _, at := range []Pos{{8, 8}, {0, 0}} {
			for _, rotation := range []int{0, 90, 180, 270} {
				out = append(out, laneFixture{
					Type: def.ID, Width: def.Width, Height: def.Height, X: at.X, Y: at.Y, Rotation: rotation,
					IslandW: is.Width, IslandH: is.Height, Tiles: LaneTiles(is, def, at.X, at.Y, rotation),
				})
			}
		}
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].Type < out[j].Type })
	data, err := json.MarshalIndent(out, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	data = append(data, '\n')
	path := filepath.Join(repoRoot(t), "server", "testdata", "lane", "lanes.json")
	if *updateLanes {
		if err := os.MkdirAll(filepath.Dir(path), 0o750); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, data, 0o600); err != nil {
			t.Fatal(err)
		}
	}
	want, err := os.ReadFile(path) // #nosec G304 -- test fixture.
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(want, data) {
		t.Fatal("lane fixture differs; run -update-lanes and review")
	}
}
