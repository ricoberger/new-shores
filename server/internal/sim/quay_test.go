package sim

import (
	"encoding/json"
	"errors"
	"flag"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/ricoberger/new-shores/server/internal/content"
)

// quayCoast is the open coast of the quay tests: water rows 0..8, the
// coast row 9 (a river mouth at x 20), grass below, an islet at (20,2).
// The Trading Post (6×9) stands at (2,6): its water rows 6..8, its
// harbour point (5,4).
func quayCoast() []string {
	rows := make([]string, 0, 18)
	for y := range 9 {
		if y == 2 {
			rows = append(rows, strings.Repeat("~", 20)+"i~~~")
			continue
		}
		rows = append(rows, strings.Repeat("~", 24))
	}
	rows = append(rows, strings.Repeat("c", 20)+"rccc")
	for range 8 {
		rows = append(rows, strings.Repeat(".", 24))
	}
	return rows
}

// quayWorld is a settled world on the rows with the Trading Post at
// (tpX, 6), the Citizens unlocked, gold and stone.
func quayWorld(t *testing.T, c *content.Catalogue, tpX int, rows ...string) *World {
	t.Helper()
	w := NewWorld(t0)
	w.Islands = []*Island{islandFromRows("main", rows...)}
	if err := PlaceFree(w, c, PlaceBuilding{IslandID: "main", Type: "trading_post", X: tpX, Y: 6}, nil); err != nil {
		t.Fatal(err)
	}
	w.Gold = 10_000_000
	w.UnlockedTiers = append(w.UnlockedTiers, "citizens")
	for _, g := range []string{"stone", "planks"} {
		if err := AddStock(w, c, "main", g, 100_000, nil); err != nil {
			t.Fatal(err)
		}
	}
	grantWorkers(t, w, c)
	return w
}

func quayRow(y, x0, x1 int) []Pos {
	var out []Pos
	for x := x0; x <= x1; x++ {
		out = append(out, Pos{x, y})
	}
	return out
}

func TestShallows(t *testing.T) {
	is := islandFromRows("main", quayCoast()...)
	for _, tc := range []struct {
		x, y int
		want bool
	}{
		{10, 8, true},   // next to the coast
		{10, 6, true},   // 3 tiles out
		{10, 5, false},  // 4 tiles out
		{20, 3, false},  // next to the islet only: not the island's own land
		{20, 6, true},   // 3 tiles off the river mouth's neighbours
		{20, 9, false},  // the river mouth
		{10, 9, false},  // land
		{-1, 8, false},  // off the grid
		{23, 6, true},   // diagonal reach (Chebyshev)
		{10, 17, false}, // grass
	} {
		if got := Shallow(is, tc.x, tc.y); got != tc.want {
			t.Errorf("Shallow(%d,%d) = %v, want %v", tc.x, tc.y, got, tc.want)
		}
	}
}

var updateShallows = flag.Bool("update-shallows", false, "regenerate server/testdata/quay/shallows.json")

// shallowsFixture is the shared fixture of the shallows rule
// (server/testdata/quay/shallows.json): the client's mirror
// (client/src/display/quay.ts) must give the same tiles.
type shallowsFixture struct {
	Reach    int      `json:"reach"`
	Rows     []string `json:"rows"`
	Shallows []Pos    `json:"shallows"`
}

