package devworld

import (
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/ricoberger/new-shores/server/internal/content"
	"github.com/ricoberger/new-shores/server/internal/sim"
)

// TestFixtures: every dev fixture builds at now with the player last seen
// there, holds its layout on the home island (found programmatically on
// the generated archipelago), and keeps running for an hour of world time
// without an auto-paused building, also with the shipyard, sloop and
// second island settle adds to town; an unknown name is an error. Other
// seeds than DevSeed build too (shots of other archipelagos, --seed).
func TestFixtures(t *testing.T) {
	c := catalogue(t)
	now := start.Add(time.Hour)
	count := func(w *sim.World, island, typ string) int {
		n := 0
		for _, b := range w.Island(island).Buildings {
			if b.Type == typ {
				n++
			}
		}
		return n
	}
	for _, name := range append(Fixtures(), "") {
		t.Run(name, func(t *testing.T) {
			w, err := NewFixture(c, name, DevSeed, now)
			if err != nil {
				t.Fatal(err)
			}
			want := now.Truncate(time.Millisecond)
			if !w.LastEvaluatedAt.Equal(want) || !w.LastSeenAt.Equal(want) || w.PendingSummary != nil {
				t.Fatalf("evaluated %s, last seen %s, summary %v; want %s and none", w.LastEvaluatedAt, w.LastSeenAt, w.PendingSummary, want)
			}
			home := w.Islands[0].ID
			switch name {
			case FixtureSeafaring:
				if len(w.Ships) != 1 || w.Ships[0].AtSea == nil || len(w.Island(home).Buildings) != 0 {
					t.Errorf("seafaring: ships %+v", w.Ships)
				}
			case "", FixtureDefault:
				if count(w, home, "trading_post") != 1 || len(w.Ships) != 1 || w.Ships[0].IslandID != home || w.Ships[0].State != sim.ShipIdle || len(w.Ships[0].Cargo) != 0 {
					t.Errorf("default: home island not founded from the start ship: ships %+v", w.Ships)
				}
			case FixtureTown, FixtureSettled, FixtureCitizens, FixtureMerchants:
				for typ, n := range map[string]int{"lumberjack": 1, "sawmill": 1, "house_settlers": 4, "sheep_farm": 1, "pasture": 3} {
					if got := count(w, home, typ); got != n {
						t.Errorf("%s: %d %s, want %d", home, got, typ, n)
					}
				}
				for _, b := range w.Island(home).Buildings {
					if def := c.BuildingByID[b.Type]; def.Field == nil && def.TradingPost == nil && b.AssignedWarehouseID == 0 {
						t.Errorf("%s %d not connected", b.Type, b.ID)
					}
				}
				// The layout completes the first three quests of the content.
				for _, q := range c.Quests[:3] {
					if st, ok := w.Quests[q.ID]; !ok || !st.Claimed {
						t.Errorf("quest %s not claimed", q.ID)
					}
				}
			}
			if name == FixtureSettled {
				second := w.Ships[1].RouteID
				var island2 string
				for _, is := range w.Islands[1:] {
					if count(w, is.ID, "trading_post") == 1 {
						island2 = is.ID
					}
				}
				if island2 == "" || count(w, island2, "fisher") != 1 || count(w, island2, "house_settlers") != 2 {
					t.Errorf("island 2 not settled with its fisher and houses")
				}
				if count(w, home, "shipyard") != 1 {
					t.Error("no shipyard at home")
				}
				if len(w.Ships) != 2 || w.Ships[0].State != sim.ShipIdle || w.Ships[0].IslandID != home || second == 0 ||
					len(w.Routes) != 1 || w.Routes[0].Name != "Fish home" {
					t.Errorf("ships %+v routes %+v", w.Ships, w.Routes)
				}
			}
			if name == FixtureCitizens {
				checkCitizens(t, c, w)
			}
			if name == FixtureMerchants {
				checkMerchants(t, c, w)
			}
			if name == FixtureTown {
				// settle's additions on top of town.
				f := &fixture{c: c, w: w, ends: map[string]sim.Pos{}}
				f.ends[home] = f.tradingPostCentre(home)
				settle(f)
				if f.err != nil {
					t.Fatal(f.err)
				}
				w = f.w
			}
			if _, err := sim.Advance(w, c, w.LastEvaluatedAt.Add(time.Hour)); err != nil {
				t.Fatal(err)
			}
			for _, is := range w.Islands {
				for _, b := range is.Buildings {
					if b.Paused {
						t.Errorf("%s %s %d paused (%s) within an hour of world time", is.ID, b.Type, b.ID, b.PausedReason)
					}
				}
			}
		})
	}
	if _, err := NewFixture(c, "nope", DevSeed, now); !errors.Is(err, ErrUnknownFixture) {
		t.Errorf("unknown fixture: %v", err)
	}
}

// checkCitizens: the citizens tier is unlocked and the home island has
// one wheat farm without fields, where one drag places all its required
// fields with the world's gold.
func checkCitizens(t *testing.T, c *content.Catalogue, w *sim.World) {
	t.Helper()
	if !sim.TierUnlocked(w, c, citizensTier) {
		t.Fatal("citizens not unlocked")
	}
	home := w.Islands[0].ID
	def := c.BuildingByID[citizensFarm]
	var farm *sim.Building
	for _, b := range w.Island(home).Buildings {
		switch b.Type {
		case citizensFarm:
			if farm != nil {
				t.Fatal("more than one wheat farm")
			}
			farm = b
		case def.Fields.Type:
			t.Fatalf("wheat field %d placed", b.ID)
		}
	}
	if farm == nil {
		t.Fatal("no wheat farm at home")
	}
	n := def.Fields.Required
	if field := c.BuildingByID[def.Fields.Type]; w.Gold < sim.Qty(n)*field.Cost.Gold {
		t.Errorf("gold %d below %d fields' cost", w.Gold, n)
	}
	f := &fixture{c: c, w: w}
	if painted, placed := f.fieldDrag(home, farm.ID, def.Fields.Type); painted == nil || placed != n {
		t.Errorf("a drag places %d fields, want %d", placed, n)
	}
}

