package archipelago

import (
	"path/filepath"
	"reflect"
	"runtime"
	"strings"
	"testing"

	"github.com/ricoberger/new-shores/server/internal/content"
	"github.com/ricoberger/new-shores/server/internal/sim"
)

// twoRegions loads the two-region test content of the content package
// (old_coast and south, D-076).
func twoRegions(t *testing.T) *content.Catalogue {
	t.Helper()
	_, file, _, _ := runtime.Caller(0)
	dir := filepath.Join(filepath.Dir(file), "..", "..")
	c, err := content.LoadWithSchemas(filepath.Join(dir, "content", "testdata", "regions"), filepath.Join(dir, "..", "..", "content", "schema"))
	if err != nil {
		t.Fatal(err)
	}
	return c
}

// TestRegionSeed: the home region's seed is the world seed; region i's
// is the world seed plus i, wrapped into 1..MaxSeed.
func TestRegionSeed(t *testing.T) {
	for _, tc := range []struct {
		seed  uint64
		index int
		want  uint64
	}{{1_053_001, 0, 1_053_001}, {1_053_001, 1, 1_053_002}, {1, 0, 1}, {MaxSeed, 0, MaxSeed}, {MaxSeed, 1, 1}, {MaxSeed - 1, 3, 2}} {
		if got := RegionSeed(tc.seed, tc.index); got != tc.want {
			t.Errorf("RegionSeed(%d, %d) = %d, want %d", tc.seed, tc.index, got, tc.want)
		}
	}
}

// TestGenerateRegion: region 0 is exactly the archipelago of the world
// seed (the world of before D-076); a later region is generated from
// world seed + index with its own catalogue: its own prefix and region.
func TestGenerateRegion(t *testing.T) {
	c := catalogue(t)
	home, err := GenerateRegion(1_053_001, 0, c)
	if err != nil {
		t.Fatal(err)
	}
	direct, err := Generate(1_053_001, c)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(home, direct) || home.Home != "oc-01" {
		t.Fatal("region 0 differs from the archipelago of the world seed")
	}
	if _, err := GenerateRegion(1, 1, c); err == nil {
		t.Fatal("generated a region the content does not list")
	}

	two := twoRegions(t)
	south, err := GenerateRegion(7, 1, two)
	if err != nil {
		t.Fatal(err)
	}
	again, err := Generate(8, two.Regions[1].Catalogue)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(south, again) {
		t.Fatal("region 1 is not the archipelago of seed + 1")
	}
	for _, is := range south.Islands {
		if !strings.HasPrefix(is.ID, two.Regions[1].Prefix+"-") || is.RegionID != "south" {
			t.Fatalf("south island %s in region %q", is.ID, is.RegionID)
		}
	}
}

// TestNewWorldRegions: a new world lists every content region in
// order; only the home region is generated and unlocked, its passage
// point is the start position and the start ship is on its map.
func TestNewWorldRegions(t *testing.T) {
	c := twoRegions(t)
	w, err := NewWorld(c, 7, worldStart)
	if err != nil {
		t.Fatal(err)
	}
	a, err := Generate(7, c)
	if err != nil {
		t.Fatal(err)
	}
	if len(w.Regions) != 2 {
		t.Fatalf("%d regions", len(w.Regions))
	}
	home, south := w.Regions[0], w.Regions[1]
	if home.ID != "old_coast" || !home.Unlocked || home.Seed != 7 || home.PassagePoint == nil || *home.PassagePoint != a.Ship || !reflect.DeepEqual(home.Islands, a.Islands) {
		t.Fatalf("home region %+v", home)
	}
	if south.ID != "south" || south.Unlocked || south.Seed != 8 || south.PassagePoint != nil || len(south.Islands) != 0 {
		t.Fatalf("south region %+v", south)
	}
	if !reflect.DeepEqual(w.Islands(), home.Islands) {
		t.Fatal("the world's islands are not the home region's")
	}
	if s := w.Ships[0]; s.RegionID != "old_coast" || s.AtSea == nil || *s.AtSea != a.Ship {
		t.Fatalf("start ship %+v", s)
	}
}

// TestRerollKeepsRegions: a re-roll replaces the home region's islands
// and passage point and keeps the other regions.
func TestRerollKeepsRegions(t *testing.T) {
	c := twoRegions(t)
	w, err := NewWorld(c, 7, worldStart)
	if err != nil {
		t.Fatal(err)
	}
	cmd, err := Reroll(w, c)
	if err != nil {
		t.Fatal(err)
	}
	if err := sim.Apply(w, c, cmd); err != nil {
		t.Fatal(err)
	}
	home := w.Regions[0]
	if len(w.Regions) != 2 || home.PassagePoint == nil || *home.PassagePoint != cmd.Spawn || !reflect.DeepEqual(home.Islands, cmd.Islands) || w.Regions[1].ID != "south" {
		t.Fatalf("regions after the reroll %+v", w.Regions)
	}
	for _, is := range w.Islands() {
		if is.RegionID != "old_coast" {
			t.Fatalf("island %s in region %q", is.ID, is.RegionID)
		}
	}
}
