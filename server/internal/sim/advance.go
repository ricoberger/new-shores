package sim

import (
	"fmt"
	"math"
	"time"

	"github.com/ricoberger/new-shores/server/internal/content"
)

// Boundary kinds reported by Advance.
const (
	// BoundaryStockEmpty: a good's stock can no longer cover its net drain;
	// its consumers become input-starved.
	BoundaryStockEmpty = "stock_empty"
	// BoundaryCapacityReached: stock plus in-transit of a good reaches the
	// capacity; its producers stop (warehouse full).
	BoundaryCapacityReached = "capacity_reached"
	// BoundaryBufferFull: an unconnected producer's buffer is full.
	BoundaryBufferFull = "buffer_full"
	// BoundaryTransfer: a delivery starts or stops arriving (the arrival
	// rate of a good changes).
	BoundaryTransfer = "transfer"
	// BoundaryCoarseMode: the iteration cap was reached; the rest of the
	// advancement uses coarse steps.
	BoundaryCoarseMode = "coarse_mode"
	// BoundaryResidents: a house accumulator reaches +/-1 resident (or 0 at
	// a residents bound).
	BoundaryResidents = "residents"
	// BoundaryGoldZero: gold can no longer cover one millisecond of the
	// negative balance; buildings are auto-paused.
	BoundaryGoldZero = "gold_zero"
	// BoundaryAutoPause: a building was paused for insolvency (island and
	// building set).
	BoundaryAutoPause = "auto_pause"
	// BoundaryAutoResume: an unpaid building was resumed (island and
	// building set).
	BoundaryAutoResume = "auto_resume"
	// BoundaryGoldReserve: gold reaches the auto-resume reserve of the next
	// unpaid building (island and building of the candidate set); settle
	// re-evaluates the resume.
	BoundaryGoldReserve = "gold_reserve"
	// BoundaryGoldTrialReserve: gold reaches the trial reserve of the next
	// unpaid building or ship whose recomputed balance is negative (island
	// and building or ship of the candidate set); settle trial-resumes it
	// (an auto_resume boundary with Trial set).
	BoundaryGoldTrialReserve = "gold_trial_reserve"
	// BoundaryTierUnlocked: a tier's unlock conditions hold.
	BoundaryTierUnlocked = "tier_unlocked"
	// BoundaryStockThreshold: the stock of a good reaches the threshold of
	// an active quest's stock objective (quest, good and island, if the
	// objective names one, set); settle re-evaluates the quests.
	BoundaryStockThreshold = "stock_threshold"
	// BoundaryQuestCompleted: a quest's objectives hold (quest set).
	BoundaryQuestCompleted = "quest_completed"
)

// maxStepMs bounds the length of a single linear step so that rate*duration
// products stay far from int64 overflow. Splitting a step is invisible in the
// result (Advance is composable) and is not reported as a boundary.
const maxStepMs = 24 * 60 * 60 * 1000

// Boundary is a point in time where the rates of a world change.
type Boundary struct {
	At         time.Time `json:"at"`
	Kind       string    `json:"kind"`
	IslandID   string    `json:"island_id,omitempty"`
	BuildingID int64     `json:"building_id,omitempty"`
	ShipID     int64     `json:"ship_id,omitempty"`
	Good       string    `json:"good,omitempty"`
	Tier       string    `json:"tier,omitempty"`
	Quest      string    `json:"quest,omitempty"`
	// Trial marks an auto_resume by the trial reserve (rule (c)): the
	// resumed building runs although the recomputed balance is negative.
	Trial bool `json:"trial,omitempty"`
}

// Advance moves the world forward to time to (truncated to milliseconds)
// using the piecewise-constant-rate model of MECHANICS §1.1 and returns the
// boundaries that were crossed, including the discrete events applied at
// them (auto_pause, auto_resume, tier_unlocked). Due moments (ship_built,
// ship_arrived) are boundaries whose effect is applied at exactly their
// millisecond, including at to. Gold accrues from taxes and upkeep.
// Advancing to LastEvaluatedAt is a no-op; an earlier time is an error.
func Advance(w *World, c *content.Catalogue, to time.Time) ([]Boundary, error) {
	return AdvanceWithLedger(w, c, to, nil)
}

