package sim

import (
	"errors"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/ricoberger/new-shores/server/internal/content"
)

// patrolWorld is shoreWorld with a second, unsettled island "isle" (a
// 10×10 block of land in a 30×30 grid) at archipelago (100, 0) and a
// balinger at sea between the two.
func patrolWorld(t *testing.T) (*World, *content.Catalogue, *Ship) {
	t.Helper()
	c := shippedCatalogue(t)
	w := shoreWorld(t)
	rows := make([]string, 30)
	for y := range rows {
		if y >= 10 && y < 20 {
			rows[y] = strings.Repeat("~", 10) + "cccccccccc" + strings.Repeat("~", 10)
		} else {
			rows[y] = strings.Repeat("~", 30)
		}
	}
	isle := islandFromRows("isle", rows...)
	isle.X = 100
	w.SetIslands(append(w.Islands(), isle)...)
	s, err := LaunchShipAtSea(w, c, "balinger", Pos{X: 70, Y: 10}, nil)
	if err != nil {
		t.Fatal(err)
	}
	return w, c, s
}

// TestPatrol (D-077 §6): an idle ship patrols an unsettled island along a
// closed loop that keeps clear of land (at least patrolOffset tiles from
// the island's land along the convex hull), sails the approach first, and
// changes nothing while it patrols; unassign_ship ends it at the stop
// point; a second patrol of a patrolling ship is refused.
func TestPatrol(t *testing.T) {
	w, c, s := patrolWorld(t)
	gold := w.Gold
	mustApply(t, w, c, StartPatrol{ShipID: s.ID, IslandID: "isle"})
	p := s.Patrol
	if s.State != ShipPatrolling || p == nil || s.IslandID != "" || s.AtSea != nil || len(p.Loop) < 4 {
		t.Fatalf("ship %+v patrol %+v", s, p)
	}
	if p.Approach[0] != (Pos{X: 70, Y: 10}) || p.Approach[len(p.Approach)-1] != p.Loop[0] || p.ApproachMs <= 0 || p.LoopMs <= 0 {
		t.Fatalf("approach %v (%d ms), loop %v (%d ms)", p.Approach, p.ApproachMs, p.Loop, p.LoopMs)
	}
	// The loop round the 10×10 block at (110..119, 10..19): the block
	// grown by 10 tiles, a square of side 29 (perimeter 116 tiles).
	for _, q := range p.Loop {
		if q.X < 100 || q.X > 129 || q.Y < 0 || q.Y > 29 || (q.X > 100 && q.X < 129 && q.Y > 0 && q.Y < 29) {
			t.Fatalf("loop point %v off the grown hull %v", q, p.Loop)
		}
	}
	// One round at the balinger's speed (1.3) and the region's rate.
	if want := PathMs(append(append([]Pos{}, p.Loop...), p.Loop[0]), c.ShipByID["balinger"].SpeedPermille, c.Region.Rules.ShipSpeedMilliTilesPerMin); p.LoopMs != want {
		t.Fatalf("loop %d ms, want %d", p.LoopMs, want)
	}
	// Deterministic.
	if again := coastLoop(w, c, w.Island("isle")); !reflect.DeepEqual(rotateTo(again, nearestIndex(again, p.Loop[0])), p.Loop) {
		t.Fatalf("loop %v, again %v", p.Loop, again)
	}
	// Nothing changes while it patrols but the upkeep.
	before := *p
	end := w.LastEvaluatedAt.Add(30 * time.Minute)
	if _, err := Advance(w, c, end); err != nil {
		t.Fatal(err)
	}
	if s.State != ShipPatrolling || !reflect.DeepEqual(*s.Patrol, before) || w.Gold >= gold {
		t.Fatalf("after 30 min: %+v, gold %d → %d", s, gold, w.Gold)
	}
	d, err := Display(w, c, end)
	if err != nil {
		t.Fatal(err)
	}
	if sd := d.Ships[0]; sd.State != ShipPatrolling || sd.Patrol == nil || len(sd.Patrol.Loop) != len(p.Loop) || sd.Position != nil {
		t.Fatalf("display %+v", sd)
	}
	if err := Apply(w, c, StartPatrol{ShipID: s.ID, IslandID: "main"}); !errors.Is(err, ErrShipNotIdle) {
		t.Fatalf("patrol a patrolling ship = %v", err)
	}
	mustApply(t, w, c, UnassignShip{ShipID: s.ID})
	if s.State != ShipIdle || s.IslandID != "isle" || s.Patrol != nil || s.Offshore == nil || *s.Offshore != before.StopAt {
		t.Fatalf("after unassign: %+v", s)
	}
	// From the island to the home island's loop: the approach starts
	// offshore where it stopped.
	mustApply(t, w, c, StartPatrol{ShipID: s.ID, IslandID: "main"})
	if s.Patrol.Approach[0] != before.StopAt {
		t.Fatalf("approach from %v, want %v", s.Patrol.Approach[0], before.StopAt)
	}
}

// TestPatrolRefused (D-077 §6): no patrol of an unknown island, an island
// of another region, or by a ship that is not idle; a paused patrol ends
// anchored at the island.
func TestPatrolRefused(t *testing.T) {
	w, c, s := patrolWorld(t)
	if err := Apply(w, c, StartPatrol{ShipID: s.ID, IslandID: "nowhere"}); !errors.Is(err, ErrRouteInvalid) {
		t.Fatalf("unknown island = %v", err)
	}
	far := &Region{ID: "far", Seed: 9}
	far.SetIslands([]*Island{islandFromRows("far-01", "~~~~", "~cc~", "~~~~")})
	w.Regions = append(w.Regions, far)
	if err := Apply(w, c, StartPatrol{ShipID: s.ID, IslandID: "far-01"}); !errors.Is(err, ErrRouteInvalid) {
		t.Fatalf("other region = %v", err)
	}
	mustApply(t, w, c, StartPatrol{ShipID: s.ID, IslandID: "main"})
	stop := s.Patrol.StopAt
	// The home island has a Trading Post: the stop point is the loop
	// point nearest its harbour.
	h, _ := harbour(c, w.Island("main"))
	if stop != s.Patrol.Loop[nearestIndex(s.Patrol.Loop, h)] {
		t.Fatalf("stop %v, harbour %v", stop, h)
	}
	pauseShip(s, 1, w.LastEvaluatedAt.UnixMilli())
	if s.State != ShipAnchoredUnpaid || s.IslandID != "main" || s.Patrol != nil || *s.Offshore != stop {
		t.Fatalf("paused patrol: %+v", s)
	}
}
