package sim

import (
	"bytes"
	"testing"
	"time"

	"github.com/ricoberger/new-shores/server/internal/content"
)

// trialTown: five settler houses at their floor with only a market in
// range (taxes 5 x 0.12 = 0.6 gold/min), a fisher (1 gold/min) and a
// sawmill (2 gold/min) paused for insolvency, nothing in stock and no gold:
// rule (b) fails for both, so only the trial reserve can restart them.
func trialTown(t *testing.T, connectFisher bool) (*content.Catalogue, *World, int64, int64) {
	t.Helper()
	c := withoutQuests(catalogue(t))
	w := newTown(t, c, 0)
	placeHouses(t, w, c, 5)
	placeFree(t, w, c, "market_small", 17, 1, 0)
	sawmill := placeFree(t, w, c, "sawmill", 24, 2, 0)
	if !connectFisher {
		// The road tile (6,3) is the fisher's only connection.
		mustApply(t, w, c, DemolishRoad{IslandID: "main", Tiles: []Pos{{6, 3}}})
	}
	fisher := placeFree(t, w, c, "fisher", 6, 1, 0)
	// No gold: the cascade pauses everything at t0.
	mustAdvance(t, w, c, time.Millisecond)
	for _, id := range []int64{sawmill, fisher} {
		if b := w.Islands[0].Building(id); !b.Paused || b.PausedReason != PausedReasonUnpaid {
			t.Fatalf("building %d not unpaid: %+v", id, b)
		}
	}
	return c, w, fisher, sawmill
}

// TestTrialResume (rule (c), future D-047): with (b) failing, the most
// recently paused building (the fisher, tier-1 food is paused last) is
// resumed when gold reaches trial_resume_upkeep_minutes x its upkeep, at
// exactly that millisecond, as an auto_resume boundary with Trial set after
// a gold_trial_reserve boundary; the town then recovers (fish lifts the
// taxes, the sawmill follows by (a) + (b)). Splits around the trial give
// the same world.
func TestTrialResume(t *testing.T) {
	c, w, fisher, sawmill := trialTown(t, true)
	ds := display(t, w, c)
	if ds.BalanceRatePerMin != 600 || ds.Gold != 0 {
		t.Fatalf("stalled: balance %d gold %d", ds.BalanceRatePerMin, ds.Gold)
	}
	// 30 gold at 0.6 gold/min: 50 minutes after the stall at t0.
	trialAt := t0.Add(50 * time.Minute)
	if ds.NextChangeAt == nil || *ds.NextChangeAt != trialAt.Format(timeLayout) {
		t.Fatalf("next_change_at %v, want the trial reserve at %s", *ds.NextChangeAt, trialAt.Format(timeLayout))
	}
	start := w.Clone()
	bs := mustAdvance(t, w, c, 2*time.Hour)
	var trial, reserve *Boundary
	for i := range bs {
		switch {
		case bs[i].Kind == BoundaryGoldTrialReserve && reserve == nil:
			reserve = &bs[i]
		case bs[i].Kind == BoundaryAutoResume && bs[i].Trial && trial == nil:
			trial = &bs[i]
		}
	}
	if reserve == nil || trial == nil || !trial.At.Equal(trialAt) || !reserve.At.Equal(trialAt) || trial.BuildingID != fisher {
		t.Fatalf("reserve %+v trial %+v in %v", reserve, trial, bs)
	}
	trials := 0
	for _, b := range bs {
		if b.Kind == BoundaryAutoResume && b.At.Equal(trialAt) && b.BuildingID != fisher {
			t.Errorf("second resume at the trial instant: %+v", b)
		}
		if b.Kind == BoundaryAutoResume && b.Trial {
			trials++
		}
		if b.Kind == BoundaryAutoResume && b.BuildingID == sawmill && b.Trial {
			t.Errorf("the sawmill needed a trial: %+v", b)
		}
	}
	if trials != 1 || w.Islands[0].Building(sawmill).Paused || w.Islands[0].Building(fisher).Paused {
		t.Fatalf("trials %d, sawmill paused %v, fisher paused %v", trials, w.Islands[0].Building(sawmill).Paused, w.Islands[0].Building(fisher).Paused)
	}
	if ds := display(t, w, c); ds.BalanceRatePerMin < 0 || ds.Insolvency.UnpaidBuildings != 0 {
		t.Errorf("after recovery: balance %d insolvency %+v", ds.BalanceRatePerMin, ds.Insolvency)
	}

	// Exactly at the reserve, not a millisecond earlier; splits at, before
	// and after the trial are invisible.
	before := start.Clone()
	if _, err := Advance(before, c, trialAt.Add(-time.Millisecond)); err != nil {
		t.Fatal(err)
	}
	if !before.Islands[0].Building(fisher).Paused {
		t.Fatal("trial before the reserve")
	}
	for _, split := range []time.Duration{-time.Millisecond, 0, time.Millisecond, time.Minute} {
		sw := start.Clone()
		if _, err := Advance(sw, c, trialAt.Add(split)); err != nil {
			t.Fatal(err)
		}
		if _, err := Advance(sw, c, start.LastEvaluatedAt.Add(2*time.Hour)); err != nil {
			t.Fatal(err)
		}
		if !bytes.Equal(encode(t, sw), encode(t, w)) {
			t.Errorf("split at %s differs from one Advance", split)
		}
	}
}

