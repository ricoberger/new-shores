package sim

import (
	"math/bits"

	"github.com/ricoberger/new-shores/server/internal/content"
)

// Rate model (refining MECHANICS §4 and §5).
//
// Every producer has an integer progress rate rho in progress units per
// millisecond; one cycle at 100 % is SubPerMilli progress units, so the
// nominal rate is SubPerMilli / cycle_ms. A producer with rate rho produces
// rho*amount sub-milli units of each output per millisecond and consumes
// rho*amount of each input, which keeps the recipe ratios exact.
//
// rho is derived in stages, each rounding down:
//
//  1. base = nominal * efficiency / 1000; 0 when paused, when an unconnected
//     producer has inputs (it cannot fetch them) or its buffer is full.
//  2. throughput: per warehouse, R = sum of base output rates of the assigned
//     producers that are running (connected, base > 0, not fully starved, not
//     fully blocked by a full good without any active consumer) and T is the
//     level throughput; if R > T every such producer gets tp = base * T / R.
//  3. starvation: for every good in the starved regime, consumers share the
//     current arrival rate I in proportion to their demand D: cap = tp * I / D
//     when D > I.
//  4. full: for every good in the full regime, its producers are scaled so
//     that their production does not exceed the consumption of the good;
//     repeated until stable because scaling a producer reduces the
//     consumption of its inputs.
//
// Regimes are explicit state (Inventory.Starved/Full) and change only at
// boundaries, which keeps Advance exactly composable; see settle.

// producer is the rate computation of one building with a recipe.
type producer struct {
	b         *Building
	def       *content.Building
	connected bool
	// bufferBlocked is set for an unconnected producer whose buffer is full.
	bufferBlocked bool
	base          int64
	tp            int64
	// throughput is the throughput factor in per-mille.
	throughput int64
	// starveCap/fullCap are the caps per recipe input/output (-1 = none).
	starveCap []int64
	fullCap   []int64
	rate      int64
}

func (p *producer) inputAmount(good string) Qty {
	for _, in := range p.def.Recipe.Inputs {
		if in.Good == good {
			return in.Amount
		}
	}
	return 0
}

func (p *producer) outputAmount(good string) Qty {
	for _, out := range p.def.Recipe.Outputs {
		if out.Good == good {
			return out.Amount
		}
	}
	return 0
}

// capExcept returns min(tp, all caps) ignoring the starvation cap of input
// skipIn and the full cap of output skipOut (-1 = ignore none).
func (p *producer) capExcept(skipIn, skipOut int) int64 {
	r := p.tp
	for i, c := range p.starveCap {
		if i != skipIn && c >= 0 {
			r = min(r, c)
		}
	}
	for i, c := range p.fullCap {
		if i != skipOut && c >= 0 {
			r = min(r, c)
		}
	}
	return r
}

func (p *producer) starveLimited() bool {
	for _, c := range p.starveCap {
		if c >= 0 && c < p.tp {
			return true
		}
	}
	return false
}

type warehouseLoad struct {
	r, t int64 // sub-milli per ms
}

// rates is the result of the rate computation for one island at one time.
type rates struct {
	now       int64
	producers []*producer
	// inflow: arrivals from transit; prod: connected production into
	// transit; cons: consumption from the inventory. All sub-milli per ms.
	inflow map[string]int64
	prod   map[string]int64
	cons   map[string]int64
	loads  map[int64]warehouseLoad
}

// mulDiv returns floor(a*b/c) for non-negative a, b and positive c with
// b <= c, using 128-bit intermediate arithmetic.
func mulDiv(a, b, c int64) int64 {
	if a <= 0 || b <= 0 || c <= 0 {
		return 0
	}
	if b >= c {
		return a // factor >= 1: callers only scale down
	}
	// a, b, c are positive and b < c, so the quotient is < a and fits.
	hi, lo := bits.Mul64(uint64(a), uint64(b)) // #nosec G115 -- a, b > 0
	q, _ := bits.Div64(hi, lo, uint64(c))      // #nosec G115 -- c > b >= 1, hi < c
	return int64(q)                            // #nosec G115 -- q < a <= MaxInt64
}

