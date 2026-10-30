package sim

import (
	"bytes"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/ricoberger/new-shores/server/internal/content"
)

// questPropertyCatalogue is the shipped catalogue with quests that use
// every predicate, stock thresholds that are reached while advancing
// (stock_threshold boundaries), a chain, and goods rewards that can exceed
// the free capacity.
func questPropertyCatalogue(t *testing.T) *content.Catalogue {
	t.Helper()
	gold := func(g Qty) content.Rewards { return content.Rewards{Gold: g} }
	goods := func(gs ...content.GoodAmount) content.Rewards { return content.Rewards{Goods: gs} }
	stock := func(good string, units Qty, island string) content.Objective {
		return content.Objective{Kind: content.ObjectiveStock, Good: good, Island: island, Min: units * 1000}
	}
	qs := []*content.Quest{
		quest("p_road", gold(10_000), content.Objective{Kind: content.ObjectiveBuildingCount, Building: "road_dirt", Min: 18}),
		quest("p_wood", goods(content.GoodAmount{Good: "wood", Amount: 5_000}, content.GoodAmount{Good: "fish", Amount: 400_000}), stock("wood", 2, "main")),
		quest("p_planks", goods(content.GoodAmount{Good: "planks", Amount: 120_000}), stock("planks", 262, "")),
		quest("p_fish", gold(20_000), stock("fish", 7, "main")),
		quest("p_wood_more", gold(1_000), stock("wood", 25, "main")),
		quest("p_wool", gold(1_000), stock("wool", 3, "")),
		quest("p_garments", gold(1_000), stock("wool_garments", 2, "main")),
		quest("p_pop", gold(50_000), content.Objective{Kind: content.ObjectivePopulation, Tier: "settlers", Min: 14_000}),
		quest("p_sat", goods(content.GoodAmount{Good: "fish", Amount: 10_000}), content.Objective{Kind: content.ObjectiveSatisfaction, Tier: "settlers", Min: 600_000}),
		quest("p_conn", gold(5_000), content.Objective{Kind: content.ObjectiveConnected, Building: "sawmill"}),
		quest("p_tier", gold(5_000), content.Objective{Kind: content.ObjectiveTierUnlocked, Tier: "citizens"}),
		quest("p_chain", gold(1_000), stock("wood", 4, "main"), content.Objective{Kind: content.ObjectiveBuildingCount, Building: "house_settlers", Min: 2}),
	}
	qs[len(qs)-1].Prerequisites = []string{"p_wood", "p_conn"}
	return withQuests(catalogue(t), qs...)
}

// claimAll claims every claimable quest on island main through p.apply
// (conservation and bounds are checked) and verifies the credit: gold by
// the reward, every reward good by Granted - Lost with Granted the full
// reward; a second claim fails and leaves the world byte-identical.
func (p *propCase) claimAll() int {
	p.t.Helper()
	n := 0
	for _, id := range claimableQuests(p.w, p.c) {
		q := p.c.QuestByID[id]
		is := p.w.Island("main")
		if is == nil || !settled(is, p.c) {
			continue
		}
		before := map[string]int64{}
		for _, g := range q.Rewards.Goods {
			before[g.Good] = is.Inventory.fine(g.Good)
		}
		gold := p.w.Gold
		ledgerBefore := map[string]Flow{}
		for _, g := range q.Rewards.Goods {
			ledgerBefore[g.Good] = p.l.Flow("main", g.Good)
		}
		p.apply(ClaimQuest{QuestID: id, IslandID: "main"})
		if !p.w.Quests[id].Claimed {
			p.fail("claim of %s failed", id)
		}
		if p.w.Gold != gold+q.Rewards.Gold {
			p.fail("claim %s: gold %d -> %d, reward %d", id, gold, p.w.Gold, q.Rewards.Gold)
		}
		for _, g := range q.Rewards.Goods {
			f, f0 := p.l.Flow("main", g.Good), ledgerBefore[g.Good]
			granted, lost := f.Granted-f0.Granted, f.Lost-f0.Lost
			if granted != g.Amount*SubPerMilli || lost < 0 || is.Inventory.fine(g.Good)-before[g.Good] != granted-lost {
				p.fail("claim %s: %s stock %d -> %d, granted %d lost %d", id, g.Good, before[g.Good], is.Inventory.fine(g.Good), granted, lost)
			}
		}
		enc, _ := Encode(p.w, "p")
		if err := Apply(p.w, p.c, ClaimQuest{QuestID: id, IslandID: "main"}); !errors.Is(err, ErrQuestAlreadyClaimed) {
			p.fail("second claim of %s: %v", id, err)
		}
		if again, _ := Encode(p.w, "p"); !bytes.Equal(enc, again) {
			p.fail("failed second claim of %s changed the world", id)
		}
		n++
	}
	return n
}

