package sim

import (
	"errors"
	"fmt"
	"strings"
	"testing"
)

// depotRows lays the authored columns of a 4×11 depot (each read from the
// sea to the land, 11 tiles) onto a 40×40 sea at (x, y) in the given
// rotation, with an explicit mapping independent of waterPosition.
func depotRows(x, y, rotation int, columns [4]string) []string {
	const size = 40
	grid := make([][]byte, size)
	for i := range grid {
		grid[i] = []byte(strings.Repeat("~", size))
	}
	for column, cells := range columns {
		for row := range len(cells) {
			p := Pos{x + column, y + row}
			switch rotation {
			case 90:
				p = Pos{x + 10 - row, y + column}
			case 180:
				p = Pos{x + column, y + 10 - row}
			case 270:
				p = Pos{x + row, y + column}
			}
			grid[p.Y][p.X] = cells[row]
		}
	}
	rows := make([]string, size)
	for i := range grid {
		rows[i] = string(grid[i])
	}
	return rows
}

// The depot (4×11, water rows 7–9, D-062 correction) fits a coast in every
// rotation when each column has 7–9 water tiles then land, also on a
// diagonal coast; it is refused with 6 or 10 water tiles in a column.
func TestDepotPlacementPerRotation(t *testing.T) {
	c := shippedCatalogue(t)
	def := c.BuildingByID["depot"]
	if def.Width != 4 || def.Height != 11 || def.WaterRows == nil || def.WaterRows.Min != 7 || def.WaterRows.Max != 9 {
		t.Fatalf("depot content: %+v", def)
	}
	w7, w8, w9 := "~~~~~~~cccc", "~~~~~~~~ccc", "~~~~~~~~~cc"
	for _, rotation := range []int{0, 90, 180, 270} {
		for _, tc := range []struct {
			name    string
			columns [4]string
			want    error
		}{
			{"seven", [4]string{w7, w7, w7, w7}, nil},
			{"nine", [4]string{w9, w9, w9, w9}, nil},
			{"diagonal", [4]string{w7, w8, w9, w8}, nil},
			{"too-short", [4]string{w7, "~~~~~~cc..."[:11], w7, w7}, ErrNotOnWater},
			{"too-far-out", [4]string{w9, w9, "~~~~~~~~~~c", w9}, ErrTerrain},
			{"water-after-land", [4]string{w8, "~~~~~~~~c~c", w8, w8}, ErrTerrain},
		} {
			t.Run(fmt.Sprintf("%s/%d", tc.name, rotation), func(t *testing.T) {
				is := islandFromRows("main", depotRows(10, 10, rotation, tc.columns)...)
				err := CheckSite(is, c, def, 10, 10, rotation)
				if !errors.Is(err, tc.want) {
					t.Fatalf("CheckSite = %v, want %v", err, tc.want)
				}
				if valid := NewSiteChecker(is, c).Valid(def, 10, 10, rotation); valid != (tc.want == nil) {
					t.Fatalf("SiteChecker.Valid = %v, want %v", valid, tc.want == nil)
				}
			})
		}
	}
}

// A depot is never a berth holder, and its water rows are not land for
// ships (like the pier's): placing one beside, or right in front of, a
// Trading Post cannot cut the Trading Post's harbour point off the open
// sea, so harbour_blocked has nothing to refuse. A depot whose land rows
// stand on quays replaces them, which only opens water.
func TestDepotNextToTradingPostKeepsTheHarbourOpen(t *testing.T) {
	c := shippedCatalogue(t)
	// Sea above row 18, land below; a Trading Post at x 4..9, y 16..21
	// (2 water rows) whose harbour point lies two tiles off its front.
	rows := make([]string, 0, 40)
	for y := range 40 {
		ch := "."
		switch {
		case y < 18:
			ch = "~"
		case y == 18:
			ch = "c"
		}
		rows = append(rows, strings.Repeat(ch, 40))
	}
	for _, tc := range []struct {
		name string
		x    int
	}{{"beside", 10}, {"in-front", 5}, {"beside-far", 14}} {
		t.Run(tc.name, func(t *testing.T) {
			w := NewWorld(t0)
			w.Islands = []*Island{islandFromRows("main", rows...)}
			if err := PlaceFree(w, c, PlaceBuilding{IslandID: "main", Type: "trading_post", X: 4, Y: 16}, nil); err != nil {
				t.Fatal(err)
			}
			w.Gold = 10_000_000
			w.UnlockedTiers = append(w.UnlockedTiers, "citizens")
			for _, g := range []string{"stone", "planks"} {
				if err := AddStock(w, c, "main", g, 100_000, nil); err != nil {
					t.Fatal(err)
				}
			}
			is := w.Island("main")
			tp := is.Buildings[0]
			if !harbourRoutable(c, is) {
				t.Fatal("the bare Trading Post must be routable")
			}
			// Depot: water y 9..17, land 18..19; "in-front" overlaps the Trading
			// Post's own water rows and must be refused as occupied.
			err := Apply(w, c, PlaceBuilding{IslandID: "main", Type: "depot", X: tc.x, Y: 9})
			if tc.name == "in-front" {
				if !errors.Is(err, ErrOccupied) {
					t.Fatalf("depot over the Trading Post: %v", err)
				}
			} else if err != nil {
				t.Fatalf("depot: %v", err)
			}
			if !harbourRoutable(c, is) || !seaReachable(is, HarbourAt(is, c.BuildingByID["trading_post"], tp.X, tp.Y, tp.Rotation)) {
				t.Fatal("a depot must not close the Trading Post's harbour")
			}
		})
	}
}
