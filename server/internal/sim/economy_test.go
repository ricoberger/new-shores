package sim

import (
	"bytes"
	"encoding/json"
	"errors"
	"maps"
	"slices"
	"testing"
	"time"

	"github.com/ricoberger/new-shores/server/internal/content"
)

// legacyUpkeep returns base with the upkeep the never-pausable buildings
// had before it was folded into their price (Trading Post 4, market 3, chapel
// 3, shipyard 1 gold/min). Shipped content can no longer hold gold at zero
// (a fully stalled town has no running cost), but the MECHANICS §7 rules
// for that state still exist; the insolvency tests written against these
// numbers keep exercising them through this code-built catalogue.
func legacyUpkeep(base *content.Catalogue) *content.Catalogue {
	up := map[string]Qty{}
	for id, v := range map[string]Qty{"trading_post": 4_000, "market_small": 3_000, "chapel": 3_000, "shipyard": 1_000} {
		if base.BuildingByID[id] != nil {
			up[id] = v
		}
	}
	return withUpkeep(base, up)
}

// bonusTax returns base with every tier's tax raised by the largest
// bonus that D-056 removed (variety x1.1 and optional needs x1.25): the
// recovery property cases were calibrated with those bonuses on the
// variety test content and otherwise miss their minimum boundary counts.
func bonusTax(base *content.Catalogue) *content.Catalogue {
	c := *base
	c.Tiers, c.TierByID = nil, map[string]*content.Tier{}
	for _, t := range base.Tiers {
		cp := *t
		cp.TaxPerResidentPerMin = cp.TaxPerResidentPerMin * 1375 / 1000
		c.Tiers = append(c.Tiers, &cp)
		c.TierByID[cp.ID] = &cp
	}
	return &c
}

// withoutQuests returns base without quests, for tests that compare exact
// boundary lists or worlds where a (permanent) quest completion is not the
// subject.
func withoutQuests(base *content.Catalogue) *content.Catalogue {
	c := *base
	c.Quests, c.QuestByID = nil, map[string]*content.Quest{}
	return &c
}

// noTrialMs is a trial reserve (100 000 minutes of upkeep) that no test
// reaches, for tests of the reserve rule (a) + (b) alone.
const noTrialMs = 100_000 * 60_000

// orderCatalogue is the shipped catalogue with the wool chain at the
// upkeep (2 gold/min each) and cycle (60 s) these insolvency-order tests
// were written for: the expected cascades rank buildings by upkeep and the
// resume decisions depend on the weaver's consumption, which the balancing
// pass changes freely.
func orderCatalogue(t *testing.T) *content.Catalogue {
	t.Helper()
	c := withUpkeep(legacyUpkeep(withoutQuests(catalogue(t))), map[string]Qty{"sheep_farm": 2_000, "weaver_wool": 2_000})
	// These tests check the reserve rule (a) + (b); the trial reserve (c)
	// is moved out of reach (TestTrialResume covers it).
	c.Region.Rules.TrialResumeMs = noTrialMs
	for _, id := range []string{"sheep_farm", "weaver_wool"} {
		b := *c.BuildingByID[id]
		rec := *b.Recipe
		rec.CycleMs = 60_000
		b.Recipe = &rec
		c.BuildingByID[id] = &b
	}
	return c
}

// pauseEvents returns the building IDs of the auto_pause or auto_resume
// events (boundaries with a building) of kind in order.
func pauseEvents(bs []Boundary, kind string) []int64 {
	var ids []int64
	for _, b := range bs {
		if b.Kind == kind && b.BuildingID != 0 {
			ids = append(ids, b.BuildingID)
		}
	}
	return ids
}

func equalIDs(a, b []int64) bool { return slices.Equal(a, b) }

// insolventTown places fisher, weaver, sawmill, sheep farm and lumberjack
// (in this ID order: 2..6) without houses and with 1 gold: upkeep 12/min,
// no taxes.
func insolventTown(t *testing.T, c *content.Catalogue) (w *World, fisher, weaver, sawmill, sheep, lumberjack int64) {
	t.Helper()
	w = newTown(t, c, 1)
	is := w.Islands[0]
	for y := 8; y <= 12; y++ {
		for x := 20; x <= 28; x++ {
			is.Tiles[is.index(x, y)].Terrain = content.TerrainForest
		}
	}
	fisher = placeFree(t, w, c, "fisher", 6, 1, 0)
	weaver = placeFree(t, w, c, "weaver_wool", 21, 2, 0)
	sawmill = placeFree(t, w, c, "sawmill", 24, 2, 0)
	sheep = placeFree(t, w, c, "sheep_farm", 24, 5, 180)
	lumberjack = placeFree(t, w, c, "lumberjack", 27, 5, 180)
	return w, fisher, weaver, sawmill, sheep, lumberjack
}

