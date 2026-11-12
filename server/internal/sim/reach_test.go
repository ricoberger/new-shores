package sim

import (
	"testing"
	"time"

	"github.com/ricoberger/new-shores/server/internal/content"
)

// reachCatalogue is the pinned test content with collector reach (D-069):
// the Trading Post reaches tp[level-1] tiles, the warehouse wh[level-1].
func reachCatalogue(t *testing.T, tp, wh []int) *content.Catalogue {
	t.Helper()
	c := catalogue(t)
	for i := range c.BuildingByID["trading_post"].TradingPost.Levels {
		c.BuildingByID["trading_post"].TradingPost.Levels[i].Reach = tp[min(i, len(tp)-1)]
	}
	for i := range c.BuildingByID["warehouse"].Warehouse.Levels {
		c.BuildingByID["warehouse"].Warehouse.Levels[i].Reach = wh[min(i, len(wh)-1)]
	}
	return c
}

func displayed(t *testing.T, w *World, c *content.Catalogue, id int64) BuildingDisplay {
	t.Helper()
	d, err := Display(w, c, w.LastEvaluatedAt)
	if err != nil {
		t.Fatal(err)
	}
	for _, is := range d.Islands {
		for _, b := range is.Buildings {
			if b.ID == id {
				return b
			}
		}
	}
	t.Fatalf("building %d not displayed", id)
	return BuildingDisplay{}
}

// The testWorld fisher at (16,2) is 12 tiles from the Trading Post's
// footprint (x 1..4): reach is measured between the nearest footprint
// tiles, inclusive (MECHANICS §5).
func TestCollectorReachBoundary(t *testing.T) {
	for _, tc := range []struct {
		reach int
		want  int64
	}{{12, 1}, {11, 0}} {
		c := reachCatalogue(t, []int{tc.reach}, []int{4})
		w := testWorld(t, c)
		mustApply(t, w, c, PlaceBuilding{IslandID: "main", Type: "fisher", X: 16, Y: 2})
		b := w.Islands()[0].Building(2)
		if b.AssignedWarehouseID != tc.want || b.OutOfReach != (tc.want == 0) {
			t.Fatalf("reach %d: assigned %d, out of reach %v", tc.reach, b.AssignedWarehouseID, b.OutOfReach)
		}
		mustAdvance(t, w, c, 10*time.Minute)
		bd := displayed(t, w, c, 2)
		fish := w.Islands()[0].Inventory.Stock["fish"]
		if tc.want == 0 {
			// Stalls: no output, nothing buffered, nothing lost (D-009).
			if bd.Status != StatusNoCollectorInReach || bd.Rates.Outputs["fish"] != 0 || fish != 0 || len(b.Buffer) != 0 {
				t.Errorf("reach %d: status %s, rate %d, fish %d, buffer %v", tc.reach, bd.Status, bd.Rates.Outputs["fish"], fish, b.Buffer)
			}
		} else if bd.Status == StatusNoCollectorInReach || fish == 0 {
			t.Errorf("reach %d: status %s, fish %d", tc.reach, bd.Status, fish)
		}
	}
}

// Assignment is the nearest collector by road among those whose reach
// covers the producer: a warehouse nearer by road but out of reach is
// skipped; one in reach takes the producer.
func TestCollectorReachAssignment(t *testing.T) {
	c := reachCatalogue(t, []int{12}, []int{4})
	w := testWorld(t, c)
	mustApply(t, w, c, PlaceBuilding{IslandID: "main", Type: "warehouse", X: 8, Y: 5}) // 2: x 8..9, 7 tiles away
	mustApply(t, w, c, PlaceBuilding{IslandID: "main", Type: "fisher", X: 16, Y: 2})   // 3
	if b := w.Islands()[0].Building(3); b.AssignedWarehouseID != 1 {
		t.Fatalf("fisher assigned to %d, want the Trading Post (the warehouse is nearer by road, out of reach)", b.AssignedWarehouseID)
	}
	mustApply(t, w, c, PlaceBuilding{IslandID: "main", Type: "warehouse", X: 14, Y: 5}) // 4: 1 tile away
	if b := w.Islands()[0].Building(3); b.AssignedWarehouseID != 4 {
		t.Fatalf("fisher assigned to %d, want the warehouse in reach", b.AssignedWarehouseID)
	}
	// Demolishing it hands the fisher back to the Trading Post.
	mustApply(t, w, c, Demolish{IslandID: "main", BuildingID: 4})
	if b := w.Islands()[0].Building(3); b.AssignedWarehouseID != 1 || b.OutOfReach {
		t.Fatalf("fisher assigned to %d (out of reach %v), want the Trading Post", b.AssignedWarehouseID, b.OutOfReach)
	}
}