// TestTrialResumeFailsAndRepeats: a trial that cannot help (the fisher has
// no road, so no fish arrives) leaves the balance negative; the gold-zero
// cascade pauses the fisher again, and the next trial needs the full trial
// reserve again. Over 24 hours the attempts are bounded by ceil(24 h /
// trial window), gold never goes negative and nothing is destroyed.
func TestTrialResumeFailsAndRepeats(t *testing.T) {
	c, w, fisher, _ := trialTown(t, false)
	buildings := len(w.Islands[0].Buildings)
	bs := mustAdvance(t, w, c, 24*time.Hour)
	var trials, repauses int
	var last time.Time
	for _, b := range bs {
		switch {
		case b.Kind == BoundaryAutoResume && b.Trial:
			if b.BuildingID != fisher {
				t.Errorf("trial of %d, want the fisher", b.BuildingID)
			}
			if trials > 0 && b.At.Sub(last) < 50*time.Minute {
				t.Errorf("trial %s only %s after the previous one", b.At, b.At.Sub(last))
			}
			trials++
			last = b.At
		case b.Kind == BoundaryAutoPause && b.BuildingID == fisher:
			repauses++
		}
	}
	// Trial window: 30 gold at 0.6 gold/min = 50 minutes.
	window := time.Duration(c.Region.Rules.TrialResumeMs*1_000/600) * time.Millisecond
	bound := int((24*time.Hour + window - 1) / window)
	t.Logf("24 h: %d trial resumes (bound %d, window %s), %d re-pauses", trials, bound, window, repauses)
	if trials < 2 || trials > bound || repauses < trials-1 {
		t.Errorf("trials %d (bound %d), re-pauses %d", trials, bound, repauses)
	}
	if w.Gold < 0 || len(w.Islands[0].Buildings) != buildings {
		t.Errorf("gold %d, buildings %d", w.Gold, len(w.Islands[0].Buildings))
	}
}

// trialCatalogue is the shipped catalogue (no quests) with a short trial
// reserve (6 minutes of upkeep, just above the 5-minute reserve), so that
// random property cases cross trial reserves within their advancements.
func trialCatalogue(t *testing.T) *content.Catalogue {
	c := *withoutQuests(catalogue(t))
	c.Region.Rules.TrialResumeMs = 6 * 60_000
	return &c
}

// trialWorld is a small town that stalls: one to five houses at their
// floor, a market, producers with upkeep, little or no need goods (so that
// rule (b) often fails) and little gold; the fisher is sometimes without
// a road (its trials cannot help).
func (p *propCase) trialWorld() *World {
	p.l = NewLedger()
	w := NewWorld(t0.Add(time.Duration(p.rng.IntN(1_000_000)) * time.Millisecond))
	w.Islands = []*Island{islandFromRows("main", townRows()...)}
	free := func(typ string, x, y, rot int) {
		if err := PlaceFree(w, p.c, PlaceBuilding{IslandID: "main", Type: typ, X: x, Y: y, Rotation: rot}, p.l); err != nil {
			p.fail("trial %s: %v", typ, err)
		}
	}
	free("trading_post", 1, 0, 0)
	var road []Pos
	if p.rng.IntN(3) > 0 {
		road = append(road, Pos{6, 3})
	}
	for x := 2; x <= 28; x++ {
		road = append(road, Pos{x, 4})
	}
	if err := ApplyWithLedger(w, p.c, PlaceRoad{IslandID: "main", Type: "road_dirt", Tiles: road}, p.l); err != nil {
		p.fail("trial road: %v", err)
	}
	free("market_small", 17, 1, 0)
	free("fisher", 6, 1, 0)
	for _, sp := range []struct {
		typ       string
		x, y, rot int
	}{{"weaver_wool", 21, 2, 0}, {"sawmill", 24, 2, 0}, {"sheep_farm", 24, 5, 180}, {"sawmill", 21, 5, 180}} {
		if p.rng.IntN(2) == 0 {
			free(sp.typ, sp.x, sp.y, sp.rot)
		}
	}
	for i, x := range []int{9, 11, 13, 15, 9}[:1+p.rng.IntN(5)] {
		if i < 4 {
			free("house_settlers", x, 2, 0)
		} else {
			free("house_settlers", x, 5, 180)
		}
	}
	if p.rng.IntN(2) == 0 {
		if err := AddStock(w, p.c, "main", "fish", Qty(p.rng.IntN(3))*1000, p.l); err != nil {
			p.fail("trial stock: %v", err)
		}
	}
	w.Gold = Qty(p.rng.IntN(3_000))
	return w
}

// TestPropertyTrialComposition: towns that stall and restart through trial
// resumes; advancements are split at random points and at the trial
// reserve, trial resume and re-pause instants (and one millisecond after
// them); every split equals one Advance and the invariants hold.
func TestPropertyTrialComposition(t *testing.T) {
	c := trialCatalogue(t)
	kinds, splitKinds := map[string]int{}, map[string]int{}
	for seed := range uint64(propertyCases) {
		p := newPropCase(t, c, 140_000+seed)
		p.maxPieces = 8
		p.w = p.trialWorld()
		p.checkInvariants("initial")
		for range 3 + p.rng.IntN(3) {
			d := time.Duration(1+p.rng.IntN(90*60_000)) * time.Millisecond
			for _, b := range p.advance(d, true) {
				kinds[b.Kind]++
				if b.Kind == BoundaryAutoResume && b.Trial {
					kinds["trial_resume"]++
				}
			}
		}
		for k, n := range p.splitKinds {
			splitKinds[k] += n
		}
	}
	t.Logf("boundaries %v; deliberate splits %v", kinds, splitKinds)
	if kinds["trial_resume"] < propertyCases/2 || kinds[BoundaryGoldTrialReserve] < propertyCases/2 {
		t.Errorf("only %d trial resumes and %d trial reserves", kinds["trial_resume"], kinds[BoundaryGoldTrialReserve])
	}
	for _, k := range []string{BoundaryGoldTrialReserve, "trial_resume"} {
		if splitKinds[k] < propertyCases/10 {
			t.Errorf("only %d splits at %s points", splitKinds[k], k)
		}
	}
}
