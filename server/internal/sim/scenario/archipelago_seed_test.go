package scenario

import (
	"fmt"
	"testing"

	"github.com/ricoberger/new-shores/server/internal/sim/archipelago"
)

// TestArchipelagoSeed: seed.archipelago builds the generated archipelago
// (D-053) instead of hand-made islands; the start ship waits at its spawn.
func TestArchipelagoSeed(t *testing.T) {
	c := loadCatalogue(t)
	doc := func(seed uint64, extra string) []byte {
		return fmt.Appendf(nil, `{"name": "gen", "start": "2026-01-01T00:00:00Z", %s "seed": {"archipelago": %d, "start": true}, "steps": []}`, extra, seed)
	}
	for _, bad := range [][]byte{
		doc(7, `"island": {"rows": ["c."]},`),
		doc(7, `"islands": [{"id": "a", "rows": ["c."]}],`),
		doc(archipelago.MaxSeed+1, ""),
	} {
		if _, err := Parse(bad); err == nil {
			t.Errorf("Parse(%s) succeeded", bad)
		}
	}
	s, err := Parse(doc(7, ""))
	if err != nil {
		t.Fatal(err)
	}
	w, err := BuildWorld(s, c, nil)
	if err != nil {
		t.Fatal(err)
	}
	a, err := archipelago.Generate(7, c)
	if err != nil {
		t.Fatal(err)
	}
	if w.Seed != 7 || len(w.Islands) != len(a.Islands) || w.Islands[0].ID != a.Islands[0].ID {
		t.Fatalf("seed %d, %d islands (want 7, %d)", w.Seed, len(w.Islands), len(a.Islands))
	}
	if len(w.Ships) != 1 || w.Ships[0].AtSea == nil || *w.Ships[0].AtSea != a.Ship {
		t.Fatalf("ships %+v, want the start ship at %+v", w.Ships, a.Ship)
	}
}