// TestAutoPauseCascadeAndHeldGold: when gold cannot cover the balance, all
// necessary pauses happen at the same instant in MECHANICS §7 order (need
// goods, then intermediates lowest upkeep first, then food); with nothing
// left to pause gold is held at zero.
func TestAutoPauseCascadeAndHeldGold(t *testing.T) {
	c := orderCatalogue(t)
	w, fisher, weaver, sawmill, sheep, lumberjack := insolventTown(t, c)
	// 1 gold = 60 000 000 sub-units at 12 000 sub-units/ms: 5 s.
	bs := mustAdvance(t, w, c, time.Minute)
	if len(bs) != 6 || bs[0].Kind != BoundaryGoldZero || !bs[0].At.Equal(t0.Add(5*time.Second)) {
		t.Fatalf("boundaries = %+v", bs)
	}
	want := []int64{weaver, lumberjack, sawmill, sheep, fisher}
	if got := pauseEvents(bs, BoundaryAutoPause); !equalIDs(got, want) {
		t.Errorf("pause order = %v, want %v", got, want)
	}
	for i, id := range want {
		b := w.Islands[0].Building(id)
		if !b.Paused || b.PausedReason != PausedReasonUnpaid || b.PauseSeq != int64(i+1) || !bs[i+1].At.Equal(bs[0].At) {
			t.Errorf("building %d = %+v at %s", id, b, bs[i+1].At)
		}
	}
	// Only the warehouse (never paused) still costs 4 gold/min: gold is
	// held at zero and nothing changes any more.
	ds := display(t, w, c)
	if w.Gold != 0 || w.GoldSub != 0 || ds.BalanceRatePerMin != -4_000 || ds.UpkeepRatePerMin != 4_000 || ds.NextChangeAt != nil {
		t.Errorf("gold %d sub %d balance %d next %v", w.Gold, w.GoldSub, ds.BalanceRatePerMin, ds.NextChangeAt)
	}
	if b := buildingDisplay(t, ds, weaver); b.Status != StatusPaused || b.PausedReason != PausedReasonUnpaid {
		t.Errorf("weaver display = %s %s", b.Status, b.PausedReason)
	}
	if bs := mustAdvance(t, w, c, 24*time.Hour); len(bs) != 0 || w.Gold != 0 {
		t.Errorf("held gold: %v gold %d", bs, w.Gold)
	}

	// A manually resumed unpaid building is paused again at once.
	mustApply(t, w, c, SetPaused{IslandID: "main", BuildingID: fisher, Paused: false})
	bs = mustAdvance(t, w, c, time.Millisecond)
	if got := pauseEvents(bs, BoundaryAutoPause); !equalIDs(got, []int64{fisher}) || w.Islands[0].Building(fisher).PauseSeq != 6 {
		t.Errorf("re-pause after manual resume: %v", bs)
	}
}

