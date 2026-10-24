package devworld

import (
	"errors"
	"testing"
	"time"

	"github.com/ricoberger/new-shores/server/internal/sim"
)

// TestFixtures: every dev fixture builds at now with the player last seen
// there, holds the layout its E2E specs start from, and keeps running for
// an hour of world time without an auto-paused building, also with the
// upkeep the voyage spec adds to town (the specs must not run into
// insolvency on a slow runner); an unknown name is an error.
func TestFixtures(t *testing.T) {
	c := catalogue(t)
	now := start.Add(time.Hour)
	at := func(w *sim.World, island string, x, y int) string {
		t.Helper()
		b := w.Island(island).BuildingAt(c, x, y)
		if b == nil {
			return ""
		}
		return b.Type
	}
	for _, name := range append(Fixtures(), "") {
		t.Run(name, func(t *testing.T) {
			w, err := NewFixture(c, name, now)
			if err != nil {
				t.Fatal(err)
			}
			want := now.Truncate(time.Millisecond)
			if !w.LastEvaluatedAt.Equal(want) || !w.LastSeenAt.Equal(want) || w.PendingSummary != nil {
				t.Fatalf("evaluated %s, last seen %s, summary %v; want %s and none", w.LastEvaluatedAt, w.LastSeenAt, w.PendingSummary, want)
			}
			switch name {
			case FixtureTown, FixtureSettled:
				for _, b := range []struct {
					x, y int
					typ  string
				}{{35, 5, "lumberjack"}, {24, 5, "sawmill"}, {11, 5, "house_settlers"}, {18, 5, "house_settlers"}, {28, 5, "sheep_farm"}} {
					if got := at(w, "start", b.x, b.y); got != b.typ {
						t.Errorf("start (%d,%d) = %q, want %s", b.x, b.y, got, b.typ)
					}
				}
				// The smoke spec claims the first three quests of the content.
				for _, q := range c.Quests[:3] {
					if st, ok := w.Quests[q.ID]; !ok || !st.Claimed {
						t.Errorf("quest %s not claimed", q.ID)
					}
				}
			}
			if name == FixtureSettled {
				if at(w, "island2", 2, 1) != "trading_post" || at(w, "island2", 12, 2) != "fisher" {
					t.Errorf("island 2 not settled with its fisher")
				}
				// The archipelago spec builds four settler houses (10 planks each) at once.
				if p := w.Island("start").Inventory.Stock["planks"]; p < 40_000 {
					t.Errorf("start planks %d, want >= 40 for the rotation houses", p)
				}
				if len(w.Ships) != 1 || w.Ships[0].RouteID == 0 || len(w.Routes) != 1 || w.Routes[0].Name != "Fish home" {
					t.Errorf("ships %+v routes %+v", w.Ships, w.Routes)
				}
			}
			if name == FixtureTown {
				// The voyage spec's additions: the shipyard and the sloop.
				f := &fixture{c: c, w: w}
				settle(f)
				if f.err != nil {
					t.Fatal(f.err)
				}
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
	if _, err := NewFixture(c, "nope", now); !errors.Is(err, ErrUnknownFixture) {
		t.Errorf("unknown fixture: %v", err)
	}
}
