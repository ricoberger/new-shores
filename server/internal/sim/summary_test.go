package sim

import (
	"bytes"
	"encoding/json"
	"testing"
	"time"
)

func summaryJSON(t *testing.T, s *AwaySummary) []byte {
	t.Helper()
	data, err := json.Marshal(s)
	if err != nil {
		t.Fatal(err)
	}
	return data
}

// awayTown is a town with houses, fish, a growing population and a plank
// chain, last seen at its creation.
func awayTown(t *testing.T) (*World, func() *World) {
	t.Helper()
	c := withoutQuests(catalogue(t))
	build := func() *World {
		w := newTown(t, c, 50)
		placeHouses(t, w, c, 4)
		placeFree(t, w, c, "market_small", 17, 1, 0)
		addStock(t, w, c, "fish", 290)
		addStock(t, w, c, "wool_garments", 20)
		placeFree(t, w, c, "sawmill", 24, 2, 0)
		addStock(t, w, c, "wood", 150)
		MarkSeen(w)
		return w
	}
	return build(), build
}

// TestAwaySummaryContents: the summary over the time since the last
// command reports gold and population before and after, the goods flows
// of the interval (as the ledger records them), the stock at the end and
// the full regime; it is identical however the advancement was split.
func TestAwaySummaryContents(t *testing.T) {
	c := withoutQuests(catalogue(t))
	w, build := awayTown(t)
	gold0, pop0 := w.Gold, worldPopulation(w, c)["settlers"]
	l := NewLedger()
	if _, err := AdvanceWithLedger(w, c, t0.Add(3*time.Hour), l); err != nil {
		t.Fatal(err)
	}
	s := ProduceSummary(w, c)
	if s.ID != t0.Add(3*time.Hour).UnixMilli() || s.From != t0.Format(timeLayout) || s.To != t0.Add(3*time.Hour).Format(timeLayout) {
		t.Fatalf("interval %d %s %s", s.ID, s.From, s.To)
	}
	if s.GoldBefore != gold0 || s.GoldAfter != w.Gold || s.GoldAfter <= s.GoldBefore {
		t.Errorf("gold %d -> %d, want %d -> %d", s.GoldBefore, s.GoldAfter, gold0, w.Gold)
	}
	if p := s.Population["settlers"]; p.Before != pop0 || p.After != worldPopulation(w, c)["settlers"] || p.After <= p.Before {
		t.Errorf("population %+v (before %d)", p, pop0)
	}
	if len(s.Islands) != 1 || s.Islands[0].ID != "main" {
		t.Fatalf("islands %+v", s.Islands)
	}
	goods := s.Islands[0].Goods
	for _, good := range []string{"fish", "planks", "wood"} {
		g, f := goods[good], l.Flow("main", good)
		if g.Produced != FineToMilli(f.Produced) || g.Consumed != FineToMilli(f.Consumed) || g.Lost != FineToMilli(f.Lost) ||
			g.StockAfter != roundFine(w.Islands[0].Inventory.fine(good)) || g.Capacity != 300_000 {
			t.Errorf("%s = %+v, ledger %+v", good, g, f)
		}
	}
	// The sawmill turned the wood into planks until planks were full.
	if g := goods["planks"]; g.Produced <= 0 || !g.AtCapacity || goods["wood"].Consumed <= 0 || goods["fish"].AtCapacity {
		t.Errorf("planks %+v wood %+v fish %+v", g, goods["wood"], goods["fish"])
	}
	if s.AutoPaused != 0 || len(s.StillUnpaid) != 0 || s.ShipsArrived != 0 || len(s.QuestsCompleted) != 0 {
		t.Errorf("counts %+v", s)
	}

	// Splits do not change the accumulator; the summary is a pure function.
	for _, split := range []time.Duration{time.Millisecond, 17*time.Minute + 3*time.Millisecond, 2 * time.Hour} {
		sw := build()
		mustAdvance(t, sw, c, split)
		if _, err := Advance(sw, c, t0.Add(3*time.Hour)); err != nil {
			t.Fatal(err)
		}
		if !bytes.Equal(encode(t, sw), encode(t, w)) || !bytes.Equal(summaryJSON(t, ProduceSummary(sw, c)), summaryJSON(t, s)) {
			t.Errorf("split at %s changes the world or the summary", split)
		}
	}
	if !bytes.Equal(summaryJSON(t, ProduceSummary(w.Clone(), c)), summaryJSON(t, s)) {
		t.Error("summary of a clone differs")
	}
}