// Upgrading a collector raises its reach: a stalled producer is assigned
// at once.
func TestCollectorReachGrowsWithLevel(t *testing.T) {
	c := reachCatalogue(t, []int{11, 12}, []int{4})
	w := testWorld(t, c)
	if err := AddStock(w, c, "main", "stone", 50_000, nil); err != nil {
		t.Fatal(err)
	}
	mustApply(t, w, c, PlaceBuilding{IslandID: "main", Type: "fisher", X: 16, Y: 2})
	if b := w.Islands()[0].Building(2); !b.OutOfReach {
		t.Fatal("fisher in reach of a level 1 Trading Post")
	}
	mustApply(t, w, c, UpgradeTradingPost{IslandID: "main", BuildingID: 1})
	if b := w.Islands()[0].Building(2); b.AssignedWarehouseID != 1 || b.OutOfReach {
		t.Fatalf("after the upgrade: assigned %d, out of reach %v", b.AssignedWarehouseID, b.OutOfReach)
	}
}

// A producer without any road is not connected (not "out of reach"); the
// precedence puts not_connected before no_collector_in_reach.
func TestCollectorReachNeedsRoadFirst(t *testing.T) {
	c := reachCatalogue(t, []int{2}, []int{4})
	w := testWorld(t, c)
	mustApply(t, w, c, PlaceBuilding{IslandID: "main", Type: "lumberjack", X: 14, Y: 7})
	b := w.Islands()[0].Building(2)
	if b.AssignedWarehouseID != 0 || b.OutOfReach {
		t.Fatalf("assigned %d, out of reach %v", b.AssignedWarehouseID, b.OutOfReach)
	}
	if bd := displayed(t, w, c, 2); bd.Status != StatusNotConnected {
		t.Errorf("status %s, want not_connected", bd.Status)
	}
}

// A footprint tile exactly on the reach circle is in reach: the warehouse
// at (12,7) (x 12..13, y 7..8) and the fisher at (16,2) (x 16..17, y 2..3)
// are 3 and 4 tiles apart, 5 in all. Demolishing the only collector that
// reaches the fisher stalls it.
func TestCollectorReachOnTheCircle(t *testing.T) {
	for _, tc := range []struct {
		reach int
		want  int64
	}{{5, 2}, {4, 0}} {
		c := reachCatalogue(t, []int{11}, []int{tc.reach})
		w := testWorld(t, c)
		mustApply(t, w, c, PlaceRoad{IslandID: "main", Type: "road_dirt", Tiles: []Pos{{13, 5}, {13, 6}}})
		mustApply(t, w, c, PlaceBuilding{IslandID: "main", Type: "warehouse", X: 12, Y: 7}) // 2
		mustApply(t, w, c, PlaceBuilding{IslandID: "main", Type: "fisher", X: 16, Y: 2})    // 3
		b := w.Islands()[0].Building(3)
		if b.AssignedWarehouseID != tc.want || b.OutOfReach != (tc.want == 0) {
			t.Fatalf("reach %d: assigned %d, out of reach %v", tc.reach, b.AssignedWarehouseID, b.OutOfReach)
		}
		if tc.want == 0 {
			continue
		}
		mustApply(t, w, c, Demolish{IslandID: "main", BuildingID: 2})
		if b := w.Islands()[0].Building(3); b.AssignedWarehouseID != 0 || !b.OutOfReach {
			t.Fatalf("after the demolition: assigned %d, out of reach %v", b.AssignedWarehouseID, b.OutOfReach)
		}
		if bd := displayed(t, w, c, 3); bd.Status != StatusNoCollectorInReach {
			t.Errorf("after the demolition: status %s", bd.Status)
		}
	}
}
