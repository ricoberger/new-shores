package sim

import (
	"bytes"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/ricoberger/new-shores/server/internal/content"
)

// withQuests returns base with the given quests (content order, indices
// set) instead of the shipped ones.
func withQuests(base *content.Catalogue, quests ...*content.Quest) *content.Catalogue {
	c := *base
	c.Quests, c.QuestByID = nil, map[string]*content.Quest{}
	for i, q := range quests {
		q.Index = i
		c.Quests = append(c.Quests, q)
		c.QuestByID[q.ID] = q
	}
	return &c
}

func quest(id string, rewards content.Rewards, objectives ...content.Objective) *content.Quest {
	return &content.Quest{ID: id, Title: id, Text: id, Objectives: objectives, Rewards: rewards}
}

var goldReward = content.Rewards{Gold: 10_000}

func completedAt(t *testing.T, w *World, id string) time.Time {
	t.Helper()
	st, ok := w.Quests[id]
	if !ok {
		t.Fatalf("quest %s not completed (%v)", id, w.Quests)
	}
	return time.UnixMilli(st.CompletedAtMs).UTC()
}

// TestQuestPredicates checks every objective kind against a town.
func TestQuestPredicates(t *testing.T) {
	base := withoutQuests(catalogue(t))
	obj := func(kind string, set func(*content.Objective)) content.Objective {
		o := content.Objective{Kind: kind, Min: 1}
		if set != nil {
			set(&o)
		}
		return o
	}
	tests := []struct {
		name  string
		o     content.Objective
		met   bool
		cur   int64
		after func(w *World, c *content.Catalogue)
	}{
		// newTown has 28 road tiles.
		{"road tiles", obj(content.ObjectiveBuildingCount, func(o *content.Objective) { o.Building, o.Min = "road_dirt", 28 }), true, 28, nil},
		{"road tiles short", obj(content.ObjectiveBuildingCount, func(o *content.Objective) { o.Building, o.Min = "road_dirt", 29 }), false, 28, nil},
		{"houses", obj(content.ObjectiveBuildingCount, func(o *content.Objective) { o.Building, o.Min = "house_settlers", 2 }), true, 2, nil},
		{"houses on another island", obj(content.ObjectiveBuildingCount, func(o *content.Objective) { o.Building, o.Island = "house_settlers", "elsewhere" }), false, 0, nil},
		{"trading post connected", obj(content.ObjectiveConnected, func(o *content.Objective) { o.Building = "trading_post" }), true, 1, nil},
		{"fisher not connected", obj(content.ObjectiveConnected, func(o *content.Objective) { o.Building = "fisher" }), false, 0, nil},
		{"population", obj(content.ObjectivePopulation, func(o *content.Objective) { o.Tier, o.Min = "settlers", 4_000 }), true, 4_000, nil},
		{"population short", obj(content.ObjectivePopulation, func(o *content.Objective) { o.Tier, o.Min = "settlers", 5_000 }), false, 4_000, nil},
		{"stock island", obj(content.ObjectiveStock, func(o *content.Objective) { o.Good, o.Island, o.Min = "planks", "main", 200_000 }), true, 200_000, nil},
		{"stock archipelago short", obj(content.ObjectiveStock, func(o *content.Objective) { o.Good, o.Min = "planks", 200_001 }), false, 200_000, nil},
		{"route without ship", obj(content.ObjectiveRouteExists, nil), false, 0, nil},
		{"settled islands", obj(content.ObjectiveIslandSettled, nil), true, 1, nil},
		{"two settled islands", obj(content.ObjectiveIslandSettled, func(o *content.Objective) { o.Min = 2 }), false, 1, nil},
		{"tier 1 unlocked", obj(content.ObjectiveTierUnlocked, func(o *content.Objective) { o.Tier = "settlers" }), true, 1, nil},
		{"tier 2 locked", obj(content.ObjectiveTierUnlocked, func(o *content.Objective) { o.Tier = "citizens" }), false, 0, nil},
		{"no ship", obj(content.ObjectiveShipCount, nil), false, 0, nil},
		// Two houses at their floor with fish only: satisfaction 0.5.
		{"satisfaction", obj(content.ObjectiveSatisfaction, func(o *content.Objective) { o.Tier, o.Min = "settlers", 500_000 }), true, 500_000, nil},
		{"satisfaction short", obj(content.ObjectiveSatisfaction, func(o *content.Objective) { o.Tier, o.Min = "settlers", 501_000 }), false, 500_000, nil},
		{"satisfaction without house", obj(content.ObjectiveSatisfaction, func(o *content.Objective) { o.Tier, o.Min = "citizens", 1 }), false, -1, nil},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			c := withQuests(base, quest("q", goldReward, tt.o))
			w := newTown(t, c, 100)
			placeHouses(t, w, c, 2)
			placeFree(t, w, c, "fisher", 7, 1, 0)
			addStock(t, w, c, "fish", 10)
			env := &questEnv{w: w, c: c, now: w.LastEvaluatedAt.UnixMilli()}
			if cur, _ := env.objectiveValue(tt.o); cur != tt.cur || env.met(tt.o) != tt.met {
				t.Errorf("current %d met %v, want %d %v", cur, env.met(tt.o), tt.cur, tt.met)
			}
			// The display settles a clone: a met objective shows the quest
			// completed, an unmet one its progress in display units.
			ds := display(t, w, c)
			if tt.met {
				if len(ds.Quests.Completed) != 1 || len(ds.Quests.Active) != 0 {
					t.Errorf("quests = %+v", ds.Quests)
				}
			} else {
				want := tt.cur
				if tt.o.Kind == content.ObjectiveSatisfaction && want > 0 {
					want /= 1000
				}
				if len(ds.Quests.Active) != 1 || len(ds.Quests.Active[0].Objectives) != 1 {
					t.Fatalf("quests = %+v", ds.Quests)
				}
				if od := ds.Quests.Active[0].Objectives[0]; od.Met || od.Current != want || od.Kind != tt.o.Kind || od.Target != ObjectiveTarget(tt.o) {
					t.Errorf("objective %+v, want current %d", od, want)
				}
			}
			// The settle of the next Advance completes the quest exactly
			// when the objective holds.
			mustAdvance(t, w, c, time.Millisecond)
			if QuestCompleted(w, "q") != tt.met {
				t.Errorf("completed %v, want %v", QuestCompleted(w, "q"), tt.met)
			}
		})
	}
}