// AdvanceWithLedger is Advance that records goods movements in l (may be nil).
func AdvanceWithLedger(w *World, c *content.Catalogue, to time.Time, l *Ledger) ([]Boundary, error) {
	to = truncMs(to)
	if to.After(w.LastEvaluatedAt) {
		// Every advancement feeds the away summary accumulator, whoever
		// triggers it; the caller's ledger receives the same records.
		outer, inner := l, NewLedger()
		defer func() {
			w.Away.addLedger(inner)
			outer.merge(inner)
		}()
		l = inner
	}
	if to.Before(w.LastEvaluatedAt) {
		return nil, fmt.Errorf("%w: %s < %s", ErrTimeBackwards, to.Format(time.RFC3339Nano), w.LastEvaluatedAt.Format(time.RFC3339Nano))
	}
	if to.Equal(w.LastEvaluatedAt) {
		return nil, nil
	}

	now, end := w.LastEvaluatedAt.UnixMilli(), to.UnixMilli()
	rules := c.Region.Rules
	var out []Boundary
	count, coarse := 0, false
	for now < end {
		if !coarse && count >= rules.IterationCap {
			coarse = true
			out = append(out, Boundary{At: time.UnixMilli(now).UTC(), Kind: BoundaryCoarseMode})
		}
		wr, events := settleWorldLedger(w, c, now, l)
		out = append(out, events...)
		if coarse {
			// Coarse steps still stop at due moments so that their effects
			// apply at exactly their millisecond.
			dt := min(rules.CoarseStepMs, end-now)
			if due := nextDue(w, now); due < now+dt {
				dt = due - now
			}
			for i, is := range w.Islands {
				step(is, c, wr.islands[i], now, dt, true, l)
			}
			stepWorld(w, wr, dt)
			now += dt
			continue
		}

		at, cands := nextBoundary(w, c, wr, now)
		stepEnd := min(at, end, now+maxStepMs)
		for i, is := range w.Islands {
			step(is, c, wr.islands[i], now, stepEnd-now, false, l)
		}
		stepWorld(w, wr, stepEnd-now)
		if at == stepEnd {
			count++
			out = append(out, cands...)
		}
		now = stepEnd
	}
	_, events := settleWorldLedger(w, c, now, l)
	out = append(out, events...)
	w.LastEvaluatedAt = to
	return out, nil
}

// nextDue returns the earliest due moment strictly after now
// (math.MaxInt64 if none).
func nextDue(w *World, now int64) int64 {
	best := int64(math.MaxInt64)
	for _, e := range dueList(w) {
		if e.atMs > now {
			best = min(best, e.atMs)
		}
	}
	return best
}

// ceilDiv returns ceil(a/b) for a >= 0 and b > 0.
func ceilDiv(a, b int64) int64 { return (a + b - 1) / b }

