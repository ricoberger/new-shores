package archipelago

import (
	"testing"
	"time"

	"github.com/ricoberger/new-shores/server/internal/sim"
)

// TestEncodedStateSize reports the persisted size of a new world on the
// dev seed (run with -v): the full envelope, and the split the store
// writes since schema 7 (the worlds.state JSONB without tiles plus the
// gzipped world_terrain row), with the buildable area. ARCHITECTURE §4.2:
// compress (zstd) once the state grows past ~1 MB.
func TestEncodedStateSize(t *testing.T) {
	c := catalogue(t)
	w, err := NewWorld(c, 1053001, time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatal(err)
	}
	full, err := sim.Encode(w, c.Region.Version)
	if err != nil {
		t.Fatal(err)
	}
	state, terrain, err := sim.EncodeState(w, c.Region.Version)
	if err != nil {
		t.Fatal(err)
	}
	tiles := 0
	for _, is := range w.Islands {
		tiles += len(is.Tiles)
	}
	t.Logf("%d islands, %d tiles, %d buildable; full envelope %d bytes, state %d bytes, terrain %d bytes (gzip)",
		len(w.Islands), tiles, buildableArea(w.Islands), len(full), len(state), len(terrain))
	if len(state) >= 1<<20 {
		t.Errorf("state %d bytes without tiles: past the ~1 MB compression threshold", len(state))
	}
}

// BenchmarkGenerate times the generator over consecutive seeds (D-054
// target: well under a second per archipelago).
func BenchmarkGenerate(b *testing.B) {
	c := catalogue(b)
	seed := uint64(1)
	for b.Loop() {
		if _, err := Generate(seed, c); err != nil {
			b.Fatal(err)
		}
		seed++
	}
}
