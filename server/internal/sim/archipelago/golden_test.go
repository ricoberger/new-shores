package archipelago

import (
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/ricoberger/new-shores/server/internal/content"
	"github.com/ricoberger/new-shores/server/internal/sim"
)

var update = flag.Bool("update", false, "regenerate the archipelago goldens")

// goldenSeeds are the archipelagos pinned by full tile maps: the dev seed
// (devworld.DevSeed, not imported to keep the generator free of the dev
// package) and two others.
var goldenSeeds = []uint64{1_053_001, 1, 42}

// render writes an archipelago as text: the spawn and bounds, then per
// island its identity, position, size, fertilities and deposit counts and
// its tile map ('~' water, 'c' coast, '.' grass, 'f' forest, 'm' mountain,
// 'r' river, 'i' islet, 'k' cliff, deposits by the upper-case initial of
// their kind, as in scenario documents).
func render(a *Archipelago) string {
	var b strings.Builder
	x0, y0, x1, y1 := Bounds(a.Islands)
	fmt.Fprintf(&b, "seed %d home %s ship (%d,%d) bounds (%d,%d)-(%d,%d)\n", a.Seed, a.Home, a.Ship.X, a.Ship.Y, x0, y0, x1, y1)
	for _, is := range a.Islands {
		deposits := DepositCounts(is)
		fmt.Fprintf(&b, "\n%s %q %s at (%d,%d) %dx%d fertilities %v slots iron %d stone %d\n",
			is.ID, is.Name, is.SizeClass, is.X, is.Y, is.Width, is.Height, is.Fertilities, deposits["iron"], deposits["stone"])
		// Levels and heights as a digest (FNV-1a of the digit rows) with
		// the tile count per level.
		var levels [3]int
		hash := uint32(2166136261)
		for _, t := range is.Tiles {
			levels[min(t.Level, 2)]++
			for _, v := range [2]int{t.Level, t.Height} {
				hash = (hash ^ uint32(v)) * 16777619 // #nosec G115 -- 0..9
			}
		}
		fmt.Fprintf(&b, "levels %d/%d/%d digest %08x\n", levels[0], levels[1], levels[2], hash)
		for y := range is.Height {
			row := make([]byte, is.Width)
			for x := range is.Width {
				row[x] = tileChar(is.Tile(x, y))
			}
			b.Write(row)
			b.WriteByte('\n')
		}
	}
	return b.String()
}

func tileChar(t sim.Tile) byte {
	if t.Deposit != nil {
		return strings.ToUpper(t.Deposit.Kind[:1])[0]
	}
	switch t.Terrain {
	case content.TerrainWater:
		return '~'
	case content.TerrainCoast:
		return 'c'
	case content.TerrainForest:
		return 'f'
	case content.TerrainMountain:
		return 'm'
	case content.TerrainRiver:
		return 'r'
	case content.TerrainIslet:
		return 'i'
	case content.TerrainCliff:
		return 'k'
	}
	return '.'
}

// TestGolden pins the archipelagos of the golden seeds tile by tile; a
// change to the generator or islands.json that moves a single tile shows
// up here (run with -update and review the maps).
func TestGolden(t *testing.T) {
	c := catalogue(t)
	for _, seed := range goldenSeeds {
		t.Run(fmt.Sprint(seed), func(t *testing.T) {
			a, err := Generate(seed, c)
			if err != nil {
				t.Fatal(err)
			}
			got := render(a)
			path := filepath.Join("testdata", fmt.Sprintf("seed_%d.golden.txt", seed))
			if *update {
				if err := os.MkdirAll("testdata", 0o750); err != nil {
					t.Fatal(err)
				}
				if err := os.WriteFile(path, []byte(got), 0o600); err != nil {
					t.Fatal(err)
				}
				return
			}
			want, err := os.ReadFile(path) // #nosec G304 -- fixed test path
			if err != nil {
				t.Fatalf("read golden (run with -update): %v", err)
			}
			if got != string(want) {
				t.Errorf("archipelago of seed %d differs from %s (run with -update and review the diff)", seed, path)
			}
		})
	}
}