// TestAutoResumeOrderAndHysteresis: unpaid buildings resume in reverse pause
// order, each once gold reaches 5 minutes of its upkeep and the balance stays
// >= 0 without it.
func TestAutoResumeOrderAndHysteresis(t *testing.T) {
	c := orderCatalogue(t)
	// After the cascade of TestAutoPauseCascadeAndHeldGold: eight houses
	// with goods and a market, taxes 8 x R x 0.2 gold/min with R growing
	// 2 -> 8 by one resident per minute.
	recovering := func() (*World, []int64) {
		w, fisher, weaver, sawmill, sheep, lumberjack := insolventTown(t, c)
		mustAdvance(t, w, c, time.Minute)
		placeHouses(t, w, c, 8)
		placeFree(t, w, c, "market_small", 17, 1, 0)
		addStock(t, w, c, "fish", 150)
		addStock(t, w, c, "wool_garments", 100)
		return w, []int64{fisher, weaver, sawmill, sheep, lumberjack}
	}
	w, ids := recovering()
	fisher, weaver, sawmill, sheep, lumberjack := ids[0], ids[1], ids[2], ids[3], ids[4]
	start := w.LastEvaluatedAt
	bs := mustAdvance(t, w, c, 2*time.Hour)
	if n := countKind(bs, BoundaryAutoPause); n != 0 {
		t.Errorf("%d pauses after recovery: %v", n, bs)
	}
	// Balance at R = 8: 12.8 - 7 (warehouse, market) = 5.8; fisher (1),
	// sheep farm (2) and sawmill (2) fit, the lumberjack (1) would make it
	// negative and blocks the weaver behind it.
	if got := pauseEvents(bs, BoundaryAutoResume); !equalIDs(got, []int64{fisher, sheep, sawmill}) {
		t.Errorf("resume order = %v", got)
	}
	for _, id := range []int64{lumberjack, weaver} {
		if b := w.Islands[0].Building(id); !b.Paused || b.PausedReason != PausedReasonUnpaid {
			t.Errorf("building %d resumed: %+v", id, b)
		}
	}
	if ds := display(t, w, c); ds.BalanceRatePerMin != 800 {
		t.Errorf("final balance = %d", ds.BalanceRatePerMin)
	}

	// Hysteresis: the fisher resumes exactly when gold reaches 5 gold
	// (5 minutes of its upkeep), not earlier.
	var first time.Time
	for _, b := range bs {
		if b.Kind == BoundaryAutoResume && b.BuildingID == fisher {
			first = b.At
			break
		}
	}
	replay := func(d time.Duration) *World {
		w2, _ := recovering()
		mustAdvance(t, w2, c, d)
		return w2
	}
	before := replay(first.Sub(start) - time.Millisecond)
	at := replay(first.Sub(start))
	if b := before.Islands[0].Building(fisher); !b.Paused || before.goldFine() >= 5_000*GoldSubPerMilli {
		t.Errorf("1 ms before resume: paused %v gold %d", b.Paused, before.Gold)
	}
	if b := at.Islands[0].Building(fisher); b.Paused || at.goldFine() < 5_000*GoldSubPerMilli {
		t.Errorf("at resume: paused %v gold %d", b.Paused, at.Gold)
	}
}

// TestPublicBuildingPauseHysteresis: a paused public building fulfils no
// building need, so pausing it lowers taxes. Resuming it raises them again;
// the resume condition (gold >= 5 min of upkeep and balance - upkeep >= 0)
// must not let it oscillate with the auto-pause.
func TestPublicBuildingPauseHysteresis(t *testing.T) {
	c := withPauseCategory(legacyUpkeep(catalogue(t)), "market_small", "public")
	w := newTown(t, c, 0)
	houses := placeHouses(t, w, c, 8)
	market := placeFree(t, w, c, "market_small", 17, 1, 0)
	weaver := placeFree(t, w, c, "weaver_wool", 21, 2, 0)
	addStock(t, w, c, "fish", 200)
	addStock(t, w, c, "wool_garments", 100)

	// t0: taxes 16 x 0.2 = 3.2 < upkeep 9 with no gold: the weaver (need
	// goods) and then the market (public) are paused. Without the market
	// satisfaction is 0.7: taxes 2.24 < 4 (warehouse), gold held at zero.
	bs := mustAdvance(t, w, c, time.Millisecond)
	if got := pauseEvents(bs, BoundaryAutoPause); !equalIDs(got, []int64{weaver, market}) {
		t.Fatalf("pauses = %v", got)
	}
	ds := display(t, w, c)
	if b := buildingDisplay(t, ds, houses[0]); *b.SatisfactionPermille != 700 || ds.TaxRatePerMin != 2_240 || ds.BalanceRatePerMin != -1_760 {
		t.Fatalf("after pauses: satisfaction %d tax %d balance %d", *b.SatisfactionPermille, ds.TaxRatePerMin, ds.BalanceRatePerMin)
	}

	// Houses still grow (0.7 >= 0.5). At R = 7 the balance is 1.12 x 7 - 4 =
	// 3.84 >= 3 (market upkeep); once gold reaches 15 (5 min of the market's
	// upkeep) the market resumes, satisfaction returns to 1 and the weaver
	// follows at the same instant (gold >= 10, balance 11.2 - 7 - 2 >= 0).
	bs = mustAdvance(t, w, c, 3*time.Hour)
	resumes := pauseEvents(bs, BoundaryAutoResume)
	if !equalIDs(resumes, []int64{market, weaver}) || countKind(bs, BoundaryAutoPause) != 0 {
		t.Fatalf("resumes %v, %d pauses: %+v", resumes, countKind(bs, BoundaryAutoPause), bs)
	}
	var at time.Time
	for _, b := range bs {
		if b.Kind == BoundaryAutoResume && b.BuildingID != 0 {
			if !at.IsZero() && !b.At.Equal(at) {
				t.Errorf("resumes at %s and %s", at, b.At)
			}
			at = b.At
		}
	}

	// Replay to the resume instant: gold covers 5 minutes of the market's
	// upkeep, and after resuming the balance is positive, so the market is
	// not paused again; gold keeps rising afterwards.
	w2 := newTown(t, c, 0)
	placeHouses(t, w2, c, 8)
	placeFree(t, w2, c, "market_small", 17, 1, 0)
	placeFree(t, w2, c, "weaver_wool", 21, 2, 0)
	addStock(t, w2, c, "fish", 200)
	addStock(t, w2, c, "wool_garments", 100)
	mustAdvance(t, w2, c, at.Sub(t0)-time.Millisecond)
	if !w2.Islands[0].Building(market).Paused || w2.goldFine() >= 15_000*GoldSubPerMilli {
		t.Fatalf("1 ms before resume: gold %d", w2.Gold)
	}
	mustAdvance(t, w2, c, time.Millisecond)
	ds = display(t, w2, c)
	if w2.Islands[0].Building(market).Paused || w2.goldFine() < 15_000*GoldSubPerMilli || ds.BalanceRatePerMin <= 0 {
		t.Fatalf("at resume: gold %d balance %d", w2.Gold, ds.BalanceRatePerMin)
	}
	gold := w2.goldFine()
	for range 12 {
		if bs := mustAdvance(t, w2, c, 15*time.Minute); countKind(bs, BoundaryAutoPause) != 0 || w2.goldFine() <= gold {
			t.Fatalf("after resume: %v gold %d -> %d", bs, gold, w2.goldFine())
		}
		gold = w2.goldFine()
	}
}

