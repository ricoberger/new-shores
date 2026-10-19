package sim

import (
	"cmp"
	"slices"
	"time"

	"github.com/ricoberger/new-shores/server/internal/content"
)

// Economy rules (refining MECHANICS §7 and §12).
//
//   - balance = sum of house taxes - sum of upkeep of non-paused buildings,
//     world-wide, in gold sub-units per ms. Gold accrues linearly.
//   - gold_zero: when gold cannot cover one more millisecond of a negative
//     balance (-balance > gold), settle auto-pauses one candidate at a time
//     (non-paused, upkeep > 0, pause_category != never) in the order
//     need_goods < public < intermediate < food_basic, then building tier
//     descending, upkeep ascending, ID ascending, until balance >= 0. With no
//     candidate left, gold is held (rate 0) while the condition holds.
//   - auto-resume: the unpaid building with the highest pause sequence
//     resumes when gold >= auto_resume_upkeep_minutes x its upkeep and
//     balance - its upkeep >= 0; the next one is checked at the same instant.
//     A building paused during a settle is not resumed during the same
//     settle.
//   - tier unlocks are evaluated after every settle and successful Apply;
//     they are permanent and have no rate effect.
//
// Entry conditions are false strictly inside a step (Advance stops at the
// millisecond they become true) and the resume threshold is reached only at a
// boundary, so settling at an arbitrary split time is a no-op and Advance
// stays exactly composable.

// pauseRank orders pause categories for insolvency (MECHANICS §7); 0 means
// never paused. Rank 4 (ships on routes) does not exist yet.
func pauseRank(category string) int {
	switch category {
	case "need_goods":
		return 1
	case "public":
		return 2
	case "intermediate":
		return 3
	case "food_basic":
		return 5
	}
	return 0
}

// worldRates are the settled rates of all islands plus the world economy.
type worldRates struct {
	islands []*rates
	// tax, upkeep and balance in gold sub-units per ms (= milli-gold/min).
	tax, upkeep, balance int64
	// goldRate is the effective gold rate: the balance, or 0 while gold is
	// held at zero with nothing left to pause.
	goldRate int64
}

// settleWorld settles every island (house steps, regimes), applies
// insolvency pauses and auto-resumes and evaluates tier unlocks at time now.
// It returns the settled rates and the discrete events it applied.
func settleWorld(w *World, c *content.Catalogue, now int64) (*worldRates, []Boundary) {
	at := time.UnixMilli(now).UTC()
	var events []Boundary
	for _, is := range w.Islands {
		normalizeHouses(is, c)
	}
	pausedNow := map[*Building]bool{}
	// insolvent is set once gold cannot cover the balance: from then on the
	// cascade pauses until the balance is >= 0 (MECHANICS §7), even if the
	// lower drain could be covered for a moment.
	insolvent := false
	var wr *worldRates
	// Every iteration pauses or resumes one building; a building paused in
	// this settle is not resumed again, so the loop ends. The bound only
	// guards against a broken invariant.
	limit := 4 * (countBuildings(w) + 1)
	for iter := 0; ; iter++ {
		wr = &worldRates{islands: make([]*rates, len(w.Islands))}
		for i, is := range w.Islands {
			r := settle(is, c, now)
			wr.islands[i] = r
			wr.tax += r.tax
			wr.upkeep += r.upkeep
		}
		wr.balance = wr.tax - wr.upkeep
		wr.goldRate = wr.balance
		if iter >= limit {
			break
		}
		gold := w.goldFine()
		if wr.balance < 0 && (insolvent || -wr.balance > gold) {
			insolvent = true
			if is, b := pauseCandidate(w, c); b != nil {
				w.PauseSeq++
				b.Paused, b.PausedReason, b.PauseSeq = true, PausedReasonUnpaid, w.PauseSeq
				pausedNow[b] = true
				events = append(events, Boundary{At: at, Kind: BoundaryAutoPause, IslandID: is.ID, BuildingID: b.ID})
				continue
			}
			if -wr.balance > gold {
				wr.goldRate = 0
			}
		} else if is, b := resumeCandidate(w); b != nil && !pausedNow[b] {
			upkeep := c.BuildingByID[b.Type].UpkeepPerMin
			if gold >= resumeThreshold(c, upkeep) && wr.balance-upkeep >= 0 {
				b.Paused, b.PausedReason, b.PauseSeq = false, "", 0
				events = append(events, Boundary{At: at, Kind: BoundaryAutoResume, IslandID: is.ID, BuildingID: b.ID})
				continue
			}
		}
		break
	}
	for _, id := range evaluateUnlocks(w, c) {
		events = append(events, Boundary{At: at, Kind: BoundaryTierUnlocked, Tier: id})
	}
	return wr, events
}

func countBuildings(w *World) int {
	n := 0
	for _, is := range w.Islands {
		n += len(is.Buildings)
	}
	return n
}

// resumeThreshold is the gold (sub-units) required to auto-resume a
// building with the given upkeep (milli-gold per minute = sub-units per ms).
func resumeThreshold(c *content.Catalogue, upkeep Qty) int64 {
	return c.Region.Rules.AutoResumeMs * upkeep
}