// TestSummaryProductionRule: no summary below the threshold; a summary at
// the threshold over [last seen, now]; a pending summary is replaced only
// once the gap since its end reaches the threshold again (by a superset);
// AckSummary clears only the matching summary; MarkSeen moves the last
// seen time and resets the accumulator.
func TestSummaryProductionRule(t *testing.T) {
	c := withoutQuests(catalogue(t))
	w, _ := awayTown(t)
	gap := time.Duration(c.Region.Rules.AwaySummaryMs) * time.Millisecond
	mustAdvance(t, w, c, gap-time.Millisecond)
	if MaybeProduceSummary(w, c) || w.PendingSummary != nil {
		t.Fatal("summary below the threshold")
	}
	mustAdvance(t, w, c, time.Millisecond)
	if !MaybeProduceSummary(w, c) || w.PendingSummary.ID != t0.Add(gap).UnixMilli() || w.PendingSummary.From != t0.Format(timeLayout) {
		t.Fatalf("summary at the threshold: %+v", w.PendingSummary)
	}
	first := w.PendingSummary.ID
	mustAdvance(t, w, c, gap-time.Millisecond)
	if MaybeProduceSummary(w, c) || w.PendingSummary.ID != first {
		t.Fatal("pending summary replaced before the threshold")
	}
	mustAdvance(t, w, c, time.Millisecond)
	if !MaybeProduceSummary(w, c) || w.PendingSummary.ID != t0.Add(2*gap).UnixMilli() || w.PendingSummary.From != t0.Format(timeLayout) {
		t.Fatalf("replacement %+v", w.PendingSummary)
	}
	ds := display(t, w, c)
	if ds.AwaySummary == nil || ds.AwaySummary.ID != w.PendingSummary.ID {
		t.Fatalf("display summary %+v", ds.AwaySummary)
	}

	// A stale acknowledgement changes nothing; the matching one clears.
	before := encode(t, w)
	mustApply(t, w, c, AckSummary{SummaryID: first})
	if !bytes.Equal(before, encode(t, w)) {
		t.Fatal("stale ack changed the world")
	}
	mustApply(t, w, c, AckSummary{SummaryID: t0.Add(2 * gap).UnixMilli()})
	if w.PendingSummary != nil {
		t.Fatal("ack did not clear the summary")
	}
	MarkSeen(w)
	if !w.LastSeenAt.Equal(w.LastEvaluatedAt) || w.Away.Flows != nil || w.Away.GoldDeltaSub != 0 || MaybeProduceSummary(w, c) {
		t.Fatalf("after MarkSeen: last seen %s away %+v", w.LastSeenAt, w.Away)
	}
	if ds := display(t, w, c); ds.AwaySummary != nil || ds.LastSeenAt != w.LastEvaluatedAt.Format(timeLayout) {
		t.Errorf("display %v %s", ds.AwaySummary, ds.LastSeenAt)
	}
}

// TestAwaySummaryEvents: insolvency pauses and resumes, ship arrivals and
// quest completions of the interval are reported; what is still unpaid at
// the end is listed.
func TestAwaySummaryEvents(t *testing.T) {
	c := withUpkeep(catalogue(t), map[string]Qty{})
	w, s := routeWorld(t, c)
	if err := AddStock(w, c, "b", "fish", 40_000, nil); err != nil {
		t.Fatal(err)
	}
	mustApply(t, w, c, CreateRoute{Stops: []Stop{{IslandID: "b", Load: []LoadRule{{"fish", 40_000}}}, {IslandID: "a", Unload: []string{"fish"}}}})
	mustApply(t, w, c, AssignShip{ShipID: s.ID, RouteID: 1})
	mustApply(t, w, c, PlaceBuilding{IslandID: "a", Type: "sawmill", X: 12, Y: 3})
	w.Gold, w.GoldSub = 0, 0
	MarkSeen(w)
	bs := mustAdvance(t, w, c, 20*time.Minute)
	sum := ProduceSummary(w, c)
	if sum.AutoPaused != countKind(bs, BoundaryAutoPause) || sum.AutoResumed != countKind(bs, BoundaryAutoResume) || sum.AutoPaused == 0 {
		t.Errorf("pauses %d resumes %d, boundaries %d/%d", sum.AutoPaused, sum.AutoResumed, countKind(bs, BoundaryAutoPause), countKind(bs, BoundaryAutoResume))
	}
	if sum.ShipsArrived != countKind(bs, BoundaryShipArrived) || len(sum.Arrivals) != min(sum.ShipsArrived, maxSummaryArrivals) {
		t.Errorf("arrivals %d %v, boundaries %d", sum.ShipsArrived, sum.Arrivals, countKind(bs, BoundaryShipArrived))
	}
	unpaid := 0
	for _, is := range w.Islands {
		for _, b := range is.Buildings {
			if b.PausedReason == PausedReasonUnpaid {
				unpaid++
			}
		}
	}
	for _, sh := range w.Ships {
		if sh.PausedReason == PausedReasonUnpaid {
			unpaid++
		}
	}
	if len(sum.StillUnpaid) != unpaid {
		t.Errorf("still unpaid %v, want %d", sum.StillUnpaid, unpaid)
	}
	for i, q := range sum.QuestsCompleted {
		at, _ := time.Parse(timeLayout, q.CompletedAt)
		if at.Before(t0) || (i > 0 && q.CompletedAt < sum.QuestsCompleted[i-1].CompletedAt) {
			t.Errorf("quest %+v", q)
		}
	}
}
