package archipelago

import (
	"slices"
	"testing"

	"github.com/ricoberger/new-shores/server/internal/content"
)

// lateKinds are the deposit kinds first mined at tier 3 (D-056 C3).
var lateKinds = []string{"clay", "salt", "coal"}

func TestDepositTiers(t *testing.T) {
	tiers := depositTiers(catalogue(t))
	ids := func(pool []content.PoolEntry) []string {
		var out []string
		for _, e := range pool {
			out = append(out, e.ID)
		}
		return out
	}
	if len(tiers) != 2 || !slices.Equal(ids(tiers[0]), []string{"stone", "iron"}) || !slices.Equal(ids(tiers[1]), lateKinds) {
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

// TestLaterTierDepositsKeepTheWorld: adding a later tier's deposits only
// turns mountain tiles into slots of the new kinds; terrain, fertilities
// and the earlier deposits of the dev seed stay as without them.
func TestLaterTierDepositsKeepTheWorld(t *testing.T) {
	c := catalogue(t)
	base := *c
	base.Islands.Deposits = slices.DeleteFunc(slices.Clone(c.Islands.Deposits), func(e content.PoolEntry) bool {
		return slices.Contains(lateKinds, e.ID)
	})
	for _, seed := range []uint64{1_053_001, 1} {
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
					if !slices.Contains(lateKinds, tile.Deposit.Kind) || tile.Terrain != content.TerrainMountain {
						t.Fatalf("seed %d: %s tile %d new deposit %s on %s", seed, is.ID, k, tile.Deposit.Kind, tile.Terrain)
					}
				}
			}
		}
	}
}
