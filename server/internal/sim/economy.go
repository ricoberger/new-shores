package sim

import (
	"cmp"
	"slices"
	"time"

	"github.com/ricoberger/new-shores/server/internal/content"
)

// Economy rules (refining MECHANICS §7 and §12).
//
//   - balance = sum of house taxes - sum of upkeep of non-paused buildings
//     and ships, world-wide, in gold sub-units per ms. Gold accrues
//     linearly.
//   - gold_zero: when gold cannot cover one more millisecond of a negative
//     balance (-balance > gold), settle auto-pauses one candidate at a time
//     (non-paused, upkeep > 0, pause_category != never; every non-paused
//     ship with upkeep) in the order need_goods < public < intermediate <
//     ships < food_basic, then building/ship tier descending, upkeep
//     ascending, ID ascending, until balance >= 0. With no candidate left,
//     gold is held (rate 0) while the condition holds.
//   - auto-resume (R21): the unpaid building or ship with the highest pause
//     sequence resumes when (a) gold >= auto_resume_upkeep_minutes x its
//     upkeep and (b) the balance with it running and all rates recomputed
//     (regimes and arrival rates, not stock levels; see balanceAfterResume)
//     is >= 0; the next one is checked at the same instant, and the check
//     stops at the first candidate that fails. Gold reaching the reserve of
//     an eligible candidate is a gold_reserve boundary.
//     A building is never resumed at the millisecond it was paused
//     (Building.PausedAtMs), so settling twice at one time changes nothing.
//   - tier unlocks are evaluated after every settle and successful Apply;
//     they are permanent and have no rate effect.
//
// Entry conditions are false strictly inside a step (Advance stops at the
// millisecond they become true) and the resume threshold is reached only at a
// boundary, so settling at an arbitrary split time is a no-op and Advance
// stays exactly composable.

// shipPauseRank is the insolvency step of ships (MECHANICS §7 step 4).
const shipPauseRank = 4

// pauseRank orders pause categories for insolvency (MECHANICS §7); 0 means
// never paused. Rank 4 is ships (shipPauseRank).
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
	// resumable is the next unpaid building or ship if the balance with it
	// running and all rates recomputed is >= 0; it resumes once gold reaches
	// its reserve (a gold_reserve boundary).
	resumable pauseTarget
}

// pauseTarget is an insolvency pause candidate: a building (is, b) or a
// ship (s).
type pauseTarget struct {
	is *Island
	b  *Building
	s  *Ship
}

func (p pauseTarget) valid() bool { return p.b != nil || p.s != nil }

func (p pauseTarget) upkeep(c *content.Catalogue) Qty {
	if p.s != nil {
		if def := c.ShipByID[p.s.Type]; def != nil {
			return def.UpkeepPerMin
		}
		return 0
	}
	if def := c.BuildingByID[p.b.Type]; def != nil {
		return def.UpkeepPerMin
	}
	return 0
}

func (p pauseTarget) pausedAtMs() int64 {
	if p.s != nil {
		return p.s.PausedAtMs
	}
	return p.b.PausedAtMs
}

// boundary returns a boundary of the given kind naming the target.
func (p pauseTarget) boundary(kind string, at time.Time) Boundary {
	if p.s != nil {
		return Boundary{At: at, Kind: kind, IslandID: p.s.IslandID, ShipID: p.s.ID}
	}
	return Boundary{At: at, Kind: kind, IslandID: p.is.ID, BuildingID: p.b.ID}
}

