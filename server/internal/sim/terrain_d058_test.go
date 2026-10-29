package sim

import (
	"bytes"
	"compress/gzip"
	"encoding/json"
	"errors"
	"testing"

	"github.com/ricoberger/new-shores/server/internal/content"
)

// d058World is testWorld with a river across the grass at x = 10 (rows
// 5-8), an islet off the coast and a cliff tile, with levels and heights.
func d058World(t *testing.T, c *content.Catalogue) *World {
	t.Helper()
	w := testWorld(t, c)
	is := w.Islands[0]
	for y := 5; y <= 8; y++ {
		is.Tiles[is.index(10, y)].Terrain = content.TerrainRiver
	}
	is.Tiles[is.index(19, 0)].Terrain = content.TerrainIslet
	is.Tiles[is.index(18, 1)].Terrain = content.TerrainCliff
	for i := range is.Tiles {
		if is.Tiles[i].Terrain != content.TerrainWater && i%is.Width > 6 {
			is.Tiles[i].Level = 1
		}
	}
	is.Tiles[is.index(18, 2)].Height = 3
	return w
}

// TestTerrainD058RoundTrip: river, islet and cliff tiles and the levels
// and heights survive EncodeState/DecodeState (schema 11) and the full
// envelope; a world without levels writes no level string.
func TestTerrainD058RoundTrip(t *testing.T) {
	c := catalogue(t)
	w := d058World(t, c)
	full := encode(t, w)
	state, terrain, err := EncodeState(w, "test")
	if err != nil {
		t.Fatal(err)
	}
	got, _, _, err := DecodeState(state, terrain, c)
	if err != nil || !bytes.Equal(encode(t, got), full) {
		t.Fatalf("round trip: %v", err)
	}
	is := got.Islands[0]
	if is.Tile(10, 6).Terrain != content.TerrainRiver || is.Tile(19, 0).Terrain != content.TerrainIslet ||
		is.Tile(18, 1).Terrain != content.TerrainCliff || is.Tile(8, 5).Level != 1 || is.Tile(2, 5).Level != 0 || is.Tile(18, 2).Height != 3 {
		t.Errorf("decoded tiles lost the D-058 terrain")
	}
	flat := testWorld(t, c)
	doc := terrainDocOf(t, flat)
	if doc.Islands[0].Levels != "" || doc.Islands[0].Heights != "" {
		t.Errorf("a flat world writes levels %q heights %q", doc.Islands[0].Levels, doc.Islands[0].Heights)
	}
	w.Islands[0].Tiles[0].Level = 10
	if _, _, err := EncodeState(w, "test"); err == nil {
		t.Error("level 10 encoded")
	}
}

// TestTerrainD058Rules: buildings and fields stay off rivers, islets and
// cliffs; a road may cross a river (a bridge, D-058 part 3) but not an
// islet or a cliff.
func TestTerrainD058Rules(t *testing.T) {
	c := catalogue(t)
	tests := []struct {
		name string
		cmd  Command
		want error
	}{
		{"building on a river", PlaceBuilding{IslandID: "main", Type: "sawmill", X: 9, Y: 5}, ErrTerrain},
		{"road on an islet", PlaceRoad{IslandID: "main", Type: "road_dirt", Tiles: []Pos{{19, 0}}}, ErrTerrain},
		{"road on a cliff", PlaceRoad{IslandID: "main", Type: "road_dirt", Tiles: []Pos{{18, 1}}}, ErrTerrain},
		{"bridge", PlaceRoad{IslandID: "main", Type: "road_dirt", Tiles: []Pos{{9, 6}, {10, 6}, {11, 6}}}, nil},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			w := d058World(t, c)
			if err := Apply(w, c, tt.cmd); !errors.Is(err, tt.want) {
				t.Fatalf("err = %v, want %v", err, tt.want)
			}
		})
	}
	// A building cannot stand on a bridge, and the road keeps working.
	w := d058World(t, c)
	mustApply(t, w, c, PlaceRoad{IslandID: "main", Type: "road_dirt", Tiles: []Pos{{10, 7}}})
	if err := Apply(w, c, PlaceBuilding{IslandID: "main", Type: "sawmill", X: 10, Y: 6}); !errors.Is(err, ErrTerrain) {
		t.Errorf("building over a bridge: %v", err)
	}
	mustApply(t, w, c, DemolishRoad{IslandID: "main", Tiles: []Pos{{10, 7}}})
}

func terrainDocOf(t *testing.T, w *World) terrainDoc {
	t.Helper()
	data, err := EncodeTerrain(w)
	if err != nil {
		t.Fatal(err)
	}
	zr, err := gzip.NewReader(bytes.NewReader(data))
	if err != nil {
		t.Fatal(err)
	}
	var doc terrainDoc
	if err := json.NewDecoder(zr).Decode(&doc); err != nil {
		t.Fatal(err)
	}
	return doc
}
