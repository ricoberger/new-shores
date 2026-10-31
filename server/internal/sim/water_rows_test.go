package sim

import (
	"bytes"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/ricoberger/new-shores/server/internal/content"
)

var updateWaterRows = flag.Bool("update-water-rows", false, "regenerate server/testdata/water_rows/sites.json")

type waterTileFixture struct {
	X       int    `json:"x"`
	Y       int    `json:"y"`
	Water   bool   `json:"water"`
	Problem string `json:"problem"`
}

type waterSiteFixture struct {
	Name      string             `json:"name"`
	Width     int                `json:"width"`
	Height    int                `json:"height"`
	WaterRows content.WaterRows  `json:"water_rows"`
	X         int                `json:"x"`
	Y         int                `json:"y"`
	Rotation  int                `json:"rotation"`
	Rows      []string           `json:"rows"`
	Quays     []Pos              `json:"quays"`
	Error     string             `json:"error"`
	Tiles     []waterTileFixture `json:"tiles"`
}

// TestWaterRows exercises every rotation with an asymmetric footprint. Each
// input string is a column read from sea to land. 'q' is sea carrying a quay.
// Expectations are independent of the chosen-prefix implementation.
func TestWaterRows(t *testing.T) {
	c := shippedCatalogue(t)
	def := *c.BuildingByID["fisher"]
	c.BuildingByID[def.ID] = &def
	var fixtures []waterSiteFixture
	for _, rotation := range []int{0, 90, 180, 270} {
		for _, tc := range []struct {
			name     string
			min, max int
			columns  [3]string
			want     error
			bad      int
		}{
			{"min", 2, 3, [3]string{"~~c.....", "~~c.....", "~~c....."}, nil, 0},
			{"max", 2, 3, [3]string{"~~~c....", "~~~c....", "~~~c...."}, nil, 0},
			{"diagonal", 2, 3, [3]string{"~~c.....", "~~~c....", "~~c....."}, nil, 0},
			{"too-few", 2, 3, [3]string{"~c......", "~~c.....", "~~~c...."}, ErrNotOnWater, 1},
			{"too-many", 2, 3, [3]string{"~~c.....", "~~~~c...", "~~~c...."}, ErrTerrain, 1},
			{"water-after-land", 2, 3, [3]string{"~~c~....", "~~~c....", "~~c....."}, ErrTerrain, 1},
			{"river-front", 2, 3, [3]string{"r~c.....", "~~~c....", "~~c....."}, ErrNotOnWater, 1},
			{"river-back", 2, 3, [3]string{"~~cr....", "~~~c....", "~~c....."}, ErrTerrain, 1},
			{"mountain-back", 2, 3, [3]string{"~~cm....", "~~~c....", "~~c....."}, ErrTerrain, 1},
			{"quay-flexible", 2, 3, [3]string{"~~qc....", "~~~c....", "~~c....."}, nil, 0},
			{"quay-back", 2, 3, [3]string{"~~~qc...", "~~~c....", "~~c....."}, nil, 0},
			{"quay-required-water", 2, 3, [3]string{"~qc.....", "~~~c....", "~~c....."}, ErrOccupied, 1},
			{"quay-before-water", 2, 3, [3]string{"~~q~....", "~~~c....", "~~c....."}, ErrTerrain, 1},
			{"zero-min", 0, 1, [3]string{"c.......", "~c......", "c......."}, nil, 0},
			{"zero-water", 0, 1, [3]string{"c.......", "c.......", "c......."}, nil, 0},
			{"zero-max", 0, 0, [3]string{"c.......", "c.......", "c......."}, nil, 0},
			{"zero-max-water", 0, 0, [3]string{"~c......", "c.......", "c......."}, ErrTerrain, 1},
			{"equal-bounds", 2, 2, [3]string{"~~c.....", "~~c.....", "~~c....."}, nil, 0},
		} {
			t.Run(fmt.Sprintf("%s/%d", tc.name, rotation), func(t *testing.T) {
				def.WaterRows = &content.WaterRows{Min: tc.min, Max: tc.max}
				const x, y, size = 6, 6, 24
				// Explicit rotation of the authored columns; not waterPosition.
				at := func(column, row int) Pos {
					switch rotation {
					case 90:
						return Pos{x + 7 - row, y + column}
					case 180:
						return Pos{x + column, y + 7 - row}
					case 270:
						return Pos{x + row, y + column}
					default:
						return Pos{x + column, y + row}
					}
				}
				grid := make([][]byte, size)
				for i := range grid {
					grid[i] = []byte(strings.Repeat("~", size))
				}
				quays := []Pos{}
				for column, cells := range tc.columns {
					for row, cell := range cells {
						p := at(column, row)
						if cell == 'q' {
							quays = append(quays, p)
							cell = '~'
						}
						grid[p.Y][p.X] = byte(cell)
					}
				}
				rows := make([]string, size)
				for i := range grid {
					rows[i] = string(grid[i])
				}
				is := islandFromRows("main", rows...)
				is.Roads = map[int]string{}
				for _, p := range quays {
					is.Roads[is.index(p.X, p.Y)] = "quay"
				}
				err := CheckSite(is, c, &def, x, y, rotation)
				if !errors.Is(err, tc.want) {
					t.Fatalf("CheckSite = %v, want %v", err, tc.want)
				}
				if valid := NewSiteChecker(is, c).Valid(&def, x, y, rotation); valid != (tc.want == nil) {
					t.Fatalf("SiteChecker.Valid = %v, want %v", valid, tc.want == nil)
				}
				f := waterSiteFixture{Name: tc.name, Width: def.Width, Height: def.Height, WaterRows: *def.WaterRows, X: x, Y: y, Rotation: rotation, Rows: rows, Quays: quays, Tiles: []waterTileFixture{}}
				if tc.want != nil {
					f.Error = tc.want.Error()
				}
				depths := waterDepths(is, c, &def, x, y, rotation)
				bad := 0
				for column := range def.Width {
					for row := range def.Height {
						p := at(column, row)
						wet := waterAt(&def, depths, x, y, rotation, p.X, p.Y)
						terrain := is.Tile(p.X, p.Y).Terrain
						quay := quayAt(is, c, is.index(p.X, p.Y))
						problem := ""
						if wet && (terrain != content.TerrainWater || quay) {
							problem = "front"
						}
						if !wet && !buildableTerrain(terrain) && !quay {
							problem = "land"
						}
						if problem != "" {
							bad++
						}
						f.Tiles = append(f.Tiles, waterTileFixture{p.X, p.Y, wet, problem})
					}
				}
				if bad != tc.bad {
					t.Fatalf("%d invalid tiles, want %d", bad, tc.bad)
				}
				fixtures = append(fixtures, f)
				// Placement consumes valid quay tiles without refund and leaves
				// every failed command byte-identical.
				w := NewWorld(t0)
				w.Islands = []*Island{is}
				before := encode(t, w)
				err = PlaceFree(w, c, PlaceBuilding{IslandID: is.ID, Type: def.ID, X: x, Y: y, Rotation: rotation}, nil)
				if !errors.Is(err, tc.want) {
					t.Fatalf("PlaceFree = %v, want %v", err, tc.want)
				}
				if err != nil && !bytes.Equal(before, encode(t, w)) {
					t.Fatal("failed placement mutated world")
				}
				if err == nil && len(is.Roads) != 0 {
					t.Fatal("placement did not consume quay")
				}
			})
		}
	}
	data, err := json.MarshalIndent(fixtures, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	data = append(data, '\n')
	path := filepath.Join(repoRoot(t), "server", "testdata", "water_rows", "sites.json")
	if *updateWaterRows {
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
		t.Fatal("water rows fixture differs; run -update-water-rows and review")
	}
}

func TestWaterRowsHarbourFromFront(t *testing.T) {
	is := islandFromRows("main", strings.Repeat("~", 24))
	is.X, is.Y = 100, 200
	def := &content.Building{Width: 3, Height: 8}
	for rotation, want := range map[int]Pos{0: {107, 204}, 90: {115, 207}, 180: {107, 215}, 270: {104, 207}} {
		for _, r := range []content.WaterRows{{Min: 1, Max: 1}, {Min: 2, Max: 3}, {Min: 0, Max: 0}} {
			def.WaterRows = &r
			if got := HarbourAt(is, def, 6, 6, rotation); got != want {
				t.Errorf("rotation %d, rows %+v: harbour %v, want %v", rotation, r, got, want)
			}
		}
	}
}