// balanceAfterResume returns the world balance (gold sub-units per ms) with
// building b of island is running and all rates recomputed, without
// changing w (R21 (b)). Resuming can change more than the upkeep at once: a
// consumer of a need good takes arrivals from the houses (lower taxes), a
// public building fulfils building needs again (higher taxes), a producer
// draws on the workforce pool.
//
// The hypothetical rates use the current regimes and only the rate-based
// regime exits, never the stock-based entries: a good counts as available by
// its regime and arrival rate, not by its stock at this instant. The result
// therefore only changes at boundaries and commands, which keeps Advance
// composable. A resumed building that makes a good run out is paused again
// through gold_zero after the gold reserve is used up.
//
// A resumed ship only adds its upkeep (ships do not change island rates).
func balanceAfterResume(w *World, c *content.Catalogue, now int64, p pauseTarget) int64 {
	balance := -shipUpkeep(w, c)
	if p.s != nil {
		balance -= p.upkeep(c)
	}
	for _, ois := range w.Islands {
		cis := ois.clone()
		if p.b != nil && ois == p.is {
			cb := cis.Building(p.b.ID)
			cb.Paused, cb.PausedReason, cb.PauseSeq, cb.PausedAtMs = false, "", 0, 0
		}
		r := settleRegimes(cis, c, now, false)
		balance += r.tax - r.upkeep
	}
	return balance
}

// balanceAllResumed returns the world balance (gold sub-units per ms) with
// every building and ship paused for insolvency running and all rates
// recomputed like balanceAfterResume, without changing w. It is display
// information (the insolvency banner), never a resume condition.
func balanceAllResumed(w *World, c *content.Catalogue, now int64) int64 {
	var balance int64
	for _, s := range w.Ships {
		if def := c.ShipByID[s.Type]; def != nil && (!s.Paused || s.PausedReason == PausedReasonUnpaid) {
			balance -= def.UpkeepPerMin
		}
	}
	for _, ois := range w.Islands {
		cis := ois.clone()
		for _, b := range cis.Buildings {
			if b.Paused && b.PausedReason == PausedReasonUnpaid {
				b.Paused, b.PausedReason, b.PauseSeq, b.PausedAtMs = false, "", 0, 0
			}
		}
		r := settleRegimes(cis, c, now, false)
		balance += r.tax - r.upkeep
	}
	return balance
}

// settleWorld settles every island (house steps, regimes), applies
// insolvency pauses and auto-resumes and evaluates tier unlocks at time now.
// It returns the settled rates and the discrete events it applied.
func settleWorld(w *World, c *content.Catalogue, now int64) (*worldRates, []Boundary) {
	return settleWorldLedger(w, c, now, nil)
}

