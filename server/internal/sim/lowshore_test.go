package sim

import (
	"errors"
	"testing"
)

// TestLowShore (D-075 §1): every land tile of a water-edge building
// (water_rows) is at terrace level 0, for placement, plans, moves of
// buildings and plans, the site check and the site scanner; a building
// without water_rows may stand on a terrace.
func TestLowShore(t *testing.T) {
	c := catalogue(t)
	fisher := c.BuildingByID["fisher"]
	const x, y = 16, 2
	fw, fh := footprint(fisher, 0)
	// The back corner of the footprint: a land tile of the site.
	bx, by := x+fw-1, y+fh-1

	raise := func(w *World, level int) {
		is := w.Islands[0]
		is.Tiles[is.index(bx, by)].Level = level
	}
	expect := func(w *World, cmd Command) {
		t.Helper()
		before := encode(t, w)
		if err := Apply(w, c, cmd); !errors.Is(err, ErrNeedsLowShore) {
			t.Fatalf("Apply(%#v) = %v, want %v", cmd, err, ErrNeedsLowShore)
		}
		if string(before) != string(encode(t, w)) {
			t.Fatalf("failed %#v changed the world", cmd)
		}
	}

	w := testWorld(t, c)
	is := w.Islands[0]
	if err := CheckSite(is, c, fisher, x, y, 0); err != nil {
		t.Fatalf("level-0 site: %v", err)
	}
	raise(w, 1)
	if err := CheckSite(is, c, fisher, x, y, 0); !errors.Is(err, ErrNeedsLowShore) {
		t.Fatalf("CheckSite on a level-1 tile = %v, want %v", err, ErrNeedsLowShore)
	}
	if NewSiteChecker(is, c).Valid(fisher, x, y, 0) {
		t.Fatal("SiteChecker accepts a level-1 tile")
	}
	expect(w, PlaceBuilding{IslandID: "main", Type: "fisher", X: x, Y: y})
	expect(w, PlaceBuilding{IslandID: "main", Type: "fisher", X: x, Y: y, Planned: true})
	// A building without water_rows stands on any terrace.
	for i := range is.Tiles {
		if is.Tiles[i].Terrain != "water" {
			is.Tiles[i].Level = 1
		}
	}
	mustApply(t, w, c, PlaceBuilding{IslandID: "main", Type: "sawmill", X: 14, Y: 5})

	// Moves: a building and a plan placed on a low shore cannot move onto
	// the same site once it is a terrace.
	for _, planned := range []bool{false, true} {
		w := testWorld(t, c)
		mustApply(t, w, c, PlaceBuilding{IslandID: "main", Type: "fisher", X: x, Y: y, Planned: planned})
		id := w.NextBuildingID - 1
		raise(w, 2)
		expect(w, MoveBuilding{IslandID: "main", BuildingID: id, X: x, Y: y})
		raise(w, 0)
		mustApply(t, w, c, MoveBuilding{IslandID: "main", BuildingID: id, X: x, Y: y})
	}
}