// TestUpgradeHouse checks the R12 validation order and the upgrade effect on
// the variety test content, and ErrUpgradeUnavailable on shipped content.
func TestUpgradeHouse(t *testing.T) {
	expectErr := func(t *testing.T, w *World, c *content.Catalogue, cmd Command, want error) {
		t.Helper()
		before := encode(t, w)
		if err := Apply(w, c, cmd); !errors.Is(err, want) {
			t.Fatalf("Apply(%+v) = %v, want %v", cmd, err, want)
		}
		if !bytes.Equal(before, encode(t, w)) {
			t.Fatal("world changed on error")
		}
	}

	t.Run("declared-only tier has no house", func(t *testing.T) {
		base := catalogue(t)
		cit := *base.TierByID["citizens"]
		cit.House = ""
		cc := *base
		cc.TierByID = maps.Clone(base.TierByID)
		cc.TierByID["citizens"] = &cit
		cc.Tiers = slices.Clone(base.Tiers)
		cc.Tiers[1] = &cit
		c := &cc
		w := newTown(t, c, 1_000)
		h := placeHouses(t, w, c, 1)[0]
		house(w, h).Residents = 8_000
		w.UnlockedTiers = []string{"citizens"}
		expectErr(t, w, c, UpgradeHouse{IslandID: "main", BuildingID: h}, ErrUpgradeUnavailable)
	})

	c := varietyCatalogue(t)
	w := newTown(t, c, 1_000)
	hs := placeHouses(t, w, c, 5) // 10 settlers: the population condition holds
	h := hs[0]
	cmd := UpgradeHouse{IslandID: "main", BuildingID: h}
	expectErr(t, w, c, UpgradeHouse{IslandID: "main", BuildingID: 99}, ErrBuildingNotFound)
	expectErr(t, w, c, UpgradeHouse{IslandID: "main", BuildingID: 1}, ErrNotAHouse)
	expectErr(t, w, c, cmd, ErrTierLocked)

	// Placing the market completes the unlock conditions (evaluated after
	// Apply); demolishing it later does not revoke the unlock.
	mustApply(t, w, c, PlaceBuilding{IslandID: "main", Type: "market_small", X: 17, Y: 1})
	if !TierUnlocked(w, c, "citizens") || TierUnlocked(w, c, "merchants") {
		t.Fatalf("unlocked = %v", w.UnlockedTiers)
	}
	expectErr(t, w, c, cmd, ErrHouseNotFull)
	house(w, h).Residents = 8_000
	expectErr(t, w, c, cmd, ErrNeedsUnmet) // no food, no clothing
	addStock(t, w, c, "fish", 50)
	addStock(t, w, c, "wool_garments", 50)
	// Fish alone covers 0.6 of the food category; both alternatives fill it.
	expectErr(t, w, c, cmd, ErrNeedsUnmet)
	addStock(t, w, c, "bread", 50)

	big := *c
	big.BuildingByID = maps.Clone(c.BuildingByID)
	hc := *c.BuildingByID["house_citizens"]
	hc.Width = 3
	big.BuildingByID["house_citizens"] = &hc
	expectErr(t, w, &big, cmd, ErrUpgradeUnavailable)

	w.Gold = 199_999
	expectErr(t, w, c, cmd, ErrInsufficientGold)
	w.Gold = 1_000_000
	planks := w.Islands[0].Inventory.Stock["planks"]
	mustApply(t, w, c, cmd)
	b := w.Islands[0].Building(h)
	if b.Type != "house_citizens" || b.House.Residents != 5_000 || b.House.Growth != 0 || b.X != 9 || b.Y != 2 {
		t.Errorf("upgraded = %+v %+v", b, b.House)
	}
	if w.Gold != 800_000 || w.Islands[0].Inventory.Stock["planks"] != planks-15_000 {
		t.Errorf("gold %d planks %d", w.Gold, w.Islands[0].Inventory.Stock["planks"])
	}
	// Citizens have no next tier with a house (merchants is declared only).
	b.House.Residents = 15_000
	expectErr(t, w, c, cmd, ErrUpgradeUnavailable)

	mustApply(t, w, c, Demolish{IslandID: "main", BuildingID: 7})
	if !TierUnlocked(w, c, "citizens") {
		t.Error("unlock revoked")
	}
	ds := display(t, w, c)
	if ds.Islands[0].Population["citizens"] != 15_000 || ds.Islands[0].Population["settlers"] != 8_000 {
		t.Errorf("population = %v", ds.Islands[0].Population)
	}
}

