package layout

import (
	"slices"
	"testing"

	"github.com/ricoberger/new-shores/server/internal/content"
	"github.com/ricoberger/new-shores/server/internal/sim"
)

// TestCandidatesOrder: Candidates lists the sites as a stable sort by
// distance of the enumeration (rotation, row, column) does; the plans
// (D-067) replay only with this order.
func TestCandidatesOrder(t *testing.T) {
	is := sim.NewIsland("i", 23, 17, make([]sim.Tile, 23*17))
	for _, def := range []*content.Building{
		{ID: "a", Width: 3, Height: 2},
		{ID: "b", Width: 2, Height: 2},
		{ID: "c", Width: 4, Height: 4, Placement: content.PlacementShore},
	} {
		for _, anchor := range []sim.Pos{{X: 0, Y: 0}, {X: 11, Y: 8}, {X: 30, Y: -4}} {
			var want []Site
			rots := Rotations()
			if def.Width == def.Height && def.WaterRows == nil && !def.Shore() {
				rots = rots[:1]
			}
			for _, rot := range rots {
				w, h := Dims(def, rot)
				for y := 0; y+h <= is.Height; y++ {
					for x := 0; x+w <= is.Width; x++ {
						dx, dy := 2*x+w-2*anchor.X-1, 2*y+h-2*anchor.Y-1
						want = append(want, Site{x, y, rot, dx*dx + dy*dy})
					}
				}
			}
			slices.SortStableFunc(want, func(a, b Site) int { return a.D - b.D })
			if got := Candidates(is, def, anchor); !slices.Equal(got, want) {
				t.Errorf("%s from %v: the order differs from the stable sort", def.ID, anchor)
			}
		}
	}
}