// nominalRate is the progress rate at 100 % efficiency.
func nominalRate(def *content.Building) int64 {
	return SubPerMilli / def.Recipe.CycleMs
}

func computeRates(is *Island, c *content.Catalogue, now int64) *rates {
	r := &rates{
		now:    now,
		inflow: map[string]int64{},
		prod:   map[string]int64{},
		cons:   map[string]int64{},
		loads:  map[int64]warehouseLoad{},
	}
	for _, b := range is.Buildings {
		for _, s := range b.Transit {
			if s.FromMs <= now && now < s.ToMs {
				r.inflow[s.Good] += s.RateSub
			}
		}
	}

	bufCap := c.Region.Rules.UnconnectedBuffer * SubPerMilli
	for _, b := range is.Buildings {
		def := c.BuildingByID[b.Type]
		if def == nil || def.Recipe == nil {
			continue
		}
		p := &producer{
			b: b, def: def, connected: b.AssignedWarehouseID != 0, throughput: 1000,
			starveCap: fill(len(def.Recipe.Inputs), -1),
			fullCap:   fill(len(def.Recipe.Outputs), -1),
		}
		base := nominalRate(def) * b.Efficiency / 1000
		switch {
		case b.Paused:
			base = 0
		case !p.connected && len(def.Recipe.Inputs) > 0:
			base = 0
		case !p.connected:
			for _, out := range def.Recipe.Outputs {
				if bufCap-b.bufferFine(out.Good) < base*out.Amount {
					p.bufferBlocked = true
					base = 0
				}
			}
		}
		p.base, p.tp = base, base
		r.producers = append(r.producers, p)
	}

	// Throughput sharing per warehouse.
	fullyStarved := func(p *producer) bool {
		for _, in := range p.def.Recipe.Inputs {
			if is.Inventory.Starved[in.Good] && r.inflow[in.Good] == 0 {
				return true
			}
		}
		return false
	}
	activeConsumer := map[string]bool{}
	for _, p := range r.producers {
		if p.connected && p.base > 0 && !fullyStarved(p) {
			for _, in := range p.def.Recipe.Inputs {
				activeConsumer[in.Good] = true
			}
		}
	}
	running := func(p *producer) bool {
		if !p.connected || p.base == 0 || fullyStarved(p) {
			return false
		}
		for _, out := range p.def.Recipe.Outputs {
			if is.Inventory.Full[out.Good] && !activeConsumer[out.Good] {
				return false
			}
		}
		return true
	}
	for _, b := range is.Buildings {
		if def := c.BuildingByID[b.Type]; def != nil && def.Warehouse != nil {
			r.loads[b.ID] = warehouseLoad{t: warehouseLevel(def, b).ThroughputPerMin * SubPerMilli / msPerMinute}
		}
	}
	for _, p := range r.producers {
		if running(p) {
			l := r.loads[p.b.AssignedWarehouseID]
			l.r += p.base * outputSum(p.def)
			r.loads[p.b.AssignedWarehouseID] = l
		}
	}
	for _, p := range r.producers {
		l := r.loads[p.b.AssignedWarehouseID]
		if running(p) && l.r > l.t {
			p.tp = mulDiv(p.base, l.t, l.r)
			p.throughput = l.t * 1000 / l.r
		}
		p.rate = p.tp
	}

	// Starvation: consumers share the arrival rate of a starved good.
	for _, good := range sortedKeys(is.Inventory.Starved) {
		in := r.inflow[good]
		var demand int64
		for _, p := range r.producers {
			if p.connected {
				demand += p.tp * p.inputAmount(good)
			}
		}
		if demand <= in {
			continue
		}
		for _, p := range r.producers {
			if !p.connected {
				continue
			}
			for i, inp := range p.def.Recipe.Inputs {
				if inp.Good == good {
					p.starveCap[i] = mulDiv(p.tp, in, demand)
					p.rate = min(p.rate, p.starveCap[i])
				}
			}
		}
	}

	// Full: producers of a full good are limited to its consumption.
	fullGoods := sortedKeys(is.Inventory.Full)
	for iter := 0; iter < 64 && len(fullGoods) > 0; iter++ {
		changed := false
		for _, good := range fullGoods {
			var prod, cons int64
			for _, p := range r.producers {
				if p.connected {
					prod += p.rate * p.outputAmount(good)
					cons += p.rate * p.inputAmount(good)
				}
			}
			if prod <= cons {
				continue
			}
			for _, p := range r.producers {
				if !p.connected || p.rate == 0 {
					continue
				}
				for i, out := range p.def.Recipe.Outputs {
					if out.Good != good {
						continue
					}
					nc := mulDiv(p.rate, cons, prod)
					if p.fullCap[i] < 0 || nc < p.fullCap[i] {
						p.fullCap[i] = nc
					}
					if nc < p.rate {
						p.rate = nc
						changed = true
					}
				}
			}
		}
		if !changed {
			break
		}
	}
	for _, p := range r.producers {
		if !p.connected {
			continue
		}
		for _, out := range p.def.Recipe.Outputs {
			r.prod[out.Good] += p.rate * out.Amount
		}
		for _, in := range p.def.Recipe.Inputs {
			r.cons[in.Good] += p.rate * in.Amount
		}
	}
	return r
}

