package sim

import (
	"fmt"
	"slices"
	"strings"

	"github.com/ricoberger/new-shores/server/internal/content"
)

// checkContentIDs reports the building, good, ship and quest IDs of the
// world that c does not define (ErrUnknownContent, the IDs sorted and
// listed once each as "kind id"). It reads the places a stored world names
// them: buildings and plans with their buffers, transit and ship orders,
// island inventories, ships and their cargo, route stops and quests. The
// away log and a pending summary are reports of past play and are not
// checked.
func checkContentIDs(w *World, c *content.Catalogue) error {
	bad := map[string]bool{}
	building := func(id string) {
		if c.BuildingByID[id] == nil {
			bad["building "+id] = true
		}
	}
	good := func(id string) {
		if c.GoodByID[id] == nil {
			bad["good "+id] = true
		}
	}
	ship := func(id string) {
		if c.ShipByID[id] == nil {
			bad["ship "+id] = true
		}
	}
	for _, is := range w.Islands() {
		for _, list := range [][]*Building{is.Buildings, is.Plans} {
			for _, b := range list {
				building(b.Type)
				for g := range b.Buffer {
					good(g)
				}
				for g := range b.BufferSub {
					good(g)
				}
				for _, t := range b.Transit {
					good(t.Good)
				}
				if b.Order != nil {
					ship(b.Order.Type)
				}
			}
		}
		inv := is.Inventory
		for _, m := range []map[string]bool{inv.Starved, inv.Full} {
			for g := range m {
				good(g)
			}
		}
		for g := range inv.Stock {
			good(g)
		}
		for g := range inv.StockSub {
			good(g)
		}
	}
	for _, s := range w.Ships {
		ship(s.Type)
		for _, sl := range s.Cargo {
			good(sl.Good)
		}
	}
	for _, r := range w.Routes {
		for _, st := range r.Stops {
			for _, l := range st.Load {
				good(l.Good)
			}
			for _, g := range st.Unload {
				good(g)
			}
			for g := range st.UnloadMax {
				good(g)
			}
		}
	}
	for q := range w.Quests {
		if c.QuestByID[q] == nil {
			bad["quest "+q] = true
		}
	}
	if len(bad) == 0 {
		return nil
	}
	ids := make([]string, 0, len(bad))
	for id := range bad {
		ids = append(ids, id)
	}
	slices.Sort(ids)
	return fmt.Errorf("%w: %s", ErrUnknownContent, strings.Join(ids, ", "))
}