// TestTierGating: buildings and roads of a locked tier cannot be placed;
// PlaceFree is exempt.
func TestTierGating(t *testing.T) {
	c := varietyCatalogue(t)
	paved := &content.Building{ID: "road_paved", Name: "Paved road", Region: "old_coast", Tier: "citizens", Width: 1, Height: 1, PauseCategory: "never", Road: &content.Road{MsPerTile: 600}}
	cc := *c
	cc.BuildingByID = maps.Clone(c.BuildingByID)
	cc.BuildingByID[paved.ID] = paved

	w := newTown(t, &cc, 10_000)
	for _, cmd := range []Command{
		PlaceBuilding{IslandID: "main", Type: "tavern", X: 17, Y: 1},
		PlaceRoad{IslandID: "main", Type: "road_paved", Tiles: []Pos{{5, 7}}},
		PlaceBuilding{IslandID: "main", Type: "road_paved", X: 5, Y: 7},
	} {
		before := encode(t, w)
		if err := Apply(w, &cc, cmd); !errors.Is(err, ErrTierLocked) {
			t.Errorf("Apply(%+v) = %v", cmd, err)
		}
		if !bytes.Equal(before, encode(t, w)) {
			t.Error("world changed on error")
		}
	}
	placeFree(t, w, &cc, "tavern", 17, 1, 0)

	// A house of a later tier is upgrade-only, locked or not (R-12).
	before := encode(t, w)
	if err := Apply(w, &cc, PlaceBuilding{IslandID: "main", Type: "house_citizens", X: 9, Y: 2}); !errors.Is(err, ErrUpgradeOnly) {
		t.Errorf("place house_citizens = %v", err)
	}
	if !bytes.Equal(before, encode(t, w)) {
		t.Error("world changed on error")
	}

	w.UnlockedTiers = []string{"citizens"}
	mustApply(t, w, &cc, PlaceRoad{IslandID: "main", Type: "road_paved", Tiles: []Pos{{5, 7}}})
	mustApply(t, w, &cc, PlaceBuilding{IslandID: "main", Type: "tavern", X: 21, Y: 1})
	if err := Apply(w, &cc, PlaceBuilding{IslandID: "main", Type: "house_citizens", X: 9, Y: 2}); !errors.Is(err, ErrUpgradeOnly) {
		t.Errorf("place house_citizens after the unlock = %v", err)
	}
}