// checkMerchants: the merchants fixture's home town (tiers, services up
// to the church, market level 2, Merchant houses, tier-3 workshops) and
// the clay island founded by the brig, which sails "Bricks home".
func checkMerchants(t *testing.T, c *content.Catalogue, w *sim.World) {
	t.Helper()
	if !sim.TierUnlocked(w, c, citizensTier) || !sim.TierUnlocked(w, c, merchantsTier) {
		t.Fatal("citizens or merchants not unlocked")
	}
	home := w.Islands[0].ID
	n := map[string]map[string]int{}
	var market *sim.Building
	for _, is := range w.Islands {
		for _, b := range is.Buildings {
			if n[is.ID] == nil {
				n[is.ID] = map[string]int{}
			}
			n[is.ID][b.Type]++
			if b.Type == "market" {
				market = b
			}
			if b.Type == merchantsHouse && (b.House == nil || b.House.Residents < c.TierByID[merchantsTier].ResidentsFloor) {
				t.Errorf("merchant house %d residents %+v", b.ID, b.House)
			}
		}
	}
	for typ, want := range map[string]int{"market": 1, "chapel": 1, "tavern": 1, "school": 1, "church": 1, merchantsHouse: 4, "butcher": 1, "pastry_kitchen": 1, "shipyard": 1} {
		if n[home][typ] != want {
			t.Errorf("%s: %d %s, want %d", home, n[home][typ], typ, want)
		}
	}
	if market == nil || market.Level != 2 {
		t.Errorf("market %+v, want level 2", market)
	}
	f := &fixture{c: c, w: w}
	clay := f.nearestWithDeposit(home, merchantsDeposit)
	if clay == "" || n[clay]["trading_post"] != 1 || n[clay]["clay_pit"] != 1 || n[clay]["brickworks"] != 1 {
		t.Errorf("clay island %q: %v", clay, n[clay])
	}
	if len(w.Ships) != 2 || w.Ships[1].Type != merchantsShip || w.Ships[1].RouteID == 0 || len(w.Routes) != 1 || w.Routes[0].Name != "Bricks home" {
		t.Errorf("ships %+v routes %+v", w.Ships, w.Routes)
	}
}

// TestMerchantsFixtureNeedsClay: without a clay deposit in the
// archipelago the merchants fixture is ErrFixtureSeed (HTTP 400 at the
// dev reset) naming the fixture, the deposit, the seed and DevSeed.
func TestMerchantsFixtureNeedsClay(t *testing.T) {
	c := catalogue(t)
	w, err := NewFixture(c, FixtureTown, DevSeed, start)
	if err != nil {
		t.Fatal(err)
	}
	for _, is := range w.Islands {
		for i := range is.Tiles {
			if d := is.Tiles[i].Deposit; d != nil && d.Kind == merchantsDeposit {
				is.Tiles[i].Deposit = nil
			}
		}
	}
	f := &fixture{c: c, w: w}
	merchants(f)
	if !errors.Is(f.err, ErrFixtureSeed) {
		t.Fatalf("err = %v, want ErrFixtureSeed", f.err)
	}
	for _, want := range []string{"merchants", "clay", fmt.Sprintf("seed %d", DevSeed), fmt.Sprint(DevSeed)} {
		if !strings.Contains(f.err.Error(), want) {
			t.Errorf("error %q does not mention %q", f.err, want)
		}
	}
}

// TestFixturesOtherSeeds: the settled fixture (every layout step) builds
// on other archipelagos as well, and so does the citizens fixture where
// the home island has the wheat fertility (seed 3's has not: an error).
func TestFixturesOtherSeeds(t *testing.T) {
	c := catalogue(t)
	for _, seed := range []uint64{1, 2, 3, 42, 4711} {
		if _, err := NewFixture(c, FixtureSettled, seed, start); err != nil {
			t.Errorf("settled, seed %d: %v", seed, err)
		}
		if w, err := NewFixture(c, FixtureMerchants, seed, start); err != nil {
			t.Errorf("merchants, seed %d: %v", seed, err)
		} else {
			checkMerchants(t, c, w)
		}
		w, err := NewFixture(c, FixtureCitizens, seed, start)
		switch {
		case seed == 3 && !errors.Is(err, ErrFixtureSeed):
			t.Errorf("citizens, seed 3 (no wheat at home): %v, want ErrFixtureSeed", err)
		case seed == 3:
			// The error names the fixture, the fertility, the seed and a seed that works.
			for _, want := range []string{"citizens", "wheat", "seed 3", "[apple woad]", fmt.Sprint(DevSeed)} {
				if !strings.Contains(err.Error(), want) {
					t.Errorf("citizens, seed 3: error %q does not mention %q", err, want)
				}
			}
		case seed != 3 && err != nil:
			t.Errorf("citizens, seed %d: %v", seed, err)
		case seed != 3:
			checkCitizens(t, c, w)
		}
	}
}
