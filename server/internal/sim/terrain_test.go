package sim

import (
	"bytes"
	"strings"
	"testing"
)

// TestTerrainRoundTrip (D-054): EncodeState writes the state without tiles
// and the terrain apart; DecodeState joins them to the same world;
// mismatched or corrupt terrain is an error, and a full envelope decodes
// without terrain.
func TestTerrainRoundTrip(t *testing.T) {
	c := catalogue(t)
	w := testWorld(t, c)
	w.Islands = append(w.Islands, islandFromRows("rock", "~~~~", "~mf~", "~c.~", "~~~~"))
	w.Islands[1].Tiles[5].Deposit = &Deposit{Kind: "stone", Quantity: -1}
	full := encode(t, w)
	state, terrain, err := EncodeState(w, "test")
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(state, []byte(`"tiles"`)) || len(state) >= len(full) {
		t.Fatalf("state of %d bytes carries tiles", len(state))
	}
	got, cv, _, err := DecodeState(state, terrain, c)
	if err != nil || cv != "test" || !bytes.Equal(encode(t, got), full) {
		t.Fatalf("round trip: %v", err)
	}
	if _, terrain2, _ := EncodeState(got, "test"); !bytes.Equal(terrain2, terrain) {
		t.Error("terrain encoding is not deterministic")
	}
	// The full envelope needs no terrain; a bare state does.
	if got, _, _, err := DecodeState(full, nil, c); err != nil || !bytes.Equal(encode(t, got), full) {
		t.Errorf("full envelope: %v", err)
	}
	if _, _, _, err := DecodeState(state, nil, c); err == nil {
		t.Error("a state without terrain decoded")
	}
	// Terrain of another world.
	other := testWorld(t, c)
	_, otherTerrain, err := EncodeState(other, "test")
	if err != nil {
		t.Fatal(err)
	}
	if _, _, _, err := DecodeState(state, otherTerrain, c); err == nil || !strings.Contains(err.Error(), "decode terrain") {
		t.Errorf("foreign terrain: %v", err)
	}
	if _, _, _, err := DecodeState(state, []byte("not gzip"), c); err == nil {
		t.Error("corrupt terrain decoded")
	}
	w.Islands[1].Tiles[0].Terrain = "lava"
	if _, _, err := EncodeState(w, "test"); err == nil {
		t.Error("unknown terrain encoded")
	}
	if k := w.TerrainKey(); k != (TerrainKey{}) {
		t.Errorf("hand-made key %+v", k)
	}
}
