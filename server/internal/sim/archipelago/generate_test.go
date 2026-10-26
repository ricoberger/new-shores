package archipelago

import (
	"encoding/json"
	"path/filepath"
	"runtime"
	"sync"
	"testing"

	"github.com/ricoberger/new-shores/server/internal/content"
	"github.com/ricoberger/new-shores/server/internal/sim"
)

var (
	catOnce sync.Once
	cat     *content.Catalogue
	catErr  error
)

// catalogue loads the shipped content once per test binary.
func catalogue(t testing.TB) *content.Catalogue {
	t.Helper()
	catOnce.Do(func() {
		_, file, _, _ := runtime.Caller(0)
		cat, catErr = content.Load(filepath.Join(filepath.Dir(file), "..", "..", "..", "..", "content", "old_coast"))
	})
	if catErr != nil {
		t.Fatal(catErr)
	}
	return cat
}

func TestGenerateVerifies(t *testing.T) {
	c := catalogue(t)
	for seed := uint64(1); seed <= 8; seed++ {
		a, err := Generate(seed, c)
		if err != nil {
			t.Fatalf("seed %d: %v", seed, err)
		}
		if err := Verify(a, c); err != nil {
			t.Errorf("seed %d: %v", seed, err)
		}
		if a.Seed != seed || a.Home != a.Islands[0].ID || !IsHomeCandidate(a.Islands[0], &c.Islands) {
			t.Errorf("seed %d: home %q, first island %q", seed, a.Home, a.Islands[0].ID)
		}
	}
}

func TestGenerateDeterministic(t *testing.T) {
	c := catalogue(t)
	encode := func(seed uint64) string {
		a, err := Generate(seed, c)
		if err != nil {
			t.Fatal(err)
		}
		b, err := json.Marshal(a)
		if err != nil {
			t.Fatal(err)
		}
		return string(b)
	}
	first, second := encode(42), encode(42)
	if first != second {
		t.Error("the same seed produced different archipelagos")
	}
	if first == encode(43) {
		t.Error("different seeds produced the same archipelago")
	}
}

func TestRollSeed(t *testing.T) {
	if RollSeed(7, 0) != 7 {
		t.Error("roll 0 must keep the world seed")
	}
	seen := map[uint64]bool{7: true}
	for roll := 1; roll <= 50; roll++ {
		s := RollSeed(7, roll)
		if s > MaxSeed || seen[s] {
			t.Fatalf("roll %d: seed %d out of range or repeated", roll, s)
		}
		seen[s] = true
		if RollSeed(7, roll) != s {
			t.Fatal("RollSeed is not deterministic")
		}
	}
}

func TestRNGBounds(t *testing.T) {
	r := newRNG(1)
	for range 1000 {
		if v := r.between(-3, 4); v < -3 || v > 4 {
			t.Fatalf("between: %d", v)
		}
		if v := r.intn(7); v < 0 || v >= 7 {
			t.Fatalf("intn: %d", v)
		}
	}
	if r.between(5, 5) != 5 || r.between(5, 2) != 5 {
		t.Error("degenerate range")
	}
}

func TestVerifyRejects(t *testing.T) {
	c := catalogue(t)
	a, err := Generate(3, c)
	if err != nil {
		t.Fatal(err)
	}
	// Two islands on top of each other break the spacing.
	a.Islands[1].X, a.Islands[1].Y = a.Islands[0].X, a.Islands[0].Y
	if Verify(a, c) == nil {
		t.Error("overlapping islands verified")
	}
	b, _ := Generate(3, c)
	b.Ship = sim.Pos{X: b.Islands[0].X + b.Islands[0].Width/2, Y: b.Islands[0].Y + b.Islands[0].Height/2}
	if Verify(b, c) == nil {
		t.Error("ship on an island verified")
	}
}
