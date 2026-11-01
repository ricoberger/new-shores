package sim

import (
	"errors"
	"maps"
	"strings"
	"testing"

	"github.com/ricoberger/new-shores/server/internal/content"
)

// chainCatalogue returns the test catalogue with a faith chain (D-065):
// chapel rank 1 (radius 6), church rank 2 (radius 10) and cathedral rank 3
// (radius 14), all 2x2 like the test chapel, and a Settlers' faith need
// of minimum rank minRank.
func chainCatalogue(t *testing.T, minRank int) *content.Catalogue {
	t.Helper()
	base := catalogue(t)
	c := *base
	c.BuildingByID = maps.Clone(base.BuildingByID)
	for _, b := range []struct {
		id     string
		rank   int
		radius int
	}{{"chapel", 1, 6}, {"church", 2, 10}, {"cathedral", 3, 14}} {
		def := *base.BuildingByID["chapel"]
		def.ID = b.id
		def.Service = &content.Service{Chain: "faith", Rank: b.rank, Levels: []content.ServiceLevel{{Radius: b.radius}}}
		c.BuildingByID[b.id] = &def
	}
	c.NeedsByTier = maps.Clone(base.NeedsByTier)
	c.NeedsByTier["settlers"] = append([]*content.Need{{
		ID: "settlers_faith", Name: "Faith", Tier: "settlers", Kind: content.NeedRequired, Weight: 0, Category: "faith",
		Chain: "faith", MinRank: minRank,
	}}, base.NeedsByTier["settlers"]...)
	return &c
}

func faithNeed(t *testing.T, w *World, c *content.Catalogue, h int64) NeedDisplay {
	t.Helper()
	for _, n := range buildingDisplay(t, display(t, w, c), h).Needs {
		if n.ID == "settlers_faith" {
			return n
		}
	}
	t.Fatal("no faith need")
	return NeedDisplay{}
}

// TestChainNeedRanks (D-065): a chain need is served by any building of
// its chain with rank >= the need's minimum rank, within that building's
// own radius; a lower rank never serves, whatever its distance.
func TestChainNeedRanks(t *testing.T) {
	// The house stands at x 9..10, y 2..3; the providers south of the road
	// at y 5 (dy = 2) and x = 10 + dx.
	for _, tc := range []struct {
		name    string
		minRank int
		typ     string
		dx      int
		served  bool
	}{
		{"chapel serves rank 1", 1, "chapel", 3, true},
		{"chapel does not serve rank 2 (a Merchant's faith)", 2, "chapel", 3, false},
		{"church serves its exact rank", 2, "church", 3, true},
		{"church does not serve rank 3", 3, "church", 3, false},
		{"cathedral serves rank 1 (a Settler's faith)", 1, "cathedral", 12, true},
		{"cathedral serves rank 3", 3, "cathedral", 12, true},
		// Own radius: the chapel's 6, not the church's 10.
		{"chapel out of its own radius", 1, "chapel", 7, false},
		{"church within its own radius", 1, "church", 7, true},
		{"church out of its own radius", 1, "church", 11, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			c := chainCatalogue(t, tc.minRank)
			w := newTown(t, c, 1_000)
			h := placeHouses(t, w, c, 1)[0]
			p := placeFree(t, w, c, tc.typ, 10+tc.dx, 5, 0)
			n := faithNeed(t, w, c, h)
			if n.Category != "faith" || n.Building != "" {
				t.Errorf("need %+v", n)
			}
			if tc.served {
				if n.FulfilmentPermille != 1000 || n.Reason != NeedOK {
					t.Errorf("want served: %+v", n)
				}
				if b := buildingDisplay(t, display(t, w, c), h); len(b.ServedBy) != 1 || b.ServedBy[0] != p {
					t.Errorf("served_by %v, want [%d]", b.ServedBy, p)
				}
			} else if n.FulfilmentPermille != 0 || n.Reason != NeedOutOfRange {
				t.Errorf("want not served: %+v", n)
			}
		})
	}
}

// TestChainNeedPausedProvider (D-065): a paused provider of a high enough
// rank is the reason when nothing else serves; a lower rank in range is
// not considered.
func TestChainNeedPausedProvider(t *testing.T) {
	c := withPauseCategory(chainCatalogue(t, 2), "church", "public")
	w := newTown(t, c, 1_000)
	h := placeHouses(t, w, c, 1)[0]
	placeFree(t, w, c, "chapel", 13, 5, 0)
	ch := placeFree(t, w, c, "church", 17, 5, 0)
	mustApply(t, w, c, SetPaused{IslandID: "main", BuildingID: ch, Paused: true})
	if n := faithNeed(t, w, c, h); n.FulfilmentPermille != 0 || n.Reason != NeedPaused {
		t.Errorf("paused church: %+v", n)
	}
}

