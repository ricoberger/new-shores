package scenario

import (
	"testing"

	"github.com/ricoberger/new-shores/server/internal/content"
	"github.com/ricoberger/new-shores/server/internal/sim"
)

// TestReferenceGamesCollectorReach (D-069 §1): at the end of every
// reference game each production building lies within the reach of a
// collector of its island (nearest footprint tiles, like a service
// radius): the generator's collectors mode places the warehouses.
func TestReferenceGamesCollectorReach(t *testing.T) {
	names := []string{"bootstrap_citizens", "bootstrap_citizens_quests", "bootstrap_merchants"}
	if !testing.Short() {
		names = append(names, "bootstrap_patricians")
	}
	for _, name := range names {
		t.Run(name, func(t *testing.T) {
			r := replay(t, name)
			warehouses := 0
			for _, is := range r.w.Islands() {
				var collectors []*sim.Building
				for _, b := range is.Buildings {
					if def := r.c.BuildingByID[b.Type]; def != nil && def.Collector() {
						collectors = append(collectors, b)
						if def.Warehouse != nil && def.TradingPost == nil {
							warehouses++
						}
					}
				}
				for _, b := range is.Buildings {
					def := r.c.BuildingByID[b.Type]
					if def == nil || def.Recipe == nil {
						continue
					}
					reached := false
					for _, col := range collectors {
						cdef := r.c.BuildingByID[col.Type]
						reach := cdef.ReachAt(col.Level)
						if reach == 0 || dist2(cdef, col, def, b) <= reach*reach {
							reached = true
							break
						}
					}
					if !reached {
						t.Errorf("%s: %s %d at (%d,%d) is beyond every collector's reach", is.ID, b.Type, b.ID, b.X, b.Y)
					}
				}
			}
			if warehouses == 0 {
				t.Error("no warehouse: the generator's collectors mode placed none")
			}
		})
	}
}

// dist2 is the squared distance between the nearest footprint tiles of
// two buildings.
func dist2(ad *content.Building, a *sim.Building, bd *content.Building, b *sim.Building) int {
	aw, ah := dims(ad, a.Rotation)
	bw, bh := dims(bd, b.Rotation)
	dx := max(a.X-(b.X+bw-1), 0, b.X-(a.X+aw-1))
	dy := max(a.Y-(b.Y+bh-1), 0, b.Y-(a.Y+ah-1))
	return dx*dx + dy*dy
}

func dims(def *content.Building, rot int) (int, int) {
	if rot == 90 || rot == 270 {
		return def.Height, def.Width
	}
	return def.Width, def.Height
}