// TestPropertyQuests: across random commands, claims and advancements
// split at random and deliberate points (stock_threshold and
// quest_completed instants included), the completed set never shrinks,
// completion times never change and are never in the future, split
// advancements equal one Advance (the encoded world includes the quest
// state and the summary accumulator), and rewards are credited exactly
// once.
func TestPropertyQuests(t *testing.T) {
	c := questPropertyCatalogue(t)
	completions, thresholds, claims := 0, 0, 0
	for seed := range uint64(propertyCases) {
		p := newPropCase(t, c, 120_000+seed)
		if seed%2 == 0 {
			p.w = p.townWorld()
		}
		p.checkInvariants("initial")
		seen := map[string]int64{}
		check := func(stage string) {
			for id, at := range seen {
				if st, ok := p.w.Quests[id]; !ok || st.CompletedAtMs != at {
					p.fail("%s: quest %s completed at %d is now %+v", stage, id, at, st)
				}
			}
			for id, st := range p.w.Quests {
				if st.CompletedAtMs > p.w.LastEvaluatedAt.UnixMilli() {
					p.fail("%s: quest %s completed in the future", stage, id)
				}
				seen[id] = st.CompletedAtMs
			}
		}
		for i := range 30 {
			switch r := p.rng.IntN(10); {
			case r < 4:
				for _, b := range p.advance(p.randomDuration(), true) {
					switch b.Kind {
					case BoundaryQuestCompleted:
						completions++
					case BoundaryStockThreshold:
						thresholds++
					}
				}
			case r < 5:
				claims += p.claimAll()
			default:
				p.apply(p.randomCommand())
			}
			check(fmt.Sprintf("op %d", i))
		}
	}
	t.Logf("quest completions at boundaries %d, stock thresholds %d, claims %d", completions, thresholds, claims)
	// Wood needs explicit tree plots since the work-area rule is gone, so
	// the random games reach fewer stock thresholds than they once did.
	if completions < propertyCases || thresholds < propertyCases/8 || claims < propertyCases {
		t.Errorf("vacuous: %d completions, %d thresholds, %d claims", completions, thresholds, claims)
	}
}

// TestPropertySummaryDeterministic: after commands (MarkSeen) and random
// advancements, the summary produced on the world, produced twice, on a
// clone and on a world advanced in one piece are byte-identical.
func TestPropertySummaryDeterministic(t *testing.T) {
	c := questPropertyCatalogue(t)
	nonEmpty := 0
	for seed := range uint64(propertyCases) {
		p := newPropCase(t, c, 130_000+seed)
		if seed%2 == 1 {
			p.w = p.townWorld()
		}
		for range 3 {
			for range 5 + p.rng.IntN(10) {
				p.apply(p.randomCommand())
			}
			p.claimAll()
			MarkSeen(p.w)
			single := p.w.Clone()
			d := 15*time.Minute + p.randomDuration()
			if _, err := Advance(single, c, p.w.LastEvaluatedAt.Add(d)); err != nil {
				p.fail("advance: %v", err)
			}
			p.advance(d, true)
			a, b := ProduceSummary(p.w, c), ProduceSummary(single, c)
			if !bytes.Equal(summaryJSON(t, a), summaryJSON(t, b)) ||
				!bytes.Equal(summaryJSON(t, a), summaryJSON(t, ProduceSummary(p.w, c))) ||
				!bytes.Equal(summaryJSON(t, a), summaryJSON(t, ProduceSummary(p.w.Clone(), c))) {
				p.fail("summary not deterministic:\n%s\n%s", summaryJSON(t, a), summaryJSON(t, b))
			}
			if !MaybeProduceSummary(p.w, c) || !bytes.Equal(summaryJSON(t, p.w.PendingSummary), summaryJSON(t, a)) {
				p.fail("pending summary differs from ProduceSummary")
			}
			for _, is := range a.Islands {
				if len(is.Goods) > 0 {
					nonEmpty++
					break
				}
			}
		}
	}
	if nonEmpty < propertyCases {
		t.Errorf("only %d summaries with goods", nonEmpty)
	}
}
