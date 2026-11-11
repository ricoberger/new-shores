package sim

import (
	"reflect"
	"testing"

	"github.com/ricoberger/new-shores/server/internal/content"
)

func gridTestWorld() *World {
	mk := func(id string, x, y int) *Island {
		is := &Island{ID: id, X: x, Y: y, Width: 20, Height: 20, Tiles: make([]Tile, 400), Roads: map[int]string{}}
		for i := range is.Tiles {
			is.Tiles[i].Terrain = content.TerrainWater
		}
		for yy := 5; yy < 15; yy++ {
			for xx := 5; xx < 15; xx++ {
				is.Tiles[yy*20+xx].Terrain = content.TerrainGrass
			}
		}
		return is
	}
	w := &World{Seed: 5}
	w.SetIslands(mk("a", 0, 0), mk("b", 60, 0), mk("c", 30, 40))
	return w
}

// A lent grid gives the same route as a fresh one, and the key follows
// the roads on water (a quay) but not roads on land.
func TestSeaGridLentEqualsFresh(t *testing.T) {
	w := gridTestWorld()
	a, b := Pos{2, 10}, Pos{80, 10}
	want := SeaRoute(w.Islands(), a, b)
	w.SetSeaGrid(BuildSeaGrid(w.Islands()))
	if got := w.seaGridFor(a, b); got.nx == 0 {
		t.Fatal("empty grid")
	}
	if got := seaRoute(w.seaGridFor(a, b), a, b); !reflect.DeepEqual(got, want) {
		t.Fatalf("lent grid route %v, want %v", got, want)
	}
	// A point outside the islands' bounds falls back to a fresh grid.
	far := Pos{-200, -200}
	if g := w.seaGridFor(a, far); g == w.seaGrid {
		t.Fatal("outside point used the lent grid")
	}
}

func TestSeaGridKey(t *testing.T) {
	w := gridTestWorld()
	k := SeaGridKey(w, 1)
	if k == "" || k != SeaGridKey(w, 1) {
		t.Fatalf("key unstable: %q", k)
	}
	if SeaGridKey(w, 2) == k {
		t.Error("generator version not in the key")
	}
	w.Islands()[0].Roads[5*20+5] = "road" // land tile
	if SeaGridKey(w, 1) != k {
		t.Error("a road on land changed the key")
	}
	w.Islands()[0].Roads[1] = "quay" // water tile
	if SeaGridKey(w, 1) == k {
		t.Error("a road on water did not change the key")
	}
	w.Seed = 0
	if SeaGridKey(w, 1) != "" {
		t.Error("unseeded world has a key")
	}
}
