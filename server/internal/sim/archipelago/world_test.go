package archipelago

import (
	"bytes"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/ricoberger/new-shores/server/internal/sim"
)

var worldStart = time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)

func newWorld(t *testing.T, seed uint64) *sim.World {
	t.Helper()
	w, err := NewWorld(catalogue(t), seed, worldStart)
	if err != nil {
		t.Fatal(err)
	}
	return w
}

func encode(t *testing.T, w *sim.World) []byte {
	t.Helper()
	b, err := json.Marshal(w)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func reroll(t *testing.T, w *sim.World) error {
	t.Helper()
	cmd, err := Reroll(w, catalogue(t))
	if err != nil {
		return err
	}
	return sim.Apply(w, catalogue(t), cmd)
}

// arrive sails ship 1 to the home island and advances to its arrival.
func arrive(t *testing.T, w *sim.World) {
	t.Helper()
	c := catalogue(t)
	if err := sim.Apply(w, c, sim.SailShip{ShipID: 1, ToIslandID: w.Islands[0].ID}); err != nil {
		t.Fatal(err)
	}
	if _, err := sim.Advance(w, c, time.UnixMilli(w.Ships[0].Leg.ArriveAtMs).UTC()); err != nil {
		t.Fatal(err)
	}
}

// found founds the home island at its first Trading Post site.
func found(t *testing.T, w *sim.World) {
	t.Helper()
	c := catalogue(t)
	home := w.Islands[0]
	tp := TradingPost(c)
	for _, r := range Sites(home, c, tp) {
		if sim.Apply(w, c, sim.FoundIsland{ShipID: 1, IslandID: home.ID, BuildingType: tp.ID, X: r.X, Y: r.Y, Rotation: r.Rotation}) == nil {
			return
		}
	}
	t.Fatal("no Trading Post site founds the home island")
}

// TestReroll: the next roll replaces the islands, keeps the seed, counts
// the roll, returns the ship to the new spawn with its cargo and is
// deterministic.
func TestReroll(t *testing.T) {
	c := catalogue(t)
	w := newWorld(t, 7)
	before := encode(t, w)
	cargo := append([]sim.Slot(nil), w.Ships[0].Cargo...)
	if err := reroll(t, w); err != nil {
		t.Fatal(err)
	}
	want, err := Generate(RollSeed(7, 1), c)
	if err != nil {
		t.Fatal(err)
	}
	if w.Seed != 7 || w.ArchipelagoRoll != 1 || len(w.Islands) != len(want.Islands) {
		t.Fatalf("seed %d roll %d islands %d", w.Seed, w.ArchipelagoRoll, len(w.Islands))
	}
	for i, is := range w.Islands {
		if is.ID != want.Islands[i].ID || is.X != want.Islands[i].X || is.Name != want.Islands[i].Name {
			t.Fatalf("island %d = %s at (%d,%d), want %s at (%d,%d)", i, is.ID, is.X, is.Y, want.Islands[i].ID, want.Islands[i].X, want.Islands[i].Y)
		}
	}
	s := w.Ships[0]
	if s.AtSea == nil || *s.AtSea != want.Ship || s.IslandID != "" || s.State != sim.ShipIdle {
		t.Fatalf("ship %+v, want idle at %+v", s, want.Ship)
	}
	if b, _ := json.Marshal(s.Cargo); !bytes.Equal(b, mustJSON(t, cargo)) {
		t.Errorf("cargo %s, want %s", b, mustJSON(t, cargo))
	}
	// The same rolls again give the same world.
	again := newWorld(t, 7)
	if !bytes.Equal(encode(t, again), before) {
		t.Fatal("NewWorld is not deterministic")
	}
	if err := reroll(t, again); err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(encode(t, again), encode(t, w)) {
		t.Error("the reroll is not deterministic")
	}
	// A second roll differs from the first.
	if err := reroll(t, w); err != nil {
		t.Fatal(err)
	}
	if w.ArchipelagoRoll != 2 || bytes.Equal(encode(t, again), encode(t, w)) {
		t.Errorf("roll 2 = roll 1 (roll %d)", w.ArchipelagoRoll)
	}
}

func mustJSON(t *testing.T, v any) []byte {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

// TestRerollAllowed: allowed while no island is settled and no ship is
// under way (also with the ship idle at an unsettled island); a refused
// reroll leaves the world unchanged.
func TestRerollAllowed(t *testing.T) {
	c := catalogue(t)
	refused := func(w *sim.World, want error) {
		t.Helper()
		before := encode(t, w)
		if err := reroll(t, w); !errors.Is(err, want) {
			t.Fatalf("reroll = %v, want %v", err, want)
		}
		if !bytes.Equal(before, encode(t, w)) {
			t.Fatal("a refused reroll changed the world")
		}
	}
	// On a leg.
	w := newWorld(t, 11)
	if err := sim.Apply(w, c, sim.SailShip{ShipID: 1, ToIslandID: w.Islands[0].ID}); err != nil {
		t.Fatal(err)
	}
	refused(w, sim.ErrRerollNotAllowed)
	// Idle at an unsettled island: allowed, back at sea.
	w = newWorld(t, 11)
	arrive(t, w)
	if err := reroll(t, w); err != nil || w.Ships[0].AtSea == nil || w.Ships[0].IslandID != "" {
		t.Fatalf("reroll at an unsettled island = %v, ship %+v", err, w.Ships[0])
	}
	// Settled.
	w = newWorld(t, 11)
	arrive(t, w)
	found(t, w)
	refused(w, sim.ErrRerollNotAllowed)
	// Hand-made (no seed).
	w = newWorld(t, 11)
	w.Seed = 0
	refused(w, sim.ErrRerollNotAllowed)
	// A command that is not the next roll.
	w = newWorld(t, 11)
	cmd, err := Reroll(w, c)
	if err != nil {
		t.Fatal(err)
	}
	cmd.Roll = 2
	if err := sim.Apply(w, c, cmd); !errors.Is(err, sim.ErrInvalidCommand) {
		t.Fatalf("roll 2 after roll 0 = %v", err)
	}
}

// TestRenameIsland: settled islands only; the name is trimmed and must
// have 1-24 printable runes.
func TestRenameIsland(t *testing.T) {
	c := catalogue(t)
	w := newWorld(t, 13)
	home := w.Islands[0].ID
	if err := sim.Apply(w, c, sim.RenameIsland{IslandID: home, Name: "Haven"}); !errors.Is(err, sim.ErrIslandNotSettled) {
		t.Fatalf("rename unsettled = %v", err)
	}
	if err := sim.Apply(w, c, sim.RenameIsland{IslandID: "nowhere", Name: "Haven"}); !errors.Is(err, sim.ErrUnknownIsland) {
		t.Fatalf("rename unknown = %v", err)
	}
	arrive(t, w)
	found(t, w)
	for _, tc := range []struct{ in, want string }{
		{"  Gull Haven ", "Gull Haven"},
		{strings.Repeat("ä", 24), strings.Repeat("ä", 24)},
		{"X", "X"},
	} {
		if err := sim.Apply(w, c, sim.RenameIsland{IslandID: home, Name: tc.in}); err != nil || w.Island(home).Name != tc.want {
			t.Errorf("rename %q = %v, name %q (want %q)", tc.in, err, w.Island(home).Name, tc.want)
		}
	}
	for _, bad := range []string{"", "   ", strings.Repeat("a", 25), "Gull\tHaven", "Gull\x00", "\xff"} {
		before := encode(t, w)
		if err := sim.Apply(w, c, sim.RenameIsland{IslandID: home, Name: bad}); !errors.Is(err, sim.ErrInvalidName) {
			t.Errorf("rename %q = %v, want invalid name", bad, err)
		}
		if !bytes.Equal(before, encode(t, w)) {
			t.Errorf("a refused rename %q changed the world", bad)
		}
	}
}