// nextBoundary returns the earliest boundary strictly after now (math.MaxInt64
// if there is none) and the boundaries occurring at that time.
func nextBoundary(w *World, c *content.Catalogue, wr *worldRates, now int64) (int64, []Boundary) {
	best := int64(math.MaxInt64)
	var list []Boundary
	consider := func(t int64, b Boundary) {
		// Settled regimes guarantee t > now; the clamp only protects the loop
		// against a non-converged settle.
		t = max(t, now+1)
		switch {
		case t < best:
			best = t
			list = list[:0]
			fallthrough
		case t == best:
			for _, x := range list {
				if x.Kind == b.Kind && x.IslandID == b.IslandID && x.BuildingID == b.BuildingID && x.ShipID == b.ShipID && x.Good == b.Good && x.Quest == b.Quest {
					return
				}
			}
			b.At = time.UnixMilli(t).UTC()
			list = append(list, b)
		}
	}

	for i, is := range w.Islands {
		r := wr.islands[i]
		inv := &is.Inventory
		capFine := capacityFine(is, c)
		for _, good := range sortedKeys(r.cons, r.prod, r.inflow) {
			if !inv.Starved[good] {
				if drain := r.cons[good] - r.inflow[good]; drain > 0 {
					consider(now+inv.fine(good)/drain, Boundary{Kind: BoundaryStockEmpty, IslandID: is.ID, Good: good})
				}
			}
			if !inv.Full[good] {
				if growth := r.prod[good] - r.cons[good]; growth > 0 {
					consider(now+(capFine-committedFine(is, good, now))/growth, Boundary{Kind: BoundaryCapacityReached, IslandID: is.ID, Good: good})
				}
			}
		}
		bufCap := c.Region.Rules.UnconnectedBuffer * SubPerMilli
		for _, p := range r.producers {
			if p.connected || p.rate == 0 {
				continue
			}
			for _, out := range p.def.Recipe.Outputs {
				space := bufCap - p.b.bufferFine(out.Good)
				consider(now+space/(p.rate*out.Amount), Boundary{Kind: BoundaryBufferFull, IslandID: is.ID, BuildingID: p.b.ID, Good: out.Good})
			}
		}
		// Transfers. A connected producer that keeps producing at the rate of
		// its latest segment extends that segment seamlessly (continuation);
		// otherwise its new output starts arriving after the transfer delay,
		// which changes the arrival rate.
		extended := map[*TransitSegment]bool{}
		for _, p := range r.producers {
			if !p.connected || p.rate == 0 {
				continue
			}
			for _, out := range p.def.Recipe.Outputs {
				if s := continuation(p.b, out.Good, now, p.rate*out.Amount); s != nil {
					extended[s] = true
					continue
				}
				consider(now+p.b.TransferDelayMs, Boundary{Kind: BoundaryTransfer, IslandID: is.ID, BuildingID: p.b.ID, Good: out.Good})
			}
		}
		for _, b := range is.Buildings {
			for i := range b.Transit {
				s := &b.Transit[i]
				if s.FromMs > now {
					consider(s.FromMs, Boundary{Kind: BoundaryTransfer, IslandID: is.ID, BuildingID: b.ID, Good: s.Good})
				}
				if s.ToMs > now && !extended[s] {
					consider(s.ToMs, Boundary{Kind: BoundaryTransfer, IslandID: is.ID, BuildingID: b.ID, Good: s.Good})
				}
			}
		}
		// Residents: the accumulator reaches +/-1 resident, or 0 when the
		// house is at the bound it moves towards.
		for _, h := range r.houses {
			g, a, hs := h.growth, h.b.House.Growth, h.b.House
			var dist int64
			switch {
			case g > 0 && hs.Residents < h.tier.ResidentsMax:
				dist = ceilDiv(ResidentSub-a, g)
			case g > 0:
				dist = ceilDiv(-a, g)
			case g < 0 && hs.Residents > h.tier.ResidentsFloor:
				dist = ceilDiv(a+ResidentSub, -g)
			case g < 0:
				dist = ceilDiv(a, -g)
			default:
				continue
			}
			consider(now+dist, Boundary{Kind: BoundaryResidents, IslandID: is.ID, BuildingID: h.b.ID})
		}
	}

	// Gold: the balance can no longer be covered for one more millisecond,
	// or gold reaches the resume threshold of the next unpaid building.
	gold := w.goldFine()
	if wr.goldRate < 0 {
		consider(now+gold/-wr.goldRate, Boundary{Kind: BoundaryGoldZero})
	}
	// Gold reaches the reserve of the eligible resume candidate. If gold
	// already covers it (only for a building paused at this very
	// millisecond), the resume happens at the next millisecond.
	if p := wr.resumable; p.valid() && wr.balance > 0 {
		thr := resumeThreshold(c, p.upkeep(c))
		consider(now+ceilDiv(max(thr-gold, 0), wr.balance), p.boundary(BoundaryGoldReserve, time.Time{}))
	} else if p.valid() && gold >= resumeThreshold(c, p.upkeep(c)) {
		consider(now+1, p.boundary(BoundaryGoldReserve, time.Time{}))
	}
	// Gold reaches the trial reserve of a candidate whose recomputed
	// balance is negative (rule (c)); same scheduling as the reserve.
	if p := wr.trial; p.valid() && wr.balance > 0 {
		thr := trialThreshold(c, p.upkeep(c))
		consider(now+ceilDiv(max(thr-gold, 0), wr.balance), p.boundary(BoundaryGoldTrialReserve, time.Time{}))
	} else if p.valid() && gold >= trialThreshold(c, p.upkeep(c)) {
		consider(now+1, p.boundary(BoundaryGoldTrialReserve, time.Time{}))
	}

	// Due moments: shipyard orders complete, ships arrive and berths are
	// granted.
	for _, e := range dueList(w) {
		if e.atMs > now {
			consider(e.atMs, Boundary{Kind: e.Kind, IslandID: e.IslandID, BuildingID: e.BuildingID, ShipID: e.ShipID})
		}
	}
	// Quest stock thresholds.
	questStockBoundary(w, c, wr, now, consider)
	return best, list
}