// TestQuestRouteShipAndIslands: route_exists needs an assigned ship;
// ship_count counts every ship; island_settled counts founded islands.
func TestQuestRouteShipAndIslands(t *testing.T) {
	c := withQuests(withoutQuests(catalogue(t)),
		quest("ship", goldReward, content.Objective{Kind: content.ObjectiveShipCount, Min: 1}),
		quest("islands", goldReward, content.Objective{Kind: content.ObjectiveIslandSettled, Min: 2}),
		quest("route", goldReward, content.Objective{Kind: content.ObjectiveRouteExists}),
	)
	w := shipWorld(t, c)
	s := builtSloop(t, w, c)
	if !QuestCompleted(w, "ship") || QuestCompleted(w, "islands") {
		t.Fatalf("after the sloop: %v", w.Quests)
	}
	mustApply(t, w, c, ManualShipment{ShipID: s.ID, ToIslandID: "b", Cargo: []CargoAmount{{"planks", 30_000}}})
	mustAdvance(t, w, c, 30*time.Second)
	mustApply(t, w, c, FoundIsland{ShipID: s.ID, IslandID: "b", BuildingType: "trading_post", X: 1, Y: 0})
	if !QuestCompleted(w, "islands") || completedAt(t, w, "islands") != w.LastEvaluatedAt {
		t.Fatalf("after founding: %v", w.Quests)
	}
	mustApply(t, w, c, CreateRoute{Stops: []Stop{{IslandID: "a"}, {IslandID: "b"}}})
	if QuestCompleted(w, "route") {
		t.Fatal("a route without a ship completes route_exists")
	}
	mustApply(t, w, c, AssignShip{ShipID: s.ID, RouteID: 1})
	if !QuestCompleted(w, "route") {
		t.Fatal("route with an assigned ship does not complete route_exists")
	}
}

