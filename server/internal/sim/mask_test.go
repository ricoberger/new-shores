package sim

import (
	"strings"
	"testing"
)

func maskIsland(rows ...string) *Island {
	names := map[byte]string{'w': "water", 'c': "coast", 'g': "grass", 'f': "forest", 'm': "mountain"}
	is := &Island{Width: len(rows[0]), Height: len(rows)}
	for _, r := range rows {
		for i := range len(r) {
			is.Tiles = append(is.Tiles, Tile{Terrain: names[r[i]]})
		}
	}
	return is
}

// TestTerrainMask: one character per 4×4 block, the majority terrain,
// water on ties, edge blocks counting only the island's tiles.
func TestTerrainMask(t *testing.T) {
	is := maskIsland(
		"wwccggggf",
		"wwccggggf",
		"ggggffmmw",
		"ggggffmmw",
		"mmmfwwwww",
	)
	// Block (0,0): w4 c4 g8 → g. Block (1,0): g8 f4 m4 → g. Block (2,0): f2 w2 → tie → w.
	// Row 2 (only y=4): (0,0) m3 f1 → m; (1,0) w4 → w; (2,0) w1 → w.
	if got := TerrainMask(is); got != "ggw"+"mww" {
		t.Fatalf("mask %q", got)
	}
	// A tie between land terrains: coast before mountain before forest before grass.
	if got := TerrainMask(maskIsland("ffgg", "ffgg", "ffgg", "ffgg")); got != "f" {
		t.Errorf("forest/grass tie %q", got)
	}
	if got := TerrainMask(maskIsland("ccmm", "ccmm", "ccmm", "ccmm")); got != "c" {
		t.Errorf("coast/mountain tie %q", got)
	}
	// Missing tiles count as water; size ceil(w/4)·ceil(h/4).
	if got := TerrainMask(&Island{Width: 9, Height: 5}); got != strings.Repeat("w", 6) {
		t.Errorf("empty island %q", got)
	}
}