// step advances one island linearly by dt milliseconds at the given rates.
// In coarse mode, consumption is first limited to what is available during
// the step, and quantities above capacity are clamped and recorded as lost.
func step(is *Island, c *content.Catalogue, r *rates, now, dt int64, coarse bool, l *Ledger) {
	end := now + dt
	inv := &is.Inventory

	if coarse {
		limitToAvailable(is, r, dt, arrivalsDuring(is, now, end))
	}

	delta := map[string]int64{}
	bufCap := c.Region.Rules.UnconnectedBuffer * SubPerMilli
	for _, p := range r.producers {
		if p.rate == 0 {
			continue
		}
		b := p.b
		b.Progress = (b.Progress + p.rate*dt) % SubPerMilli
		for _, out := range p.def.Recipe.Outputs {
			rate := p.rate * out.Amount
			amount := rate * dt
			if p.connected {
				// The output stream of a connected producer leaves at its
				// current rate. Goods still held in its buffer (from a time
				// without road connection) leave first; new production only
				// fills the remainder. Only producers without inputs ever
				// hold a buffer, so no inputs are involved.
				fromBuffer := min(amount, b.bufferFine(out.Good))
				if fromBuffer > 0 {
					b.setBufferFine(out.Good, b.bufferFine(out.Good)-fromBuffer)
				}
				l.flow(is.ID, out.Good).Produced += amount - fromBuffer
				appendTransit(b, out.Good, now+b.TransferDelayMs, end+b.TransferDelayMs, rate)
				continue
			}
			l.flow(is.ID, out.Good).Produced += amount
			buf := b.bufferFine(out.Good) + amount
			if buf > bufCap {
				l.flow(is.ID, out.Good).Lost += buf - bufCap
				buf = bufCap
			}
			b.setBufferFine(out.Good, buf)
		}
		if p.connected {
			for _, in := range p.in {
				amount := p.rate * in.Amount * dt
				delta[in.Good] -= amount
				l.flow(is.ID, in.Good).Consumed += amount
			}
		}
	}

	for good, rate := range r.houseCons {
		amount := rate * dt
		delta[good] -= amount
		l.flow(is.ID, good).Consumed += amount
	}

	// Arrivals are computed after the new output was appended, so that a
	// continuing transit segment delivers during the whole step.
	for g, a := range arrivalsDuring(is, now, end) {
		delta[g] += a
	}

	capFine := capacityFine(is, c)
	for _, good := range sortedKeys(delta) {
		v := inv.fine(good) + delta[good]
		if v < 0 {
			// Not reachable in exact mode; in coarse mode consumption is
			// limited beforehand. Treat as unconsumed to keep the ledger exact.
			l.flow(is.ID, good).Consumed += v
			v = 0
		}
		if v > capFine {
			l.flow(is.ID, good).Lost += v - capFine
			v = capFine
		}
		inv.setFine(good, v)
	}

	for _, b := range is.Buildings {
		if len(b.Transit) == 0 {
			continue
		}
		kept := b.Transit[:0]
		for _, s := range b.Transit {
			if s.ToMs > end {
				kept = append(kept, s)
			}
		}
		if len(kept) == 0 {
			kept = nil
		}
		b.Transit = kept
	}
}

// arrivalsDuring returns the amount per good arriving from transit during
// [now, end).
func arrivalsDuring(is *Island, now, end int64) map[string]int64 {
	arrivals := map[string]int64{}
	for _, b := range is.Buildings {
		for _, s := range b.Transit {
			if from, to := max(s.FromMs, now), min(s.ToMs, end); to > from {
				arrivals[s.Good] += s.RateSub * (to - from)
			}
		}
	}
	return arrivals
}

// continuation returns the latest transit segment of good if production at
// rate (sub-milli per ms) starting at now extends it without a gap, else nil.
func continuation(b *Building, good string, now, rate int64) *TransitSegment {
	for i := len(b.Transit) - 1; i >= 0; i-- {
		s := &b.Transit[i]
		if s.Good != good {
			continue
		}
		if s.ToMs == now+b.TransferDelayMs && s.RateSub == rate {
			return s
		}
		return nil
	}
	return nil
}

// limitToAvailable scales consumers down (coarse mode only) so that the
// consumption of every good during the step does not exceed its stock plus
// its arrivals during the step.
func limitToAvailable(is *Island, r *rates, dt int64, arrivals map[string]int64) {
	for _, good := range sortedKeys(r.cons) {
		need := r.cons[good] * dt
		avail := is.Inventory.fine(good) + arrivals[good]
		if need <= avail {
			continue
		}
		var cons int64
		for _, p := range r.producers {
			if !p.connected {
				continue
			}
			if a := p.inputAmount(good); a > 0 {
				p.rate = mulDiv(p.rate, max(avail, 0), need)
			}
			cons += p.rate * p.inputAmount(good)
		}
		if h := r.houseCons[good]; h > 0 {
			r.houseCons[good] = mulDiv(h, max(avail, 0), need)
			cons += r.houseCons[good]
		}
		r.cons[good] = cons
	}
}

// appendTransit records output produced during [from-delay, to-delay) as a
// transit segment arriving during [from, to). Contiguous segments with the
// same rate are merged so that the representation does not depend on how an
// advancement was split.
func appendTransit(b *Building, good string, from, to, rate int64) {
	for i := len(b.Transit) - 1; i >= 0; i-- {
		s := &b.Transit[i]
		if s.Good != good {
			continue
		}
		if s.ToMs == from && s.RateSub == rate {
			s.ToMs = to
			return
		}
		break
	}
	b.Transit = append(b.Transit, TransitSegment{Good: good, FromMs: from, ToMs: to, RateSub: rate})
}
