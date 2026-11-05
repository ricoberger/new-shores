package archipelago

import (
	"fmt"
	"slices"
	"testing"

	"github.com/ricoberger/new-shores/server/internal/content"
)

// lateKinds are the deposit kinds first mined at tier 3 (D-056 C3);
// tierFourKinds those first mined at tier 4 (D-056 C4).
var (
	lateKinds     = []string{"clay", "salt", "coal"}
	tierFourKinds = []string{"quartz", "copper", "gold"}
)

func TestDepositTiers(t *testing.T) {
	tiers := depositTiers(catalogue(t))
	ids := func(pool []content.PoolEntry) []string {
		var out []string
		for _, e := range pool {
			out = append(out, e.ID)
		}
		return out
	}
	if len(tiers) != 3 || !slices.Equal(ids(tiers[0]), []string{"stone", "iron"}) || !slices.Equal(ids(tiers[1]), lateKinds) ||
		!slices.Equal(ids(tiers[2]), tierFourKinds) {
		t.Fatalf("deposit tiers %v", tiers)
	}
}

// TestDevSeedTierThreeDeposits: the dev seed (devworld.DevSeed, not
// imported) carries every tier-3 deposit, none on the home island.
func TestDevSeedTierThreeDeposits(t *testing.T) {
	c := catalogue(t)
	a, err := Generate(1_053_001, c)
	if err != nil {
		t.Fatal(err)
	}
	found := map[string][]string{}
	for _, is := range a.Islands {
		for kind, n := range DepositCounts(is) {
			if slices.Contains(lateKinds, kind) && n > 0 {
				found[kind] = append(found[kind], is.ID)
				if is.ID == a.Home {
					t.Errorf("home island %s has %d %s slots", is.ID, n, kind)
				}
			}
		}
	}
	for _, kind := range lateKinds {
		if len(found[kind]) == 0 {
			t.Errorf("no %s slot on the dev seed", kind)
		}
	}
	t.Logf("tier-3 deposits on the dev seed: %v", found)
}

// keepSeeds are the seeds whose islands keepsTheWorld compares tile by
// tile. Since D-072 part 2 a later tier's slot needs a free footprint
// 16 tiles from the others, which can turn down a shape the earlier
// slots fit on (the dev seed's small isle-10 with four slots), so the
// tile-level guarantee holds per seed; the composition (planComposition)
// stays the same on every seed (TestLaterTierDepositsKeepThePlan).
var keepSeeds = []uint64{1, 42}

// TestLaterTierDepositsKeepTheWorld: adding a later tier's deposits only
// turns mountain tiles into slots of the new kinds; terrain, fertilities
// and the earlier deposits of keepSeeds stay as without them.
func TestLaterTierDepositsKeepTheWorld(t *testing.T) {
	c := catalogue(t)
	// Without tier 4 (the C3 world) and without tiers 3 and 4 (the S1 world).
	for _, removed := range [][]string{tierFourKinds, append(slices.Clone(lateKinds), tierFourKinds...)} {
		t.Run(removed[0], func(t *testing.T) { keepsTheWorld(t, c, removed) })
	}
}

// TestLaterTierDepositsKeepThePlan: on the dev seed and keepSeeds the
// content without a later tier's deposits draws the same composition per
// archipelago attempt: island classes, massifs, fertilities and the
// earlier tiers' slots (as a prefix of each island's slot list).
func TestLaterTierDepositsKeepThePlan(t *testing.T) {
	c := catalogue(t)
	for _, removed := range [][]string{tierFourKinds, append(slices.Clone(lateKinds), tierFourKinds...)} {
		base := *c
		base.Islands.Deposits = slices.DeleteFunc(slices.Clone(c.Islands.Deposits), func(e content.PoolEntry) bool {
			return slices.Contains(removed, e.ID)
		})
		for _, seed := range append([]uint64{1_053_001}, keepSeeds...) {
			for attempt := range uint64(4) {
				sub := derive(seed, attempt)
				compose := func(c *content.Catalogue) ([]*plan, error) {
					late := func(k int) *rng { return newRNG(derive(sub, 3+uint64(k))) } // #nosec G115 -- k >= 1
					return planComposition(newRNG(derive(sub, 1)), newRNG(derive(sub, 65)), late, c)
				}
				with, err1 := compose(c)
				without, err2 := compose(&base)
				if err1 != nil || err2 != nil {
					continue // an unassignable composition is retried by Generate either way
				}
				if len(with) != len(without) {
					t.Fatalf("seed %d attempt %d: %d vs %d islands", seed, attempt, len(with), len(without))
				}
				for i, p := range with {
					q := without[i]
					if p.class != q.class || p.massifs != q.massifs || !slices.Equal(p.fertilities, q.fertilities) ||
						len(p.deposits) < len(q.deposits) || !slices.Equal(p.deposits[:len(q.deposits)], q.deposits) {
						t.Errorf("seed %d attempt %d without %v: island %d %v %d %v, was %v %d %v", seed, attempt, removed, i,
							p.deposits, p.massifs, p.fertilities, q.deposits, q.massifs, q.fertilities)
					}
				}
			}
		}
	}
}