// TestDisplayPopulationFields checks the presence of the R25-R27 display
// fields and next_change_at for residents and auto_resume boundaries.
func TestDisplayPopulationFields(t *testing.T) {
	c := legacyUpkeep(catalogue(t))
	w := newTown(t, c, 1_000)
	h := placeHouses(t, w, c, 2)[0]
	placeFree(t, w, c, "market_small", 17, 1, 0)
	f := placeFree(t, w, c, "fisher", 6, 1, 0)
	addStock(t, w, c, "fish", 10)
	ds := display(t, w, c)
	data, err := json.Marshal(ds)
	if err != nil {
		t.Fatal(err)
	}
	var doc map[string]any
	if err := json.Unmarshal(data, &doc); err != nil {
		t.Fatal(err)
	}
	requireKeys(t, "state", doc, "gold", "balance_rate_per_min", "tax_rate_per_min", "upkeep_rate_per_min", "tiers")
	tiers := doc["tiers"].([]any)
	if len(tiers) != 2 {
		t.Fatalf("tiers = %v", tiers)
	}
	cit := tiers[1].(map[string]any)
	requireKeys(t, "tier", cit, "id", "unlocked", "population", "buildings", "goods_delivered")
	requireKeys(t, "tier population", cit["population"].(map[string]any)["settlers"].(map[string]any), "have", "need")
	if cit["buildings"].(map[string]any)["market_small"] != true || cit["buildings"].(map[string]any)["chapel"] != false || cit["unlocked"] != false {
		t.Errorf("citizens = %v", cit)
	}
	island := doc["islands"].([]any)[0].(map[string]any)
	requireKeys(t, "island", island, "workforce", "population")
	requireKeys(t, "workforce", island["workforce"].(map[string]any)["settlers"].(map[string]any), "available", "required", "factor_permille")
	for _, b := range island["buildings"].([]any) {
		b := b.(map[string]any)
		switch b["type"] {
		case "house_settlers":
			requireKeys(t, "house", b, "residents", "residents_floor", "residents_max", "growth_progress_permille", "growth_rate_per_min",
				"satisfaction_permille", "tax_rate_per_min", "needs")
			for _, n := range b["needs"].([]any) {
				requireKeys(t, "need", n.(map[string]any), "id", "kind", "fulfilment_permille", "reason")
			}
		case "fisher":
			requireKeys(t, "fisher", b, "workforce_factor_permille", "workforce")
		}
	}

	// Satisfaction 0.8 (no clothing): growth 0.8/min, the first resident
	// after 75 s, unless the fish arrival changes things earlier (23 s).
	hd := buildingDisplay(t, ds, h)
	if *hd.GrowthRatePerMin != 800 || *hd.SatisfactionPermille != 800 || *hd.ResidentsFloor != 2_000 || *hd.ResidentsMax != 8_000 {
		t.Errorf("house = rate %d satisfaction %d", *hd.GrowthRatePerMin, *hd.SatisfactionPermille)
	}
	mustApply(t, w, c, Demolish{IslandID: "main", BuildingID: f})
	ds = display(t, w, c)
	if ds.NextChangeAt == nil || *ds.NextChangeAt != "2026-01-01T00:01:15.000Z" {
		t.Fatalf("next_change_at = %v", ds.NextChangeAt)
	}
	bs := mustAdvance(t, w, c, 2*time.Minute)
	if bs[0].Kind != BoundaryResidents || bs[0].At.Format(timeLayout) != *ds.NextChangeAt {
		t.Errorf("first boundary %+v", bs[0])
	}

	// auto_resume: an unpaid fisher (upkeep 1) with 0 gold and full houses
	// resumes when gold reaches 5 gold (5 minutes of its upkeep).
	w = newTown(t, c, 0)
	placeHouses(t, w, c, 8)
	placeFree(t, w, c, "market_small", 17, 1, 0)
	addStock(t, w, c, "fish", 100)
	addStock(t, w, c, "wool_garments", 100)
	for _, hs := range w.Islands[0].Buildings {
		if hs.House != nil {
			hs.House.Residents = 8_000
		}
	}
	f = placeFree(t, w, c, "fisher", 6, 1, 0)
	fb := w.Islands[0].Building(f)
	w.PauseSeq, fb.Paused, fb.PausedReason, fb.PauseSeq = 1, true, PausedReasonUnpaid, 1
	// Balance 12.8 - 7 = 5.8 gold/min; 5 gold after ceil(5000*60000/5800)
	// ms = 51 725 ms.
	ds = display(t, w, c)
	if ds.BalanceRatePerMin != 5_800 || ds.NextChangeAt == nil || *ds.NextChangeAt != "2026-01-01T00:00:51.725Z" {
		t.Fatalf("balance %d next_change_at %v", ds.BalanceRatePerMin, ds.NextChangeAt)
	}
	bs = mustAdvance(t, w, c, time.Minute)
	if len(bs) < 2 || bs[0].Kind != BoundaryGoldReserve || bs[0].BuildingID != f || bs[1].Kind != BoundaryAutoResume || bs[1].BuildingID != f ||
		bs[1].At.Format(timeLayout) != *ds.NextChangeAt {
		t.Errorf("boundaries = %+v", bs)
	}
}

