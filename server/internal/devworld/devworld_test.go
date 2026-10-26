package devworld

import (
	"path/filepath"
	"reflect"
	"runtime"
	"testing"
	"time"

	"github.com/ricoberger/new-shores/server/internal/content"
	"github.com/ricoberger/new-shores/server/internal/sim"
	"github.com/ricoberger/new-shores/server/internal/sim/archipelago"
)

func catalogue(t *testing.T) *content.Catalogue {
	t.Helper()
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller failed")
	}
	c, err := content.Load(filepath.Join(filepath.Dir(file), "..", "..", "..", "content", "old_coast"))
	if err != nil {
		t.Fatal(err)
	}
	return c
}

var start = time.Date(2026, 10, 19, 12, 0, 0, 123_456_789, time.UTC)

// TestNewIsTheSeededArchipelago: a new world (default mode and --dev) is
// the generated archipelago of its seed, no island settled, the start
// ship at the archipelago's spawn carrying exactly the content starting
// stock (start.json, the gold on the balance; D-051, D-053).
func TestNewIsTheSeededArchipelago(t *testing.T) {
	c := catalogue(t)
	w, err := New(c, DevSeed, start)
	if err != nil {
		t.Fatal(err)
	}
	a, err := archipelago.Generate(DevSeed, c)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(w.Islands, a.Islands) {
		t.Error("world islands differ from the generated archipelago")
	}
	if w.Seed != DevSeed || w.ArchipelagoRoll != 0 || !w.LastEvaluatedAt.Equal(start.Truncate(time.Millisecond)) {
		t.Errorf("seed %d roll %d evaluated %s", w.Seed, w.ArchipelagoRoll, w.LastEvaluatedAt)
	}
	for _, is := range w.Islands {
		if len(is.Buildings) != 0 {
			t.Errorf("%s is settled", is.ID)
		}
	}
	if w.Gold != c.Start.Gold || len(w.Ships) != 1 {
		t.Fatalf("gold %d ships %d", w.Gold, len(w.Ships))
	}
	s := w.Ships[0]
	if s.Type != c.Ships[0].ID || s.State != sim.ShipIdle || s.AtSea == nil || *s.AtSea != a.Ship {
		t.Errorf("start ship %+v, want idle at sea at %+v", s, a.Ship)
	}
	cargo := map[string]sim.Qty{}
	for _, slot := range s.Cargo {
		cargo[slot.Good] += slot.Amount
	}
	for _, g := range c.Start.Goods {
		if cargo[g.Good] != g.Amount {
			t.Errorf("cargo %s = %d, want %d", g.Good, cargo[g.Good], g.Amount)
		}
	}
	if _, err := New(c, 0, start); err == nil {
		t.Error("seed 0 accepted")
	}
	if _, err := New(c, archipelago.MaxSeed+1, start); err == nil {
		t.Error("a seed above MaxSeed accepted")
	}
}

func TestNewIsDeterministic(t *testing.T) {
	c := catalogue(t)
	encode := func(seed uint64) string {
		w, err := New(c, seed, start)
		if err != nil {
			t.Fatal(err)
		}
		b, err := sim.Encode(w, c.Region.Version)
		if err != nil {
			t.Fatal(err)
		}
		return string(b)
	}
	first := encode(DevSeed)
	if first != encode(DevSeed) {
		t.Error("the same seed built different worlds")
	}
	if first == encode(DevSeed+1) {
		t.Error("different seeds built the same world")
	}
}

func TestRandomSeed(t *testing.T) {
	seen := map[uint64]bool{}
	for range 20 {
		s := RandomSeed()
		if s == 0 || s > archipelago.MaxSeed {
			t.Fatalf("seed %d out of range", s)
		}
		seen[s] = true
	}
	if len(seen) < 19 {
		t.Errorf("%d distinct seeds of 20", len(seen))
	}
}

// TestDevTravelTime (R-18): the start ship reaches the home island, and a
// sloop leg from it to its nearest habitable neighbour takes, between 1
// and 5 minutes.
func TestDevTravelTime(t *testing.T) {
	c := catalogue(t)
	w, err := New(c, DevSeed, start)
	if err != nil {
		t.Fatal(err)
	}
	f := &fixture{c: c, w: w}
	home, next := w.Island(f.home()), w.Island(f.neighbour(f.home()))
	speed, rate := c.ShipByID["sloop"].SpeedPermille, c.Region.Rules.ShipSpeedMilliTilesPerMin
	p := *w.Ships[0].AtSea
	for name, ms := range map[string]int64{
		"spawn to home":     sim.TravelMs(p.X, p.Y, home.X, home.Y, speed, rate),
		"home to neighbour": sim.TravelMs(home.X, home.Y, next.X, next.Y, speed, rate),
	} {
		t.Logf("%s: %d ms", name, ms)
		if ms < 60_000 || ms > 300_000 {
			t.Errorf("%s: %d ms outside 1-5 min", name, ms)
		}
	}
}