// pauseCandidate returns the next building to pause for insolvency or nil.
func pauseCandidate(w *World, c *content.Catalogue) (*Island, *Building) {
	type cand struct {
		is   *Island
		b    *Building
		rank int
		tier int
		up   Qty
	}
	var best *cand
	for _, is := range w.Islands {
		for _, b := range is.Buildings {
			def := c.BuildingByID[b.Type]
			if def == nil || b.Paused || def.UpkeepPerMin <= 0 {
				continue
			}
			rank := pauseRank(def.PauseCategory)
			if rank == 0 {
				continue
			}
			tier := 0
			if t := c.TierByID[def.Tier]; t != nil {
				tier = t.Index
			}
			x := &cand{is: is, b: b, rank: rank, tier: tier, up: def.UpkeepPerMin}
			if best == nil || cmp.Or(
				cmp.Compare(x.rank, best.rank),
				cmp.Compare(best.tier, x.tier), // higher tier first
				cmp.Compare(x.up, best.up),
				cmp.Compare(x.b.ID, best.b.ID),
			) < 0 {
				best = x
			}
		}
	}
	if best == nil {
		return nil, nil
	}
	return best.is, best.b
}

// resumeCandidate returns the unpaid building with the highest pause
// sequence number or nil.
func resumeCandidate(w *World) (*Island, *Building) {
	var bestIs *Island
	var best *Building
	for _, is := range w.Islands {
		for _, b := range is.Buildings {
			if b.Paused && b.PausedReason == PausedReasonUnpaid && (best == nil || b.PauseSeq > best.PauseSeq) {
				bestIs, best = is, b
			}
		}
	}
	return bestIs, best
}

// TierUnlocked reports whether a tier is unlocked: the first tier always,
// any other tier once its unlock conditions held (permanent).
func TierUnlocked(w *World, c *content.Catalogue, tierID string) bool {
	t := c.TierByID[tierID]
	if t == nil {
		return false
	}
	return t.Index == 0 || slices.Contains(w.UnlockedTiers, tierID)
}

// UnlockedTiers returns all unlocked tiers in progression order.
func UnlockedTiers(w *World, c *content.Catalogue) []string {
	out := []string{}
	for _, t := range c.Tiers {
		if TierUnlocked(w, c, t.ID) {
			out = append(out, t.ID)
		}
	}
	return out
}

// worldPopulation returns the residents (milli) per tier over all islands.
func worldPopulation(w *World, c *content.Catalogue) map[string]Qty {
	pop := map[string]Qty{}
	for _, is := range w.Islands {
		for tier, n := range islandPopulation(is, c) {
			pop[tier] += n
		}
	}
	return pop
}

// unlockStatus evaluates the unlock conditions of a tier over the whole
// archipelago (MECHANICS §12). goods_delivered conditions cannot be met
// before trade routes exist.
type unlockStatus struct {
	population map[string][2]Qty // tier -> {have, need} in milli-residents
	buildings  map[string]bool
	goods      map[string]bool
	met        bool
}

func evaluateTier(w *World, c *content.Catalogue, t *content.Tier, pop map[string]Qty) unlockStatus {
	st := unlockStatus{population: map[string][2]Qty{}, buildings: map[string]bool{}, goods: map[string]bool{}, met: true}
	for tier, n := range t.Unlock.Population {
		need := n * content.MilliPerUnit
		st.population[tier] = [2]Qty{pop[tier], need}
		if pop[tier] < need {
			st.met = false
		}
	}
	for _, id := range t.Unlock.Buildings {
		st.buildings[id] = false
	}
	for _, is := range w.Islands {
		for _, b := range is.Buildings {
			if _, ok := st.buildings[b.Type]; ok {
				st.buildings[b.Type] = true
			}
		}
	}
	for _, ok := range st.buildings {
		if !ok {
			st.met = false
		}
	}
	for _, g := range t.Unlock.GoodsDelivered {
		st.goods[g] = false
		st.met = false
	}
	return st
}

// evaluateUnlocks unlocks every locked tier whose conditions hold and
// returns the newly unlocked tier IDs.
func evaluateUnlocks(w *World, c *content.Catalogue) []string {
	var pop map[string]Qty
	var unlocked []string
	for _, t := range c.Tiers {
		if TierUnlocked(w, c, t.ID) {
			continue
		}
		if pop == nil {
			pop = worldPopulation(w, c)
		}
		if evaluateTier(w, c, t, pop).met {
			unlocked = append(unlocked, t.ID)
		}
	}
	if len(unlocked) > 0 {
		// Keep progression order.
		var all []string
		for _, t := range c.Tiers {
			if t.Index > 0 && (slices.Contains(w.UnlockedTiers, t.ID) || slices.Contains(unlocked, t.ID)) {
				all = append(all, t.ID)
			}
		}
		w.UnlockedTiers = all
	}
	return unlocked
}

// stepWorld advances house accumulators and gold linearly by dt.
func stepWorld(w *World, wr *worldRates, dt int64) {
	for _, r := range wr.islands {
		for _, h := range r.houses {
			h.b.House.Growth += h.growth * dt
		}
	}
	gold := w.goldFine() + wr.goldRate*dt
	if gold < 0 {
		// Not reachable in exact mode (gold_zero boundary); coarse steps
		// clamp at zero.
		gold = 0
	}
	w.setGoldFine(gold)
}