// TestPropertyCoverageMonotonic (R16, MECHANICS §13, D-056): making one
// more good of a category supplied (adding stock) never lowers any house's
// coverage, satisfaction, tax or growth rate.
func TestPropertyCoverageMonotonic(t *testing.T) {
	c := varietyCatalogue(t)
	for seed := range uint64(propertyCases) {
		p := newPropCase(t, c, 40_000+seed)
		p.w = p.townWorld()
		p.run(false)
		for _, good := range []string{"fish", "bread", "wool_garments"} {
			w := p.w.Clone()
			if committedFine(w.Islands[0], good, w.LastEvaluatedAt.UnixMilli())+1000*SubPerMilli > capacityFine(w.Islands[0], c) {
				continue
			}
			before := display(t, w, c)
			if err := AddStock(w, c, "main", good, 1000, nil); err != nil {
				t.Fatal(err)
			}
			after := display(t, w, c)
			for i, b := range before.Islands[0].Buildings {
				a := after.Islands[0].Buildings[i]
				if b.Residents == nil {
					continue
				}
				if *a.SatisfactionPermille < *b.SatisfactionPermille || *a.TaxRatePerMin < *b.TaxRatePerMin ||
					*a.GrowthRatePerMin < *b.GrowthRatePerMin {
					t.Fatalf("seed %d: adding %s lowered house %d: %+v -> %+v", seed, good, b.ID, b, a)
				}
				for j, n := range b.Needs {
					if a.Needs[j].FulfilmentPermille < n.FulfilmentPermille {
						t.Fatalf("seed %d: adding %s lowered need %s of house %d", seed, good, n.ID, b.ID)
					}
				}
			}
		}
	}
}

// fishWeaverTown: eight full settler houses with a market and clothing in
// stock, an unpaid weaver that consumes fish (shipped catalogue with the
// default 5-minute reserve) and fish arriving at fishPerMin milli-units per
// minute with an empty stock.
func fishWeaverTown(t *testing.T, fishPerMin Qty) (*content.Catalogue, *World, int64) {
	t.Helper()
	c := orderCatalogue(t)
	weaver := *c.BuildingByID["weaver_wool"]
	rec := *weaver.Recipe
	rec.Inputs = []content.GoodAmount{{Good: "fish", Amount: 1000}}
	weaver.Recipe = &rec
	c.BuildingByID = maps.Clone(c.BuildingByID)
	c.BuildingByID["weaver_wool"] = &weaver

	w := newTown(t, c, 1_000)
	hs := placeHouses(t, w, c, 8)
	for _, id := range hs {
		house(w, id).Residents = 8_000
	}
	placeFree(t, w, c, "market_small", 17, 1, 0)
	wv := placeFree(t, w, c, "weaver_wool", 21, 2, 0)
	addStock(t, w, c, "wool_garments", 100)
	is := w.Islands[0]
	now := w.LastEvaluatedAt.UnixMilli()
	b := is.Building(wv)
	b.Paused, b.PausedReason, b.PauseSeq, b.PausedAtMs = true, PausedReasonUnpaid, 1, now-1
	w.PauseSeq = 1
	is.Building(hs[0]).Transit = []TransitSegment{{Good: "fish", FromMs: now - 1, ToMs: now + 3_600_000, RateSub: needRate(1000, fishPerMin)}}
	return c, w, wv
}