// TestQuestChainAndPermanence: prerequisites gate activity; a completion
// activates the successor, which completes at the same instant when its
// objectives already hold; completion is permanent.
func TestQuestChainAndPermanence(t *testing.T) {
	houses := content.Objective{Kind: content.ObjectiveBuildingCount, Building: "house_settlers", Min: 1}
	roads := content.Objective{Kind: content.ObjectiveBuildingCount, Building: "road_dirt", Min: 1}
	first, second, third := quest("first", goldReward, houses), quest("second", goldReward, roads), quest("third", goldReward, houses)
	second.Prerequisites = []string{"first"}
	third.Prerequisites = []string{"second"}
	c := withQuests(withoutQuests(catalogue(t)), first, second, third)
	w := newTown(t, c, 100)
	ds := display(t, w, c)
	if len(ds.Quests.Active) != 1 || ds.Quests.Active[0].ID != "first" || len(w.Quests) != 0 {
		t.Fatalf("active = %+v", ds.Quests.Active)
	}
	mustAdvance(t, w, c, time.Minute)
	mustApply(t, w, c, PlaceBuilding{IslandID: "main", Type: "house_settlers", X: 9, Y: 2})
	at := w.LastEvaluatedAt
	for _, id := range []string{"first", "second", "third"} {
		if completedAt(t, w, id) != at {
			t.Errorf("%s completed at %s, want %s (the command)", id, completedAt(t, w, id), at)
		}
	}
	// Demolishing the house does not un-complete anything.
	mustApply(t, w, c, Demolish{IslandID: "main", BuildingID: w.Islands[0].Buildings[len(w.Islands[0].Buildings)-1].ID})
	mustAdvance(t, w, c, time.Minute)
	ds = display(t, w, c)
	if len(w.Quests) != 3 || len(ds.Quests.Active) != 0 || len(ds.Quests.Completed) != 3 ||
		ds.Quests.Completed[0].ID != "first" || ds.Quests.Completed[2].ID != "third" || ds.Quests.Completed[0].CompletedAt != at.Format(timeLayout) {
		t.Fatalf("quests after demolish: %v %+v", w.Quests, ds.Quests)
	}
	if got := ds.Quests.Claimable; len(got) != 3 || got[0] != "first" {
		t.Errorf("claimable = %v", got)
	}
}

// TestQuestStockThresholdBoundary: the moment the stock reaches an active
// quest's threshold is a boundary; the completion time is that exact
// millisecond and any split of the advancement gives the same world.
func TestQuestStockThresholdBoundary(t *testing.T) {
	c := withQuests(withoutQuests(catalogue(t)),
		quest("wood", goldReward, content.Objective{Kind: content.ObjectiveStock, Good: "wood", Island: "main", Min: 3_000}))
	w := newTown(t, c, 1_000)
	placeHouses(t, w, c, 4)
	if err := GrantWorkforce(w, c, "main", "settlers", 20_000); err != nil {
		t.Fatal(err)
	}
	is := w.Islands[0]
	for y := 8; y <= 12; y++ {
		for x := 20; x <= 28; x++ {
			is.Tiles[is.index(x, y)].Terrain = content.TerrainForest
		}
	}
	placeFree(t, w, c, "lumberjack", 27, 5, 180)
	single := w.Clone()
	bs := mustAdvance(t, single, c, time.Hour)
	var thr, done *Boundary
	for i := range bs {
		switch {
		case bs[i].Kind == BoundaryStockThreshold && thr == nil:
			thr = &bs[i]
		case bs[i].Kind == BoundaryQuestCompleted && done == nil:
			done = &bs[i]
		}
	}
	if thr == nil || done == nil || !thr.At.Equal(done.At) || done.Quest != "wood" || thr.Quest != "wood" || thr.Good != "wood" {
		t.Fatalf("threshold %+v completed %+v in %v", thr, done, bs)
	}
	at := completedAt(t, single, "wood")
	if !at.Equal(done.At) {
		t.Fatalf("completed at %s, boundary at %s", at, done.At)
	}
	// Exactly reached at that millisecond, not before.
	before := w.Clone()
	mustAdvance(t, before, c, at.Sub(t0)-time.Millisecond)
	if QuestCompleted(before, "wood") || before.Islands[0].Inventory.fine("wood") >= 3_000*SubPerMilli {
		t.Fatalf("1 ms before: completed %v stock %d", QuestCompleted(before, "wood"), before.Islands[0].Inventory.Stock["wood"])
	}
	// Splits before, at and after the threshold give the same world.
	for _, split := range []time.Duration{at.Sub(t0) - time.Millisecond, at.Sub(t0), at.Sub(t0) + time.Millisecond, 7 * time.Minute} {
		sw := w.Clone()
		mustAdvance(t, sw, c, split)
		if _, err := Advance(sw, c, t0.Add(time.Hour)); err != nil {
			t.Fatal(err)
		}
		if !bytes.Equal(encode(t, sw), encode(t, single)) {
			t.Errorf("split at %s differs from one Advance", split)
		}
	}
}

