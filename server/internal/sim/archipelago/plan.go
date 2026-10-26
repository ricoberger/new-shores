package archipelago

import (
	"errors"
	"slices"

	"github.com/ricoberger/new-shores/server/internal/content"
)

// plan is the composition of one archipelago before any shape exists:
// the size class, fertilities and deposit slots of every island.
type plan struct {
	class       *content.SizeClass
	home        bool
	fertilities []string
	// deposits lists the kind of every deposit slot.
	deposits []string
}

var errPlan = errors.New("no resource assignment")

// planComposition draws the island counts per size class and assigns the
// fertility and deposit pools to the islands within every range. The
// first island of the home size class is the home candidate and gets the
// home rule's deposits and one of its fertilities first. It fails (and
// the caller retries with another sub-seed) when a random choice leaves
// the pools unassignable.
func planComposition(r *rng, rules *content.IslandRules) ([]*plan, error) {
	var out []*plan
	for _, sc := range rules.SizeClasses {
		n := r.between(sc.Count.Min, sc.Count.Max)
		for range n {
			out = append(out, &plan{class: sc})
		}
	}
	home := slices.IndexFunc(out, func(p *plan) bool { return p.class.ID == rules.Home.SizeClass })
	if home < 0 {
		return nil, errPlan
	}
	out[home].home = true
	if err := assignDeposits(r, rules, out); err != nil {
		return nil, err
	}
	if err := assignFertilities(r, rules, out); err != nil {
		return nil, err
	}
	return out, nil
}

// distribute splits total over len(ranges) counters within their ranges
// (starting at the minimums, adding one to a random counter with room at a
// time). ok is false when total lies outside the summed ranges.
func distribute(r *rng, total int, ranges []content.Range) ([]int, bool) {
	out := make([]int, len(ranges))
	sum := 0
	for i, rg := range ranges {
		out[i] = rg.Min
		sum += rg.Min
	}
	for sum < total {
		var room []int
		for i, rg := range ranges {
			if out[i] < rg.Max {
				room = append(room, i)
			}
		}
		if len(room) == 0 {
			return nil, false
		}
		out[room[r.intn(len(room))]]++
		sum++
	}
	return out, sum == total
}

// total draws the number of assigned items: uniform in the intersection of
// the islands' summed range and the pool's summed range.
func total(r *rng, islands, pool []content.Range) (int, bool) {
	lo, hi := 0, 0
	plo, phi := 0, 0
	for _, rg := range islands {
		lo += rg.Min
		hi += rg.Max
	}
	for _, rg := range pool {
		plo += rg.Min
		phi += rg.Max
	}
	lo, hi = max(lo, plo), min(hi, phi)
	if hi < lo {
		return 0, false
	}
	return r.between(lo, hi), true
}

func poolRanges(pool []content.PoolEntry) []content.Range {
	out := make([]content.Range, len(pool))
	for i, e := range pool {
		out[i] = e.Count
	}
	return out
}

func assignDeposits(r *rng, rules *content.IslandRules, islands []*plan) error {
	ranges := make([]content.Range, len(islands))
	for i, p := range islands {
		ranges[i] = p.class.Deposits
		if p.home {
			ranges[i].Min = max(ranges[i].Min, len(rules.Home.Deposits))
		}
	}
	pr := poolRanges(rules.Deposits)
	n, ok := total(r, ranges, pr)
	if !ok {
		return errPlan
	}
	perIsland, ok1 := distribute(r, n, ranges)
	perKind, ok2 := distribute(r, n, pr)
	if !ok1 || !ok2 {
		return errPlan
	}
	left := map[string]int{}
	for i, e := range rules.Deposits {
		left[e.ID] = perKind[i]
	}
	take := func(p *plan, kind string) {
		p.deposits = append(p.deposits, kind)
		left[kind]--
	}
	// The home candidate first: its required kinds, then any kind it may
	// carry.
	for i, p := range islands {
		if !p.home {
			continue
		}
		for _, kind := range rules.Home.Deposits {
			if left[kind] < 1 {
				return errPlan
			}
			take(p, kind)
		}
		for len(p.deposits) < perIsland[i] {
			var allowed []string
			for _, e := range rules.Deposits {
				if left[e.ID] > 0 && !slices.Contains(rules.Home.DepositsNone, e.ID) {
					allowed = append(allowed, e.ID)
				}
			}
			if len(allowed) == 0 {
				return errPlan
			}
			take(p, allowed[r.intn(len(allowed))])
		}
	}
	var bag []string
	for _, e := range rules.Deposits {
		for range left[e.ID] {
			bag = append(bag, e.ID)
		}
	}
	r.shuffle(len(bag), func(i, j int) { bag[i], bag[j] = bag[j], bag[i] })
	k := 0
	for i, p := range islands {
		if p.home {
			continue
		}
		for range perIsland[i] {
			take(p, bag[k])
			k++
		}
		slices.Sort(p.deposits)
	}
	slices.Sort(islands[slices.IndexFunc(islands, func(p *plan) bool { return p.home })].deposits)
	return nil
}