// TestResumeNeedsRecomputedBalance (R21 (b)): fish arrives at 0.6/min for
// houses that need 0.64/min. Gold covers the reserve and balance - upkeep =
// 5.4 - 2 >= 0, but with the weaver running it takes its share of the fish,
// taxes drop and the recomputed balance is negative: the weaver stays
// unpaid, and no gold_reserve boundary is scheduled for it.
func TestResumeNeedsRecomputedBalance(t *testing.T) {
	c, w, wv := fishWeaverTown(t, 600)
	ds := display(t, w, c)
	if ds.BalanceRatePerMin != 5_400 || ds.BalanceRatePerMin-2_000 < 0 {
		t.Fatalf("balance = %d", ds.BalanceRatePerMin)
	}
	if b := buildingDisplay(t, ds, wv); !b.Paused || b.PausedReason != PausedReasonUnpaid {
		t.Fatalf("weaver = %+v", b)
	}
	bs := mustAdvance(t, w, c, time.Hour)
	if countKind(bs, BoundaryAutoResume) != 0 || countKind(bs, BoundaryGoldReserve) != 0 || !w.Islands[0].Building(wv).Paused {
		t.Errorf("weaver resumed: %+v", bs)
	}
}

// TestResumeRegimeBasedNotStockBased (R21, review round 2): fish arrives at
// 0.65/min, a little more than the houses eat, so the fish stock grows from
// zero. The resume decision depends on the fish regime (not starved, i.e.
// available) and not on the growing stock: the weaver resumes at once, and
// any split of the advancement, including splits while the stock grows,
// gives the same world as one Advance.
func TestResumeRegimeBasedNotStockBased(t *testing.T) {
	c, w, wv := fishWeaverTown(t, 650)
	single := w.Clone()
	bs := mustAdvance(t, single, c, time.Hour)
	if len(pauseEvents(bs, BoundaryAutoResume)) == 0 || pauseEvents(bs, BoundaryAutoResume)[0] != wv || !bs[0].At.Equal(t0) {
		t.Fatalf("weaver not resumed at once: %+v", bs)
	}
	for _, splits := range [][]time.Duration{
		{time.Second, 59 * time.Second},
		{time.Millisecond, time.Millisecond, 7 * time.Second, 13 * time.Minute},
		{5 * time.Minute, 20 * time.Minute, 30 * time.Minute},
	} {
		split := w.Clone()
		var done time.Duration
		for _, d := range splits {
			mustAdvance(t, split, c, d)
			done += d
		}
		mustAdvance(t, split, c, time.Hour-done)
		if !bytes.Equal(encode(t, single), encode(t, split)) {
			t.Errorf("splits %v differ from a single Advance", splits)
		}
	}
}

// TestNoResumeAtPauseInstant (review round 1, PausedAtMs): a building is
// never auto-resumed at the millisecond of its insolvency pause, even when
// the reserve and the recomputed balance allow it; a gold_reserve boundary
// 1 ms later carries the resume. Settling twice at the pause instant changes
// nothing, and splitting exactly there gives the same world as one Advance.
// The state is constructed directly: with a valid (positive) reserve the
// cascade leaves gold below one millisecond of drain, so the guard is a
// safety net that real cascades rarely reach.
func TestNoResumeAtPauseInstant(t *testing.T) {
	c, w, wv := fishWeaverTown(t, 650) // 1000 gold, eligible weaver
	now := w.LastEvaluatedAt.UnixMilli()
	w.Islands[0].Building(wv).PausedAtMs = now

	before := encode(t, w)
	cw := w.Clone()
	settleWorld(cw, c, now)
	if !cw.Islands[0].Building(wv).Paused {
		t.Fatal("resumed at the pause instant")
	}
	settled := encode(t, cw)
	settleWorld(cw, c, now)
	if !bytes.Equal(settled, encode(t, cw)) {
		t.Error("settle at the pause instant is not idempotent")
	}
	if ds := display(t, w, c); ds.NextChangeAt == nil || *ds.NextChangeAt != "2026-01-01T00:00:00.001Z" {
		t.Errorf("next_change_at = %v", ds.NextChangeAt)
	}
	if !bytes.Equal(before, encode(t, w)) {
		t.Error("Display changed the world")
	}

	single, split := w.Clone(), w.Clone()
	bs := mustAdvance(t, single, c, time.Minute)
	if len(bs) < 2 || bs[0].Kind != BoundaryGoldReserve || bs[0].BuildingID != wv || bs[1].Kind != BoundaryAutoResume || bs[1].BuildingID != wv ||
		!bs[1].At.Equal(t0.Add(time.Millisecond)) {
		t.Fatalf("boundaries = %+v", bs)
	}
	mustAdvance(t, split, c, time.Millisecond)
	mustAdvance(t, split, c, time.Minute-time.Millisecond)
	if !bytes.Equal(encode(t, single), encode(t, split)) {
		t.Error("composition violated when splitting at the pause instant")
	}
}