func TestShallowsFixture(t *testing.T) {
	rows := quayCoast()
	is := islandFromRows("main", rows...)
	got := shallowsFixture{Reach: ShallowsReach, Rows: rows, Shallows: []Pos{}}
	for y := range is.Height {
		for x := range is.Width {
			if Shallow(is, x, y) {
				got.Shallows = append(got.Shallows, Pos{x, y})
			}
		}
	}
	path := filepath.Join(repoRoot(t), "server", "testdata", "quay", "shallows.json")
	if *updateShallows {
		data, err := json.MarshalIndent(got, "", "  ")
		if err != nil {
			t.Fatal(err)
		}
		if err := os.MkdirAll(filepath.Dir(path), 0o750); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, append(data, '\n'), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var want shallowsFixture
	if err := json.Unmarshal(data, &want); err != nil {
		t.Fatal(err)
	}
	gb, _ := json.Marshal(got)
	wb, _ := json.Marshal(want)
	if string(gb) != string(wb) {
		t.Errorf("shallows differ from %s (run with -update-shallows)", path)
	}
}

func TestPlaceQuay(t *testing.T) {
	c := shippedCatalogue(t)
	def := c.BuildingByID["quay"]
	if def == nil || def.Road == nil || !def.Road.Shallows || def.Tier != "citizens" {
		t.Fatalf("quay content: %+v", def)
	}

	t.Run("tier", func(t *testing.T) {
		w := quayWorld(t, c, 2, quayCoast()...)
		w.UnlockedTiers = nil
		if err := Apply(w, c, PlaceRoad{IslandID: "main", Type: "quay", Tiles: quayRow(8, 10, 12)}); !errors.Is(err, ErrTierLocked) {
			t.Fatalf("err = %v, want ErrTierLocked", err)
		}
	})

	for _, tc := range []struct {
		name  string
		road  string
		tiles []Pos
		want  error
	}{
		{"deep water", "quay", quayRow(5, 10, 12), ErrTerrain},
		{"land", "quay", quayRow(9, 10, 12), ErrTerrain},
		{"river", "quay", []Pos{{20, 9}}, ErrTerrain},
		{"islet shallows", "quay", []Pos{{20, 3}}, ErrTerrain},
		{"trading post water rows", "quay", quayRow(8, 6, 9), ErrOccupied},
		{"off the grid", "quay", []Pos{{24, 8}}, ErrOutOfBounds},
		{"land road on water", "road_dirt", quayRow(8, 10, 12), ErrTerrain},
	} {
		t.Run(tc.name, func(t *testing.T) {
			w := quayWorld(t, c, 2, quayCoast()...)
			before := encode(t, w)
			if err := Apply(w, c, PlaceRoad{IslandID: "main", Type: tc.road, Tiles: tc.tiles}); !errors.Is(err, tc.want) {
				t.Fatalf("err = %v, want %v", err, tc.want)
			}
			if string(encode(t, w)) != string(before) {
				t.Error("world changed on error")
			}
		})
	}

	t.Run("charges per tile", func(t *testing.T) {
		w := quayWorld(t, c, 2, quayCoast()...)
		gold, stone := w.Gold, w.Island("main").Inventory.Stock["stone"]
		tiles := append(quayRow(8, 10, 14), quayRow(7, 10, 14)...)
		mustApply(t, w, c, PlaceRoad{IslandID: "main", Type: "quay", Tiles: tiles})
		n := int64(len(tiles))
		if got, want := gold-w.Gold, n*def.Cost.Gold; got != want || want != n*5_000 {
			t.Errorf("gold charged %d, want %d (5 per tile)", got, want)
		}
		if got := stone - w.Island("main").Inventory.Stock["stone"]; got != n*2_000 {
			t.Errorf("stone charged %d, want %d (2 per tile)", got, n*2_000)
		}
		is := w.Island("main")
		for _, p := range tiles {
			if is.RoadAt(p.X, p.Y) != "quay" {
				t.Errorf("no quay at %v", p)
			}
		}
	})
}

// TestQuayCarriesWaterEdgeBuildings: a fisher's land rows stand on quay
// tiles (they count as coast and are replaced); the rest of the quay
// connects it to the Trading Post like a road. A house does not stand on
// a quay.
func TestQuayCarriesWaterEdgeBuildings(t *testing.T) {
	c := shippedCatalogue(t)
	w := quayWorld(t, c, 2, quayCoast()...)
	fisher := PlaceBuilding{IslandID: "main", Type: "fisher", X: 10, Y: 3}
	if err := Apply(w, c, fisher); !errors.Is(err, ErrTerrain) {
		t.Fatalf("fisher on water without quay: err = %v, want ErrTerrain", err)
	}
	var quay []Pos
	for y := 6; y <= 8; y++ {
		quay = append(quay, quayRow(y, 10, 12)...)
	}
	quay = append(quay, quayRow(8, 8, 9)...)
	mustApply(t, w, c, PlaceRoad{IslandID: "main", Type: "quay", Tiles: quay})

	house := PlaceBuilding{IslandID: "main", Type: "house_settlers", X: 10, Y: 7}
	if err := Apply(w, c, house); !errors.Is(err, ErrTerrain) {
		t.Fatalf("house on quay: err = %v, want ErrTerrain", err)
	}
	mustApply(t, w, c, fisher)
	is := w.Island("main")
	for y := 6; y <= 8; y++ {
		for x := 10; x <= 12; x++ {
			if rt := is.RoadAt(x, y); rt != "" {
				t.Errorf("quay at (%d,%d) under the fisher: %q", x, y, rt)
			}
		}
	}
	var tp, f *Building
	for _, b := range is.Buildings {
		switch b.Type {
		case "trading_post":
			tp = b
		case "fisher":
			f = b
		}
	}
	if f == nil || tp == nil || f.AssignedWarehouseID != tp.ID {
		t.Fatalf("fisher not connected over the quay: %+v", f)
	}
	if f.TransferDelayMs != c.Region.Rules.TransferBaseMs+2*c.BuildingByID["quay"].Road.MsPerTile {
		t.Errorf("transfer delay %d ms, want base + 2 quay tiles", f.TransferDelayMs)
	}
}

// TestQuayIsLandForShips: quay tiles are land on the sea grid; a quay
// across the mouth of a bay that holds the harbour point is rejected,
// one with a gap is not.
func TestQuayIsLandForShips(t *testing.T) {
	c := shippedCatalogue(t)
	w := quayWorld(t, c, 2, quayCoast()...)
	is := w.Island("main")
	if newSeaGrid(w.Islands).land[newSeaGrid(w.Islands).cellOf(16, 5)] {
		t.Fatal("cell of (16,5) is land before the quay")
	}
	mustApply(t, w, c, PlaceRoad{IslandID: "main", Type: "quay", Tiles: quayRow(6, 16, 19)})
	g := newSeaGrid(w.Islands)
	if !g.land[g.cellOf(16, 5)] || !g.landAt(17, 6) || g.landAt(17, 5) {
		t.Error("quay tiles are not land for ships")
	}
	if !harbourRoutable(c, is) {
		t.Error("open coast harbour not routable")
	}

	// A bay as wide as the Trading Post: land columns 0..2 and 9..13 in
	// rows 2..8; the harbour point (6,4) lies in the bay's shallows.
	bay := make([]string, 0, 16)
	bay = append(bay, strings.Repeat("~", 14), strings.Repeat("~", 14))
	for range 7 {
		bay = append(bay, "ccc~~~~~~ccccc")
	}
	bay = append(bay, strings.Repeat("c", 14))
	for range 6 {
		bay = append(bay, strings.Repeat(".", 14))
	}
	w = quayWorld(t, c, 3, bay...)
	if !harbourRoutable(c, w.Island("main")) {
		t.Fatal("bay harbour not routable without quays")
	}
	mustApply(t, w, c, PlaceRoad{IslandID: "main", Type: "quay", Tiles: quayRow(2, 3, 7)})
	before := encode(t, w)
	if err := Apply(w, c, PlaceRoad{IslandID: "main", Type: "quay", Tiles: []Pos{{8, 2}}}); !errors.Is(err, ErrHarbourBlocked) {
		t.Fatalf("closing the bay: err = %v, want ErrHarbourBlocked", err)
	}
	if string(encode(t, w)) != string(before) {
		t.Error("world changed on error")
	}
}