// assignFertilities gives every island its number of distinct tags: the
// home candidate first (one of fertilities_any, never an excluded one),
// then the islands with the most tags first, each taking the tags with the
// most remaining uses (random tie-break), the greedy order that succeeds
// whenever an assignment exists (Gale-Ryser).
func assignFertilities(r *rng, rules *content.IslandRules, islands []*plan) error {
	ranges := make([]content.Range, len(islands))
	for i, p := range islands {
		ranges[i] = p.class.Fertilities
	}
	pr := poolRanges(rules.Fertilities)
	n, ok := total(r, ranges, pr)
	if !ok {
		return errPlan
	}
	perIsland, ok1 := distribute(r, n, ranges)
	perTag, ok2 := distribute(r, n, pr)
	if !ok1 || !ok2 {
		return errPlan
	}
	left := map[string]int{}
	for i, e := range rules.Fertilities {
		left[e.ID] = perTag[i]
	}
	h := rules.Home
	order := make([]int, len(islands))
	for i := range order {
		order[i] = i
	}
	r.shuffle(len(order), func(i, j int) { order[i], order[j] = order[j], order[i] })
	slices.SortStableFunc(order, func(a, b int) int {
		if islands[a].home != islands[b].home {
			if islands[a].home {
				return -1
			}
			return 1
		}
		return perIsland[b] - perIsland[a]
	})
	for _, i := range order {
		p := islands[i]
		want := perIsland[i]
		if want == 0 {
			continue
		}
		if p.home && len(h.FertilitiesAny) > 0 {
			var options []string
			for _, f := range h.FertilitiesAny {
				if left[f] > 0 && !slices.Contains(h.FertilitiesNone, f) {
					options = append(options, f)
				}
			}
			if len(options) == 0 {
				return errPlan
			}
			f := options[r.intn(len(options))]
			p.fertilities = append(p.fertilities, f)
			left[f]--
		}
		for len(p.fertilities) < want {
			var cands []string
			for _, e := range rules.Fertilities {
				if left[e.ID] > 0 && !slices.Contains(p.fertilities, e.ID) && (!p.home || !slices.Contains(h.FertilitiesNone, e.ID)) {
					cands = append(cands, e.ID)
				}
			}
			if len(cands) == 0 {
				return errPlan
			}
			r.shuffle(len(cands), func(a, b int) { cands[a], cands[b] = cands[b], cands[a] })
			slices.SortStableFunc(cands, func(a, b string) int { return left[b] - left[a] })
			p.fertilities = append(p.fertilities, cands[0])
			left[cands[0]]--
		}
	}
	for _, p := range islands {
		// Pool order (content order), so the display is stable.
		slices.SortFunc(p.fertilities, func(a, b string) int {
			return poolIndex(rules.Fertilities, a) - poolIndex(rules.Fertilities, b)
		})
	}
	return nil
}

func poolIndex(pool []content.PoolEntry, id string) int {
	return slices.IndexFunc(pool, func(e content.PoolEntry) bool { return e.ID == id })
}
