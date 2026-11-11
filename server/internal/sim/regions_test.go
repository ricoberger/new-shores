package sim

import (
	"bytes"
	"testing"

	"github.com/ricoberger/new-shores/server/internal/content"
)

// twoRegionWorld is a hand-made world of two regions (D-076): the home
// region with two islands, a locked second region with one.
func twoRegionWorld(t *testing.T) *World {
	t.Helper()
	w := testWorld(t, catalogue(t))
	w.Regions[0].ID = "home"
	w.SetIslands(append(w.Islands(), islandFromRows("rock", "~~~~", "~cc~", "~~~~"))...)
	far := &Region{ID: "far", Seed: 9, PassagePoint: &Pos{X: 3, Y: 4}}
	far.SetIslands([]*Island{islandFromRows("far-01", "~~~~", "~cc~", "~~~~")})
	w.Regions = append(w.Regions, far)
	return w
}

// TestWorldIslandsAcrossRegions: Islands lists the islands of every
// region in region order, Island finds them in any region, and the
// setters stamp each island's region.
func TestWorldIslandsAcrossRegions(t *testing.T) {
	w := twoRegionWorld(t)
	var ids []string
	for _, is := range w.Islands() {
		ids = append(ids, is.ID+"@"+is.RegionID)
	}
	if got := len(ids); got != 3 || ids[0] != "main@home" || ids[1] != "rock@home" || ids[2] != "far-01@far" {
		t.Fatalf("islands %v", ids)
	}
	if w.Island("far-01") == nil || w.Region("far") == nil || w.Region("nowhere") != nil || w.HomeRegion().ID != "home" {
		t.Fatal("lookup across regions")
	}
	repl := islandFromRows("far-01", "~~~~~", "~ccc~", "~~~~~")
	if !w.ReplaceIsland(repl) || w.Island("far-01") != repl || repl.RegionID != "far" || w.ReplaceIsland(islandFromRows("nowhere", "~")) {
		t.Fatal("ReplaceIsland")
	}
	var empty World
	if empty.Islands() != nil {
		t.Fatal("a world without regions has islands")
	}
	empty.AddIsland(islandFromRows("x", "~"))
	if len(empty.Regions) != 1 || !empty.Regions[0].Unlocked || empty.Regions[0].ID != "" || len(empty.Islands()) != 1 {
		t.Fatalf("AddIsland on an empty world: %+v", empty.Regions)
	}
}

// TestCloneCopiesRegions: Clone deep-copies the regions, their passage
// points and islands.
func TestCloneCopiesRegions(t *testing.T) {
	w := twoRegionWorld(t)
	c := w.Clone()
	if !bytes.Equal(encode(t, c), encode(t, w)) {
		t.Fatal("clone differs")
	}
	c.Regions[1].PassagePoint.X = 99
	c.Regions[1].Islands[0].Name = "changed"
	c.Regions[0].Unlocked = false
	if w.Regions[1].PassagePoint.X != 3 || w.Regions[1].Islands[0].Name == "changed" || !w.Regions[0].Unlocked {
		t.Fatal("the clone shares regions with the world")
	}
}

// TestRegionsRoundTrip: a world of two regions encodes and decodes byte
// for byte, full (Encode) and split into state and terrain (EncodeState).
func TestRegionsRoundTrip(t *testing.T) {
	c := catalogue(t)
	w := twoRegionWorld(t)
	data := encode(t, w)
	back, _, _, err := Decode(data, c)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(encode(t, back), data) {
		t.Fatal("Encode round trip differs")
	}
	state, terrain, err := EncodeState(w, "test")
	if err != nil {
		t.Fatal(err)
	}
	joined, _, _, err := DecodeState(state, terrain, c)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(encode(t, joined), data) {
		t.Fatal("EncodeState round trip differs")
	}
	if len(joined.Regions) != 2 || joined.Regions[1].Seed != 9 || joined.Regions[1].Unlocked || *joined.Regions[1].PassagePoint != (Pos{X: 3, Y: 4}) {
		t.Fatalf("regions %+v", joined.Regions)
	}
}

// TestNoPassageBetweenRegions: a voyage or route between two regions
// fails with ErrNoPassage (D-076 §1) — without a passage of the pair in
// the content and, until passage legs are built, with one — and leaves
// the world unchanged; inside a region nothing changes.
func TestNoPassageBetweenRegions(t *testing.T) {
	c := catalogue(t)
	w, s := routeWorld(t, c)
	a, b := w.Island("a"), w.Island("b")
	w.Regions[0].SetIslands([]*Island{a})
	far := &Region{ID: "far", Unlocked: true}
	far.SetIslands([]*Island{b})
	w.Regions = append(w.Regions, far)
	if s.IslandID != "b" || shipRegionID(w, s) != "far" {
		t.Fatalf("ship at %q in region %q", s.IslandID, shipRegionID(w, s))
	}
	withPassage := *c
	withPassage.Passages = []content.Passage{{From: "", To: "far", Ms: 600_000}}
	for _, cat := range []*content.Catalogue{c, &withPassage} {
		expectErr(t, w, cat, SailShip{ShipID: s.ID, ToIslandID: "a"}, ErrNoPassage)
		expectErr(t, w, cat, ManualShipment{ShipID: s.ID, ToIslandID: "a"}, ErrNoPassage)
		expectErr(t, w, cat, CreateRoute{Stops: []Stop{{IslandID: "a"}, {IslandID: "b"}}}, ErrNoPassage)
	}
	if err := checkPassage(c, "far", "far"); err != nil {
		t.Fatal(err)
	}
}

// TestDisplayShipBetweenRegions: a ship on a passage leg is on no map —
// region_id null, leg.passage — while a ship on a normal leg is on its
// destination's region and an idle one on its island's.
func TestDisplayShipBetweenRegions(t *testing.T) {
	c := catalogue(t)
	w := twoRegionWorld(t)
	between := displayShip(w, &Ship{ID: 7, State: ShipManualLeg, Leg: &Leg{ToIsland: "far-01", Passage: true}}, c, false)
	if between.RegionID != nil || between.Leg == nil || !between.Leg.Passage {
		t.Fatalf("ship between regions: region %v leg %+v", between.RegionID, between.Leg)
	}
	sailing := displayShip(w, &Ship{ID: 8, State: ShipManualLeg, Leg: &Leg{FromIsland: "main", ToIsland: "rock"}}, c, false)
	idle := displayShip(w, &Ship{ID: 9, State: ShipIdle, IslandID: "far-01", RegionID: "home"}, c, false)
	if sailing.RegionID == nil || *sailing.RegionID != "home" || sailing.Leg.Passage || idle.RegionID == nil || *idle.RegionID != "far" {
		t.Fatalf("regions %v %v", sailing.RegionID, idle.RegionID)
	}
	regions := displayRegions(w)
	if len(regions) != 2 || regions[1].ID != "far" || regions[1].PassagePoint == nil || *regions[1].PassagePoint != (PositionDisplay{X: 3, Y: 4}) || regions[0].PassagePoint != nil {
		t.Fatalf("regions %+v", regions)
	}
}