// levelWorld is a 40x40 island of the shipped content: sea north of row
// 18, a Trading Post at (4,16), a road along y = 22 and enough gold and
// materials for every level cost.
func levelWorld(t *testing.T, c *content.Catalogue) *World {
	t.Helper()
	rows := make([]string, 0, 40)
	for y := range 40 {
		ch := "."
		switch {
		case y < 18:
			ch = "~"
		case y == 18:
			ch = "c"
		}
		rows = append(rows, strings.Repeat(ch, 40))
	}
	w := NewWorld(t0)
	w.Islands = []*Island{islandFromRows("main", rows...)}
	if err := PlaceFree(w, c, PlaceBuilding{IslandID: "main", Type: "trading_post", X: 4, Y: 16}, nil); err != nil {
		t.Fatal(err)
	}
	var road []Pos
	for x := 2; x <= 38; x++ {
		road = append(road, Pos{x, 22})
	}
	for y := 19; y < 22; y++ {
		road = append(road, Pos{10, y})
	}
	w.Gold = 100_000_000
	mustApply(t, w, c, PlaceRoad{IslandID: "main", Type: "road_dirt", Tiles: road})
	for _, g := range []string{"planks", "stone", "bricks"} {
		if err := AddStock(w, c, "main", g, 200_000, nil); err != nil {
			t.Fatal(err)
		}
	}
	return w
}

// TestLevelTierGates (D-065): market level n needs tier n (radius
// 12/15/18/21), warehouse levels 2-4 need Citizens, Merchants and
// Patricians (throughput 30/50/70/90); the city guard and the fire station
// have a single radius 16 and no levels.
func TestLevelTierGates(t *testing.T) {
	c := shippedCatalogue(t)
	w := levelWorld(t, c)
	market := placeFree(t, w, c, "market", 12, 23, 0)
	warehouse := placeFree(t, w, c, "warehouse", 18, 23, 0)
	guard := placeFree(t, w, c, "city_guard", 25, 23, 0)
	fire := placeFree(t, w, c, "fire_station", 30, 23, 0)

	for _, tc := range []struct {
		id    int64
		typ   string
		value func(*content.Building, int) int
		want  []int
	}{
		{market, "market", func(d *content.Building, l int) int { return d.Service.RadiusAt(l) }, []int{12, 15, 18, 21}},
		{warehouse, "warehouse", func(d *content.Building, l int) int { return int(d.ThroughputAt(l) / 1000) }, []int{30, 50, 70, 90}},
	} {
		def := c.BuildingByID[tc.typ]
		cmd := UpgradeBuilding{IslandID: "main", BuildingID: tc.id}
		for level, tier := range []string{"citizens", "merchants", "patricians"} {
			if got := tc.value(def, level+1); got != tc.want[level] {
				t.Errorf("%s level %d: %d, want %d", tc.typ, level+1, got, tc.want[level])
			}
			if err := Apply(w, c, cmd); !errors.Is(err, ErrTierLocked) {
				t.Fatalf("%s level %d before %s: %v, want %v", tc.typ, level+2, tier, err, ErrTierLocked)
			}
			w.UnlockedTiers = append(w.UnlockedTiers, tier)
			mustApply(t, w, c, cmd)
			if b := w.Islands[0].Building(tc.id); b.Level != level+2 {
				t.Fatalf("%s level %d, want %d", tc.typ, b.Level, level+2)
			}
			w.UnlockedTiers = w.UnlockedTiers[:len(w.UnlockedTiers)-1]
			if level == 2 {
				if got := tc.value(def, 4); got != tc.want[3] {
					t.Errorf("%s level 4: %d, want %d", tc.typ, got, tc.want[3])
				}
			}
		}
		w.UnlockedTiers = append(w.UnlockedTiers, "citizens", "merchants", "patricians")
		expectApplyErr(t, w, c, cmd, ErrUpgradeUnavailable)
		w.UnlockedTiers = nil
	}

	w.UnlockedTiers = []string{"citizens", "merchants", "patricians"}
	for _, id := range []int64{guard, fire} {
		b := w.Islands[0].Building(id)
		def := c.BuildingByID[b.Type]
		if def.Service == nil || len(def.Service.Levels) != 1 || def.Service.RadiusAt(1) != 16 || def.Service.Chain != "" {
			t.Errorf("%s service %+v", b.Type, def.Service)
		}
		expectApplyErr(t, w, c, UpgradeBuilding{IslandID: "main", BuildingID: id}, ErrUpgradeUnavailable)
	}
}