// keepsTheWorld: the content without the removed deposit kinds generates
// the same islands as with them, except mountain tiles turned into slots
// of the removed kinds.
func keepsTheWorld(t *testing.T, c *content.Catalogue, removed []string) {
	base := *c
	base.Islands.Deposits = slices.DeleteFunc(slices.Clone(c.Islands.Deposits), func(e content.PoolEntry) bool {
		return slices.Contains(removed, e.ID)
	})
	for _, seed := range keepSeeds {
		with, err := Generate(seed, c)
		if err != nil {
			t.Fatal(err)
		}
		without, err := Generate(seed, &base)
		if err != nil {
			t.Fatal(err)
		}
		if len(with.Islands) != len(without.Islands) {
			t.Fatalf("seed %d: %d vs %d islands", seed, len(with.Islands), len(without.Islands))
		}
		for i, is := range with.Islands {
			was := without.Islands[i]
			if is.X != was.X || is.Y != was.Y || is.Width != was.Width || is.Height != was.Height || !slices.Equal(is.Fertilities, was.Fertilities) {
				t.Fatalf("seed %d: %s moved or changed size/fertilities", seed, is.ID)
			}
			for k, tile := range is.Tiles {
				old := was.Tiles[k]
				if tile.Terrain != old.Terrain {
					t.Fatalf("seed %d: %s tile %d terrain %s, was %s", seed, is.ID, k, tile.Terrain, old.Terrain)
				}
				switch {
				case old.Deposit != nil:
					if tile.Deposit == nil || tile.Deposit.Kind != old.Deposit.Kind {
						t.Fatalf("seed %d: %s tile %d lost its %s deposit", seed, is.ID, k, old.Deposit.Kind)
					}
				case tile.Deposit != nil:
					if !slices.Contains(removed, tile.Deposit.Kind) || tile.Terrain != content.TerrainMountain {
						t.Fatalf("seed %d: %s tile %d new deposit %s on %s", seed, is.ID, k, tile.Deposit.Kind, tile.Terrain)
					}
				}
			}
		}
	}
}

// TestDevSeedTierFourDeposits: the dev seed carries every tier-4 deposit
// (quartz, copper, gold), none on the home island.
func TestDevSeedTierFourDeposits(t *testing.T) {
	a, err := Generate(1_053_001, catalogue(t))
	if err != nil {
		t.Fatal(err)
	}
	found := map[string][]string{}
	for _, is := range a.Islands {
		for kind, n := range DepositCounts(is) {
			if slices.Contains(tierFourKinds, kind) && n > 0 {
				found[kind] = append(found[kind], is.ID)
				if is.ID == a.Home {
					t.Errorf("home island %s has %d %s slots", is.ID, n, kind)
				}
			}
		}
	}
	for _, kind := range tierFourKinds {
		if len(found[kind]) == 0 {
			t.Errorf("no %s slot on the dev seed", kind)
		}
	}
	t.Logf("tier-4 deposits on the dev seed: %v", found)
}

// TestGoldSlotGuaranteed: every archipelago has exactly one gold slot
// (D-056 §8: at least one; CONTENT §7: exactly one), never on the home
// island nor on a resource rock, over 200 seeds.
func TestGoldSlotGuaranteed(t *testing.T) {
	if testing.Short() {
		t.Skip("200 archipelagos")
	}
	c := catalogue(t)
	for seed := uint64(1); seed <= 200; seed++ {
		t.Run(fmt.Sprint(seed), func(t *testing.T) {
			t.Parallel()
			goldSlot(t, c, seed)
		})
	}
}

// goldSlot checks the gold slot of one seed's archipelago.
func goldSlot(t *testing.T, c *content.Catalogue, seed uint64) {
	a, err := Generate(seed, c)
	if err != nil {
		t.Fatal(err)
	}
	gold := 0
	for _, is := range a.Islands {
		n := DepositCounts(is)["gold"]
		gold += n
		if n > 0 && (is.ID == a.Home || c.Islands.SizeClassByID[is.SizeClass].Rock) {
			t.Errorf("seed %d: gold on %s (%s)", seed, is.ID, is.SizeClass)
		}
	}
	if gold != 1 {
		t.Errorf("seed %d: %d gold slots, want 1", seed, gold)
	}
}