func outputSum(def *content.Building) int64 {
	var s int64
	for _, out := range def.Recipe.Outputs {
		s += out.Amount
	}
	return s
}

func fill(n int, v int64) []int64 {
	s := make([]int64, n)
	for i := range s {
		s[i] = v
	}
	return s
}

// settle brings the regimes of the island in line with its state at time
// now and returns the resulting rates:
//
//   - a starved good leaves the regime when its consumers' demand without
//     the starvation cap does not exceed the arrival rate; a full good when
//     its producers' rate without the full cap does not exceed consumption;
//   - a good enters the starved regime when its stock cannot cover one more
//     millisecond of net drain (stock < consumption - arrivals), and the full
//     regime when its free committed capacity cannot absorb one more
//     millisecond of net growth (capacity - stock - in_transit < production
//   - consumption).
//
// Entry conditions are false strictly inside a step (Advance stops at the
// millisecond the condition becomes true) and exit conditions depend only on
// rates, so settling at an arbitrary split time is a no-op; this is what
// makes Advance exactly composable.
func settle(is *Island, c *content.Catalogue, now int64) *rates {
	for range 32 {
		r := computeRates(is, c, now)
		if !updateRegimes(is, c, r, now) {
			return r
		}
	}
	return computeRates(is, c, now)
}

func updateRegimes(is *Island, c *content.Catalogue, r *rates, now int64) bool {
	inv := &is.Inventory
	changed := false
	for _, good := range sortedKeys(inv.Starved) {
		var demand int64
		for _, p := range r.producers {
			if !p.connected {
				continue
			}
			for i, in := range p.def.Recipe.Inputs {
				if in.Good == good {
					demand += p.capExcept(i, -1) * in.Amount
				}
			}
		}
		if demand <= r.inflow[good] {
			delete(inv.Starved, good)
			changed = true
		}
	}
	for _, good := range sortedKeys(inv.Full) {
		var prod int64
		for _, p := range r.producers {
			if !p.connected {
				continue
			}
			for i, out := range p.def.Recipe.Outputs {
				if out.Good == good {
					prod += p.capExcept(-1, i) * out.Amount
				}
			}
		}
		if prod <= r.cons[good] {
			delete(inv.Full, good)
			changed = true
		}
	}
	if len(inv.Starved) == 0 {
		inv.Starved = nil
	}
	if len(inv.Full) == 0 {
		inv.Full = nil
	}
	if changed {
		return true
	}

	capFine := capacityFine(is, c)
	for _, good := range sortedKeys(r.cons, r.prod, r.inflow) {
		if !inv.Starved[good] {
			if drain := r.cons[good] - r.inflow[good]; drain > 0 && drain > inv.fine(good) {
				if inv.Starved == nil {
					inv.Starved = map[string]bool{}
				}
				inv.Starved[good] = true
				changed = true
			}
		}
		if !inv.Full[good] {
			if growth := r.prod[good] - r.cons[good]; growth > 0 && growth > capFine-committedFine(is, good, now) {
				if inv.Full == nil {
					inv.Full = map[string]bool{}
				}
				inv.Full[good] = true
				changed = true
			}
		}
	}
	return changed
}