// settleWorldLedger is settleWorld recording goods movements in l. It first
// applies the due moments at now (ship_built, ship_arrived) and departures.
func settleWorldLedger(w *World, c *content.Catalogue, now int64, l *Ledger) (*worldRates, []Boundary) {
	at := time.UnixMilli(now).UTC()
	var events []Boundary
	applyDue(w, c, now, l)
	normalizeShips(w, now)
	for _, is := range w.Islands {
		w.Away.addPopulation(normalizeHouses(is, c))
	}
	// insolvent is set once gold cannot cover the balance: from then on the
	// cascade pauses until the balance is >= 0 (MECHANICS §7), even if the
	// lower drain could be covered for a moment.
	insolvent := false
	var wr *worldRates
	// Every iteration pauses or resumes one building; a building paused at
	// this instant is not resumed at it, so the loop ends. The bound only
	// guards against a broken invariant.
	limit := 4 * (countBuildings(w) + len(w.Ships) + 1)
	for iter := 0; ; iter++ {
		wr = &worldRates{islands: make([]*rates, len(w.Islands))}
		for i, is := range w.Islands {
			r := settle(is, c, now)
			wr.islands[i] = r
			wr.tax += r.tax
			wr.upkeep += r.upkeep
		}
		wr.upkeep += shipUpkeep(w, c)
		wr.balance = wr.tax - wr.upkeep
		wr.goldRate = wr.balance
		if iter >= limit {
			break
		}
		gold := w.goldFine()
		if wr.balance < 0 && (insolvent || -wr.balance > gold) {
			insolvent = true
			if p := pauseCandidate(w, c); p.valid() {
				w.PauseSeq++
				if p.s != nil {
					pauseShip(p.s, w.PauseSeq, now)
				} else {
					p.b.Paused, p.b.PausedReason, p.b.PauseSeq, p.b.PausedAtMs = true, PausedReasonUnpaid, w.PauseSeq, now
				}
				events = append(events, p.boundary(BoundaryAutoPause, at))
				w.Away.AutoPaused++
				continue
			}
			if -wr.balance > gold {
				wr.goldRate = 0
			}
		} else if p := resumeCandidate(w); p.valid() {
			if balanceAfterResume(w, c, now, p) >= 0 {
				wr.resumable = p
				if gold >= resumeThreshold(c, p.upkeep(c)) && now > p.pausedAtMs() {
					if p.s != nil {
						resumeShip(w, c, p.s, now, l)
					} else {
						p.b.Paused, p.b.PausedReason, p.b.PauseSeq, p.b.PausedAtMs = false, "", 0, 0
					}
					events = append(events, p.boundary(BoundaryAutoResume, at))
					w.Away.AutoResumed++
					continue
				}
			}
		}
		break
	}
	for _, id := range evaluateUnlocks(w, c) {
		events = append(events, Boundary{At: at, Kind: BoundaryTierUnlocked, Tier: id})
	}
	for _, id := range evaluateQuests(w, c, now, wr) {
		events = append(events, Boundary{At: at, Kind: BoundaryQuestCompleted, Quest: id})
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

// pauseCandidate returns the next building or ship to pause for
// insolvency (invalid target if none).
func pauseCandidate(w *World, c *content.Catalogue) pauseTarget {
	type cand struct {
		p    pauseTarget
		id   int64
		rank int
		tier int
		up   Qty
	}
	var best *cand
	consider := func(x *cand) {
		if best == nil || cmp.Or(
			cmp.Compare(x.rank, best.rank),
			cmp.Compare(best.tier, x.tier), // higher tier first
			cmp.Compare(x.up, best.up),
			cmp.Compare(x.id, best.id),
		) < 0 {
			best = x
		}
	}
	tierIndex := func(id string) int {
		if t := c.TierByID[id]; t != nil {
			return t.Index
		}
		return 0
	}
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
			consider(&cand{p: pauseTarget{is: is, b: b}, id: b.ID, rank: rank, tier: tierIndex(def.Tier), up: def.UpkeepPerMin})
		}
	}
	// Ranks are exclusive to buildings or ships, so IDs are only compared
	// within one kind.
	for _, s := range w.Ships {
		def := c.ShipByID[s.Type]
		if def == nil || s.Paused || def.UpkeepPerMin <= 0 {
			continue
		}
		consider(&cand{p: pauseTarget{s: s}, id: s.ID, rank: shipPauseRank, tier: tierIndex(def.Tier), up: def.UpkeepPerMin})
	}
	if best == nil {
		return pauseTarget{}
	}
	return best.p
}

// resumeCandidate returns the unpaid building or ship with the highest
// pause sequence number (invalid target if none).
func resumeCandidate(w *World) pauseTarget {
	var best pauseTarget
	var seq int64
	for _, is := range w.Islands {
		for _, b := range is.Buildings {
			if b.Paused && b.PausedReason == PausedReasonUnpaid && (!best.valid() || b.PauseSeq > seq) {
				best, seq = pauseTarget{is: is, b: b}, b.PauseSeq
			}
		}
	}
	for _, s := range w.Ships {
		if s.Paused && s.PausedReason == PausedReasonUnpaid && (!best.valid() || s.PauseSeq > seq) {
			best, seq = pauseTarget{s: s}, s.PauseSeq
		}
	}
	return best
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
	old := w.goldFine()
	gold := old + wr.goldRate*dt
	if gold < 0 {
		// Not reachable in exact mode (gold_zero boundary); coarse steps
		// clamp at zero.
		gold = 0
	}
	w.setGoldFine(gold)
	w.Away.GoldDeltaSub += gold - old
}
