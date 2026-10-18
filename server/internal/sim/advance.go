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
	Good       string    `json:"good,omitempty"`
}

// Advance moves the world forward to time to (truncated to milliseconds)
// using the piecewise-constant-rate model of MECHANICS §1.1 and returns the
// boundaries that were crossed. It never changes gold in this slice.
// Advancing to LastEvaluatedAt is a no-op; an earlier time is an error.
func Advance(w *World, c *content.Catalogue, to time.Time) ([]Boundary, error) {
	return AdvanceWithLedger(w, c, to, nil)
}

// AdvanceWithLedger is Advance that records goods movements in l (may be nil).
func AdvanceWithLedger(w *World, c *content.Catalogue, to time.Time, l *Ledger) ([]Boundary, error) {
	to = truncMs(to)
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
	rs := make([]*rates, len(w.Islands))
	for now < end {
		if !coarse && count >= rules.IterationCap {
			coarse = true
			out = append(out, Boundary{At: time.UnixMilli(now).UTC(), Kind: BoundaryCoarseMode})
		}
		for i, is := range w.Islands {
			rs[i] = settle(is, c, now)
		}
		if coarse {
			dt := min(rules.CoarseStepMs, end-now)
			for i, is := range w.Islands {
				step(is, c, rs[i], now, dt, true, l)
			}
			now += dt
			continue
		}

		at, cands := nextBoundary(w, c, rs, now)
		stepEnd := min(at, end, now+maxStepMs)
		for i, is := range w.Islands {
			step(is, c, rs[i], now, stepEnd-now, false, l)
		}
		if at == stepEnd {
			count++
			out = append(out, cands...)
		}
		now = stepEnd
	}
	for _, is := range w.Islands {
		settle(is, c, now)
	}
	w.LastEvaluatedAt = to
	return out, nil
}

// nextBoundary returns the earliest boundary strictly after now (math.MaxInt64
// if there is none) and the boundaries occurring at that time.
func nextBoundary(w *World, c *content.Catalogue, rs []*rates, now int64) (int64, []Boundary) {
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
				if x.Kind == b.Kind && x.IslandID == b.IslandID && x.BuildingID == b.BuildingID && x.Good == b.Good {
					return
				}
			}
			b.At = time.UnixMilli(t).UTC()
			list = append(list, b)
		}
	}

	for i, is := range w.Islands {
		r := rs[i]
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
	}
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
			l.flow(is.ID, out.Good).Produced += amount
			if p.connected {
				appendTransit(b, out.Good, now+b.TransferDelayMs, end+b.TransferDelayMs, rate)
				continue
			}
			buf := b.bufferFine(out.Good) + amount
			if buf > bufCap {
				l.flow(is.ID, out.Good).Lost += buf - bufCap
				buf = bufCap
			}
			b.setBufferFine(out.Good, buf)
		}
		if p.connected {
			for _, in := range p.def.Recipe.Inputs {
				amount := p.rate * in.Amount * dt
				delta[in.Good] -= amount
				l.flow(is.ID, in.Good).Consumed += amount
			}
		}
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
