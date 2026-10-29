package sim

import (
	"slices"
	"testing"
)

// wall is a 6 × 40 island of land (a sea wall) with a one-tile water
// border, at (x, y).
func wall(id string, x, y int) *Island {
	rows := []string{"~~~~~~"}
	for range 38 {
		rows = append(rows, "~....~")
	}
	rows = append(rows, "~~~~~~")
	is := islandFromRows(id, rows...)
	is.X, is.Y = x, y
	return is
}

// TestSeaRouteStraight: a leg in open water has no waypoints; its time is
// TravelMs.
func TestSeaRouteStraight(t *testing.T) {
	islands := []*Island{wall("w", 100, 100)}
	a, b := Pos{0, 0}, Pos{30, 40}
	if got := SeaRoute(islands, a, b); got != nil {
		t.Fatalf("waypoints %v", got)
	}
	if PathMs([]Pos{a, b}, 1000, 60_000) != TravelMs(0, 0, 30, 40, 1000, 60_000) {
		t.Fatal("PathMs of two points differs from TravelMs")
	}
}

// TestSeaRouteAroundLand (D-058 §5): a leg whose straight line crosses an
// island goes around it; no segment crosses land; the path is
// deterministic and longer than the straight line.
func TestSeaRouteAroundLand(t *testing.T) {
	islands := []*Island{wall("w", 20, -10)}
	a, b := Pos{0, 10}, Pos{50, 12}
	path := SeaRoute(islands, a, b)
	if len(path) == 0 {
		t.Fatal("no waypoints around the wall")
	}
	if again := SeaRoute(islands, a, b); !slices.Equal(path, again) {
		t.Fatalf("not deterministic: %v vs %v", path, again)
	}
	full := append(append([]Pos{a}, path...), b)
	g := newSeaGrid(islands, a, b)
	for i := 1; i < len(full); i++ {
		if !g.clear(full[i-1], full[i]) {
			t.Errorf("segment %v-%v crosses land", full[i-1], full[i])
		}
		// No sample on a land tile of the wall (x 21..24, y -9..28).
		p, q := full[i-1], full[i]
		n := max(absInt(q.X-p.X), absInt(q.Y-p.Y))
		for s := 0; s <= n; s++ {
			x, y := p.X+divRound((q.X-p.X)*s, n), p.Y+divRound((q.Y-p.Y)*s, n)
			if x >= 21 && x <= 24 && y >= -9 && y <= 28 {
				t.Fatalf("segment %v-%v touches land at (%d,%d)", p, q, x, y)
			}
		}
	}
	// It passes the wall's south end (the shorter way: the wall reaches 18
	// tiles above a and b, 18 below).
	if ms, straight := PathMs(full, 1000, 60_000), TravelMs(a.X, a.Y, b.X, b.Y, 1000, 60_000); ms <= straight {
		t.Fatalf("around %d ms <= straight %d ms", ms, straight)
	}
	t.Logf("path %v", full)
}

// TestSeaRouteEnclosed: without a way around (a ring of land), the leg
// stays straight.
func TestSeaRouteEnclosed(t *testing.T) {
	ring := islandFromRows("r",
		"..........",
		".~~~~~~~~.",
		".~~~~~~~~.",
		".~~~~~~~~.",
		".~~~~~~~~.",
		".~~~~~~~~.",
		".~~~~~~~~.",
		".~~~~~~~~.",
		".~~~~~~~~.",
		"..........",
	)
	ring.X, ring.Y = 0, 0
	if got := SeaRoute([]*Island{ring}, Pos{5, 5}, Pos{40, 5}); got != nil {
		t.Fatalf("waypoints %v out of a closed ring", got)
	}
}

// TestLegEnds: a leg runs from the harbour in front of a Trading Post's
// water edge; an island without one is reached at its shore nearest the
// other end.
func TestLegEnds(t *testing.T) {
	c := catalogue(t)
	w := shipWorld(t, c)
	a, b := w.Island("a"), w.Island("b")
	// The Trading Post at (1, 1), rotation 0: water edge north, harbour two tiles out.
	tp := c.BuildingByID["trading_post"]
	if h, ok := harbour(c, a); !ok || h != (Pos{1 + tp.Width/2, 1 - harbourOffset}) {
		t.Fatalf("harbour %v %v", h, ok)
	}
	pa, pb := Ends(c, a, b)
	if pa != (Pos{1 + tp.Width/2, -1}) {
		t.Fatalf("from %v", pa)
	}
	// b's water tiles next to its land, nearest pa.
	x, y := pb.X-b.X, pb.Y-b.Y
	if b.Tiles[y*b.Width+x].Terrain != "water" {
		t.Fatalf("to %v is not water", pb)
	}
	if got := Arrival(c, Pos{6, 20}, b); got != (Pos{7, 14}) {
		t.Fatalf("arrival from the south %v", got)
	}
}

// TestShipSpeedsScaleVoyages (D-060): a ship's leg time is the reference
// time over its content speed — on open sea the sloop (1.2) takes 5/6,
// the galleon (0.85) 20/17 of the brig's (1.0) time.
func TestShipSpeedsScaleVoyages(t *testing.T) {
	c := shippedCatalogue(t)
	w := &World{}
	a, b := Pos{X: 0, Y: 0}, Pos{X: 300, Y: 400}
	ms := map[string]int64{}
	for _, id := range []string{"sloop", "brig", "galleon"} {
		_, ms[id] = Voyage(w, c, c.ShipByID[id].SpeedPermille, a, b)
	}
	// 500 tiles at 60 tiles per minute: 500 s for the brig.
	if ms["brig"] != 500_000 || ms["sloop"] != 416_667 || ms["galleon"] != 588_236 {
		t.Errorf("voyage ms %v, want brig 500000, sloop 416667, galleon 588236", ms)
	}
}
