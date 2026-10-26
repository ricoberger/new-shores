package devworld

import (
	"errors"
	"testing"
	"time"

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
			case FixtureTown, FixtureSettled:
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

// TestFixturesOtherSeeds: the settled fixture (every layout step) builds
// on other archipelagos as well.
func TestFixturesOtherSeeds(t *testing.T) {
	c := catalogue(t)
	for _, seed := range []uint64{1, 2, 3, 42, 4711} {
		if _, err := NewFixture(c, FixtureSettled, seed, start); err != nil {
			t.Errorf("seed %d: %v", seed, err)
		}
	}
}
