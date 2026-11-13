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
//     ascending, ID ascending, until balance >= 0. Supply chains pause last
//     (D-075 §5): a building is skipped while it is its island's last
//     running producer of a good that a connected house on the island
//     consumes (any alternative of a goods need of its tier), whether the
//     need is met today or not — without it the need would fall below 0.6
//     — and, transitively, while it is the last running producer of an
//     input of a guarded producer; a producer whose input has no producer
//     on the island (running or paused) and no stock is not guarded
//     (supplyGuards). With no candidate left,
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
//   - trial resume (rule (c), future D-047): when (b) fails for the
//     candidate, it is resumed anyway once gold >= trial_resume_upkeep_minutes
//     x its upkeep (an auto_resume boundary with Trial set). After a trial
//     resume no further candidate is resumed at that instant. If the balance
//     stays negative, the gold_zero cascade pauses it again and the next
//     trial needs the trial reserve again. Gold reaching the trial reserve
//     is a gold_trial_reserve boundary. Without this rule a fully stalled
//     town with nothing in stock or in transit never restarts: the cascade
//     stops at balance >= 0, so the floor taxes stay below the upkeep of
//     the last-paused building, which is the first candidate.
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
	// trial is the next unpaid building or ship if that balance is
	// negative; it is trial-resumed once gold reaches its trial reserve (a
	// gold_trial_reserve boundary).
	trial pauseTarget
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
		return def.UpkeepAt(p.b.Level)
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
	for _, ois := range w.Islands() {
		cis := ois.clone(true) // discarded: the tiles are shared
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
	for _, ois := range w.Islands() {
		cis := ois.clone(true) // discarded: the tiles are shared
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
	for _, is := range w.Islands() {
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
		wr = &worldRates{islands: make([]*rates, len(w.Islands()))}
		for i, is := range w.Islands() {
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
			if p := pauseCandidate(w, c, wr, now); p.valid() {
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
		} else if p := resumeCandidate(w, c, now); p.valid() {
			// After a trial resume no further candidate is resumed at this
			// instant; the candidate is still evaluated so that its reserve
			// boundary is scheduled (at the next millisecond if gold already
			// covers it).
			ready := now > p.pausedAtMs() && now > w.LastTrialMs
			resume := func(trial bool) {
				if p.s != nil {
					resumeShip(w, c, p.s, now, l)
				} else {
					p.b.Paused, p.b.PausedReason, p.b.PauseSeq, p.b.PausedAtMs = false, "", 0, 0
				}
				b := p.boundary(BoundaryAutoResume, at)
				b.Trial = trial
				events = append(events, b)
				w.Away.AutoResumed++
			}
			if balanceAfterResume(w, c, now, p) >= 0 {
				wr.resumable = p
				if ready && gold >= resumeThreshold(c, p.upkeep(c)) {
					resume(false)
					continue
				}
			} else {
				wr.trial = p
				if ready && gold >= trialThreshold(c, p.upkeep(c)) {
					resume(true)
					w.LastTrialMs = now
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
	for _, is := range w.Islands() {
		n += len(is.Buildings)
	}
	return n
}

// resumeThreshold is the gold (sub-units) required to auto-resume a
// building with the given upkeep (milli-gold per minute = sub-units per ms).
func resumeThreshold(c *content.Catalogue, upkeep Qty) int64 {
	return c.Region.Rules.AutoResumeMs * upkeep
}

// trialThreshold is the gold (sub-units) required to trial-resume a
// building whose recomputed balance is negative (rule (c), future D-047).
func trialThreshold(c *content.Catalogue, upkeep Qty) int64 {
	return c.Region.Rules.TrialResumeMs * upkeep
}

// supplyGuards returns the buildings of an island the auto-pause skips
// (D-075 §5): each is the island's last running (not paused) producer of a
// good that a connected house on the island consumes, any alternative of
// a goods need counting, whatever the need's fulfilment today: a met need
// (stock or arrivals at rate) would still fall below 0.6 without its last
// producer. The guard is transitive: the last running producer of every
// input good of a guarded producer (any accepted alternative) is guarded
// too, recursively over the recipes (content has no production cycles;
// the visited set ends the walk regardless). A producer is not guarded
// (and its inputs are not walked) while one of its input slots is cut
// off (inputCutOff: no producer on the island, running or paused, no
// stock and nothing in transit); a paused producer of an input keeps the
// guard (it can resume). Unconnected
// houses consume nothing and guard nothing. r are the island's settled
// rates.
func supplyGuards(is *Island, c *content.Catalogue, r *rates, now int64) map[int64]bool {
	var queue []string
	seen := map[string]bool{}
	add := func(g string) {
		if !seen[g] {
			seen[g] = true
			queue = append(queue, g)
		}
	}
	for _, h := range r.houses {
		if !h.connected {
			continue
		}
		for _, n := range h.needs {
			if n.goods == nil {
				continue
			}
			for _, g := range n.need.Goods {
				add(g.Good)
			}
		}
	}
	if len(queue) == 0 {
		return nil
	}
	// producers per good: the island's running producers in building
	// order.
	producers := map[string][]*Building{}
	for _, b := range is.Buildings {
		def := c.BuildingByID[b.Type]
		if def == nil || def.Recipe == nil || b.Paused {
			continue
		}
		for _, o := range def.Recipe.Outputs {
			producers[o.Good] = append(producers[o.Good], b)
		}
	}
	cut := newInputCutOff(is, c, now)
	guards := map[int64]bool{}
	for len(queue) > 0 {
		g := queue[0]
		queue = queue[1:]
		ps := producers[g]
		if len(ps) != 1 {
			continue // none, or a second producer lifts the guard
		}
		b := ps[0]
		if guards[b.ID] || cut.any(c.BuildingByID[b.Type]) {
			continue
		}
		guards[b.ID] = true
		for _, in := range c.BuildingByID[b.Type].Recipe.Inputs {
			for _, alt := range in.Goods {
				add(alt)
			}
			add(in.Good)
		}
	}
	return guards
}

// inputCutOff tells whether an input slot of a recipe is cut off on an
// island (D-075 §5): no building of the island produces any accepted good
// of the slot, running or paused, the island's stock of each is zero and
// none is on its way into the stock (a transit segment not yet over).
// Cargo aboard ships does not count; it reaches the stock at an unloading,
// a boundary. The inflow keeps the test piecewise constant between
// boundaries: stock only rises from zero with an inflow, and it falls to
// zero at a stock boundary, so splitting an advancement cannot change it
// (R31).
type inputCutOff struct {
	is *Island
	// available marks the goods any building of the island produces,
	// running or paused, or has in transit at now.
	available map[string]bool
}

func newInputCutOff(is *Island, c *content.Catalogue, now int64) inputCutOff {
	available := map[string]bool{}
	for _, b := range is.Buildings {
		if def := c.BuildingByID[b.Type]; def != nil && def.Recipe != nil {
			for _, o := range def.Recipe.Outputs {
				available[o.Good] = true
			}
		}
		for _, seg := range b.Transit {
			if seg.ToMs > now {
				available[seg.Good] = true
			}
		}
	}
	return inputCutOff{is: is, available: available}
}

func (x inputCutOff) has(g string) bool {
	return x.available[g] || x.is.Inventory.Stock[g] > 0
}

func (x inputCutOff) slot(in content.RecipeInput) bool {
	return !x.has(in.Good) && !slices.ContainsFunc(in.Goods, x.has)
}

// any reports whether def has a recipe with a cut-off input slot.
func (x inputCutOff) any(def *content.Building) bool {
	return def != nil && def.Recipe != nil && slices.ContainsFunc(def.Recipe.Inputs, x.slot)
}

// pauseCandidate returns the next building or ship to pause for
// insolvency (invalid target if none). wr are the settled rates of the
// world's islands (supplyGuards).
func pauseCandidate(w *World, c *content.Catalogue, wr *worldRates, now int64) pauseTarget {
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
	for i, is := range w.Islands() {
		var guards map[int64]bool
		if wr != nil && i < len(wr.islands) && wr.islands[i] != nil {
			guards = supplyGuards(is, c, wr.islands[i], now)
		}
		for _, b := range is.Buildings {
			def := c.BuildingByID[b.Type]
			if def == nil || b.Paused || def.UpkeepAt(b.Level) <= 0 || guards[b.ID] {
				continue
			}
			rank := pauseRank(def.PauseCategory)
			if rank == 0 {
				continue
			}
			consider(&cand{p: pauseTarget{is: is, b: b}, id: b.ID, rank: rank, tier: tierIndex(def.Tier), up: def.UpkeepAt(b.Level)})
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
// pause sequence number (invalid target if none). A producer with a
// cut-off input (inputCutOff: no producer of the input on its island,
// running or paused, no stock and nothing in transit) is skipped: it would only cost upkeep.
// It is a candidate again once an input producer is built or resumed or
// stock of the input arrives (the queue is evaluated at every boundary).
func resumeCandidate(w *World, c *content.Catalogue, now int64) pauseTarget {
	var best pauseTarget
	var seq int64
	for _, is := range w.Islands() {
		var cut *inputCutOff
		for _, b := range is.Buildings {
			if !b.Paused || b.PausedReason != PausedReasonUnpaid || (best.valid() && b.PauseSeq <= seq) {
				continue
			}
			if def := c.BuildingByID[b.Type]; def != nil && def.Recipe != nil && len(def.Recipe.Inputs) > 0 {
				if cut == nil {
					x := newInputCutOff(is, c, now)
					cut = &x
				}
				if cut.any(def) {
					continue
				}
			}
			best, seq = pauseTarget{is: is, b: b}, b.PauseSeq
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

// WorldPopulation returns the residents (milli) per tier over all islands.
func WorldPopulation(w *World, c *content.Catalogue) map[string]int64 {
	out := map[string]int64{}
	for tier, n := range worldPopulation(w, c) {
		out[tier] = int64(n)
	}
	return out
}

// worldPopulation returns the residents (milli) per tier over all islands.
func worldPopulation(w *World, c *content.Catalogue) map[string]Qty {
	pop := map[string]Qty{}
	for _, is := range w.Islands() {
		for tier, n := range islandPopulation(is, c) {
			pop[tier] += n
		}
	}
	return pop
}

// unlockStatus evaluates the unlock conditions of a tier over the whole
// archipelago (MECHANICS §12): population of earlier tiers and buildings
// (D-056 dropped the never-met goods_delivered condition).
type unlockStatus struct {
	population map[string][2]Qty // tier -> {have, need} in milli-residents
	buildings  map[string]bool
	met        bool
}

func evaluateTier(w *World, c *content.Catalogue, t *content.Tier, pop map[string]Qty) unlockStatus {
	st := unlockStatus{population: map[string][2]Qty{}, buildings: map[string]bool{}, met: true}
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
	for _, is := range w.Islands() {
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
		w.Away.TiersUnlocked = append(w.Away.TiersUnlocked, unlocked...)
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
