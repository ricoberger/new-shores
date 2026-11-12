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
	if got := SeaRoute(nil, islands, a, b); got != nil {
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
	path := SeaRoute(nil, islands, a, b)
	if len(path) == 0 {
		t.Fatal("no waypoints around the wall")
	}
	if again := SeaRoute(nil, islands, a, b); !slices.Equal(path, again) {
		t.Fatalf("not deterministic: %v vs %v", path, again)
	}
	full := append(append([]Pos{a}, path...), b)
	g := newSeaGrid(nil, islands, a, b)
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

// TestSeaRouteEnclosed: when the ends share no water (one inside a closed
// ring of land) there is no way at all and the leg stays straight; the
// leg ends rule this out in play (harbours are routable, shores lie on
// water the open sea reaches).
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
	if got := SeaRoute(nil, []*Island{ring}, Pos{5, 5}, Pos{40, 5}); got != nil {
		t.Fatalf("waypoints %v out of a closed ring", got)
	}
}

// TestSeaRouteLagoon (D-072): a leg ending in a bay whose mouth is
// narrower than a sea cell leaves it over its water tiles and goes
// around the land instead of crossing it.
func TestSeaRouteLagoon(t *testing.T) {
	// A ring of land with a one-tile gap in its east side at row 6.
	rows := []string{
		"............",
		".~~~~~~~~~~.",
		".~~~~~~~~~~.",
		".~~~~~~~~~~.",
		".~~~~~~~~~~.",
		".~~~~~~~~~~.",
		".~~~~~~~~~~~",
		".~~~~~~~~~~.",
		".~~~~~~~~~~.",
		".~~~~~~~~~~.",
		".~~~~~~~~~~.",
		"............",
	}
	bay := islandFromRows("b", rows...)
	bay.X, bay.Y = 40, 40
	a, b := Pos{0, 46}, Pos{45, 46}
	path := SeaRoute(nil, []*Island{bay}, a, b)
	if len(path) == 0 {
		t.Fatal("no waypoints into the bay")
	}
	full := append(append([]Pos{a}, path...), b)
	g := newSeaGrid(nil, []*Island{bay}, a, b)
	for i := 1; i < len(full); i++ {
		p, q := full[i-1], full[i]
		n := max(absInt(q.X-p.X), absInt(q.Y-p.Y))
		for s := 0; s <= n; s++ {
			if x, y := p.X+divRound((q.X-p.X)*s, n), p.Y+divRound((q.Y-p.Y)*s, n); g.landAt(x, y) {
				t.Fatalf("segment %v-%v crosses land at (%d,%d) (path %v)", p, q, x, y, full)
			}
		}
	}
}

// tileClear fails the test when a polyline's segments pass a land tile
// of the grid (lineTiles, tile-exact).
func tileClear(t *testing.T, g *seaGrid, full []Pos) {
	t.Helper()
	for i := 1; i < len(full); i++ {
		lineTiles(full[i-1], full[i], func(x, y int) {
			if g.landAt(x, y) {
				t.Fatalf("segment %v-%v touches land at (%d,%d) (path %v)", full[i-1], full[i], x, y, full)
			}
		})
	}
}

// TestSeaRouteLongChannel (polish 8): a harbour at the end of a channel
// one tile wide and longer than approachReach walks out over the water
// tiles to the nearest open cell instead of sailing the straight line
// across land.
func TestSeaRouteLongChannel(t *testing.T) {
	// A 12-wide block of land, 40 rows, with a channel down column 5 from
	// the south edge to row 2.
	var rows []string
	for y := range 40 {
		r := []byte("............")
		if y >= 2 {
			r[5] = '~'
		}
		rows = append(rows, string(r))
	}
	is := islandFromRows("c", rows...)
	is.X, is.Y = 40, 40
	a, b := Pos{45, 43}, Pos{46, 0}
	path := SeaRoute(nil, []*Island{is}, a, b)
	if len(path) == 0 {
		t.Fatal("straight out of the channel")
	}
	tileClear(t, newSeaGrid(nil, []*Island{is}, a, b), append(append([]Pos{a}, path...), b))
}

// TestSeaRouteClosedLagoon (polish 8): two ends in the same closed
// lagoon (no open cell reachable over water) with a spit of land between
// them follow the coast round the spit.
func TestSeaRouteClosedLagoon(t *testing.T) {
	var rows []string
	for y := range 20 {
		r := []byte("....................")
		if y > 0 && y < 19 {
			for x := 1; x < 19; x++ {
				r[x] = '~'
			}
		}
		if y < 15 {
			r[10] = '.'
		}
		rows = append(rows, string(r))
	}
	is := islandFromRows("l", rows...)
	a, b := Pos{4, 4}, Pos{15, 4}
	path := SeaRoute(nil, []*Island{is}, a, b)
	if len(path) == 0 {
		t.Fatal("straight across the spit")
	}
	tileClear(t, newSeaGrid(nil, []*Island{is}, a, b), append(append([]Pos{a}, path...), b))
}

// TestLineTiles: the supercover of a segment, corners included.
func TestLineTiles(t *testing.T) {
	var got []Pos
	lineTiles(Pos{0, 0}, Pos{2, 1}, func(x, y int) { got = append(got, Pos{x, y}) })
	if want := []Pos{{0, 0}, {1, 0}, {1, 1}, {2, 1}}; !slices.Equal(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
	got = got[:0]
	lineTiles(Pos{3, 3}, Pos{1, 1}, func(x, y int) { got = append(got, Pos{x, y}) })
	if want := []Pos{{3, 3}, {2, 3}, {3, 2}, {2, 2}, {1, 2}, {2, 1}, {1, 1}}; !slices.Equal(got, want) {
		t.Fatalf("diagonal: got %v, want %v", got, want)
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
// time over its content speed — on open sea the cog (1.2) takes 5/6,
// the carrack (0.85) 20/17 of the hulk's (1.0) time.
func TestShipSpeedsScaleVoyages(t *testing.T) {
	c := shippedCatalogue(t)
	w := &World{}
	a, b := Pos{X: 0, Y: 0}, Pos{X: 300, Y: 400}
	ms := map[string]int64{}
	for _, id := range []string{"cog", "hulk", "carrack"} {
		_, ms[id] = Voyage(w, c, c.ShipByID[id].SpeedPermille, a, b)
	}
	// 500 tiles at 60 tiles per minute: 500 s for the hulk.
	if ms["hulk"] != 500_000 || ms["cog"] != 416_667 || ms["carrack"] != 588_236 {
		t.Errorf("voyage ms %v, want hulk 500000, cog 416667, carrack 588236", ms)
	}
}