// TestClaimQuest checks the claim validation and crediting.
func TestClaimQuest(t *testing.T) {
	houses := content.Objective{Kind: content.ObjectiveBuildingCount, Building: "house_settlers", Min: 1}
	goods := quest("goods", content.Rewards{Gold: 5_000, Goods: []content.GoodAmount{{Good: "fish", Amount: 50_000}, {Good: "planks", Amount: 150_000}}}, houses)
	gold := quest("gold", content.Rewards{Gold: 20_000}, houses)
	never := quest("never", goldReward, content.Objective{Kind: content.ObjectiveShipCount, Min: 1})
	c := withQuests(withoutQuests(catalogue(t)), goods, gold, never)
	w := newTown(t, c, 100)
	placeHouses(t, w, c, 1)
	w.Islands = append(w.Islands, islandFromRows("empty", "~~~~", "~cc~", "~~~~"))
	mustAdvance(t, w, c, time.Second)

	for _, tt := range []struct {
		cmd  ClaimQuest
		want error
	}{
		{ClaimQuest{QuestID: "nope", IslandID: "main"}, ErrQuestNotFound},
		{ClaimQuest{QuestID: "never", IslandID: "main"}, ErrQuestNotCompleted},
		{ClaimQuest{QuestID: "goods"}, ErrInvalidCommand},
		{ClaimQuest{QuestID: "goods", IslandID: "nowhere"}, ErrUnknownIsland},
		{ClaimQuest{QuestID: "goods", IslandID: "empty"}, ErrIslandNotSettled},
		{ClaimQuest{QuestID: "gold", IslandID: "nowhere"}, ErrUnknownIsland},
	} {
		expectErr(t, w, c, tt.cmd, tt.want)
	}

	// Goods are credited up to the free committed capacity (300 per good;
	// 200 planks in stock): 50 fish, 100 of 150 planks, 50 lost.
	l := NewLedger()
	g0, fish0 := w.Gold, w.Islands[0].Inventory.Stock["fish"]
	if err := ApplyWithLedger(w, c, ClaimQuest{QuestID: "goods", IslandID: "main"}, l); err != nil {
		t.Fatal(err)
	}
	inv := w.Islands[0].Inventory
	if w.Gold != g0+5_000 || inv.Stock["fish"] != fish0+50_000 || inv.Stock["planks"] != 300_000 {
		t.Fatalf("gold %d fish %d planks %d", w.Gold, inv.Stock["fish"], inv.Stock["planks"])
	}
	if f := l.Flow("main", "planks"); f.Granted != 150_000*SubPerMilli || f.Lost != 50_000*SubPerMilli {
		t.Errorf("planks flow %+v", f)
	}
	if !w.Quests["goods"].Claimed {
		t.Error("not marked claimed")
	}
	// Exactly once.
	expectErr(t, w, c, ClaimQuest{QuestID: "goods", IslandID: "main"}, ErrQuestAlreadyClaimed)

	// A gold-only quest needs no island.
	mustApply(t, w, c, ClaimQuest{QuestID: "gold"})
	if w.Gold != g0+25_000 {
		t.Errorf("gold %d", w.Gold)
	}
	ds := display(t, w, c)
	if len(ds.Quests.Claimable) != 0 || len(ds.Quests.Completed) != 2 || !ds.Quests.Completed[0].Claimed {
		t.Errorf("quests %+v", ds.Quests)
	}
}

// TestShippedQuestsInDisplay: on the test world (a warehouse with a road
// of more than ten tiles) the shipped road quest is completed and
// claimable, and the next quest of the chain is active with its progress
// in the display units.
func TestShippedQuestsInDisplay(t *testing.T) {
	c := catalogue(t)
	w := testWorld(t, c)
	ds := display(t, w, c)
	data, err := json.Marshal(ds.Quests)
	if err != nil {
		t.Fatal(err)
	}
	first, second := c.Quests[0], c.Quests[1]
	if len(ds.Quests.Active) != 1 || ds.Quests.Active[0].ID != second.ID || len(ds.Quests.Claimable) != 1 || ds.Quests.Claimable[0] != first.ID {
		t.Fatalf("quests %s", data)
	}
	for i, o := range ds.Quests.Active[0].Objectives {
		if o.Target != ObjectiveTarget(second.Objectives[i]) || o.Kind != second.Objectives[i].Kind {
			t.Errorf("objective %d = %+v", i, o)
		}
	}
	if ds.LastSeenAt != w.LastSeenAt.Format(timeLayout) || ds.AwaySummary != nil {
		t.Errorf("last seen %s summary %v", ds.LastSeenAt, ds.AwaySummary)
	}
	if !errors.Is(Apply(w, c, ClaimQuest{QuestID: second.ID, IslandID: "main"}), ErrQuestNotCompleted) {
		t.Error("claim of an active quest")
	}
}
