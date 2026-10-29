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
//
// Deposits are assigned per tier (depositTiers): the kinds of the first
// tier that mines anything with r, interleaved with the fertilities as
// before; the kinds of every later tier afterwards, each tier with its own
// stream late(k) (k = 1 for the second mining tier, …), appended to the
// islands' slots (addDeposits). Adding a later tier's deposits to the
// content therefore leaves the earlier composition, shapes and slots of
// every seed as they were (D-056 C3: the tier-3 clay, salt and coal; C4:
// the tier-4 quartz, copper and gold).
func planComposition(r *rng, late func(k int) *rng, c *content.Catalogue) ([]*plan, error) {
	rules := &c.Islands
	var out []*plan
	for _, sc := range rules.SizeClasses {
		if sc.Scenic {
			continue // skerries come after the layout (skerries)
		}
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
	tiers := depositTiers(c)
	if err := assignDeposits(r, rules, tiers[0], out); err != nil {
		return nil, err
	}
	if err := assignFertilities(r, rules, out); err != nil {
		return nil, err
	}
	for k, pool := range tiers[1:] {
		if err := addDeposits(late(k+1), rules, pool, out); err != nil {
			return nil, err
		}
	}
	return out, nil
}

// depositTiers splits the deposit pool (in pool order) by the tier that
// first uses a kind: the lowest tier of a building requiring it (a kind no
// building requires counts to the first group). Groups are in tier order;
// the first is never empty unless the pool is.
func depositTiers(c *content.Catalogue) [][]content.PoolEntry {
	tierOf := func(kind string) int {
		best := -1
		for _, b := range c.Buildings {
			if b.RequiresDeposit != kind {
				continue
			}
			if t := c.TierByID[b.Tier]; t != nil && (best < 0 || t.Index < best) {
				best = t.Index
			}
		}
		return best
	}
	byTier := map[int][]content.PoolEntry{}
	var order []int
	for _, e := range c.Islands.Deposits {
		t := tierOf(e.ID)
		if _, ok := byTier[t]; !ok {
			order = append(order, t)
		}
		byTier[t] = append(byTier[t], e)
	}
	slices.Sort(order)
	if len(order) > 1 && order[0] < 0 {
		// Kinds without a building join the first tier that mines.
		byTier[order[1]] = append(byTier[order[0]], byTier[order[1]]...)
		order = order[1:]
	}
	out := [][]content.PoolEntry{nil}
	for i, t := range order {
		if i == 0 {
			out[0] = byTier[t]
			continue
		}
		out = append(out, byTier[t])
	}
	return out
}

// addDeposits assigns the deposit kinds of a later tier (pool): a total
// within the pool's summed range and the islands' remaining room, split
// per kind within its range; the home rule's kinds of the pool go to the
// home candidate, every other slot to a random habitable island (not a
// rock) with room that may carry the kind. The new slots are appended to
// each island's slots (sorted among themselves), after the earlier tiers'.
func addDeposits(r *rng, rules *content.IslandRules, pool []content.PoolEntry, islands []*plan) error {
	room := func(p *plan) int { return p.class.Deposits.Max - len(p.deposits) }
	capacity := 0
	for _, p := range islands {
		if !p.class.Rock {
			capacity += max(0, room(p))
		}
	}
	pr := poolRanges(pool)
	n, ok := total(r, []content.Range{{Min: 0, Max: capacity}}, pr)
	if !ok {
		return errPlan
	}
	perKind, ok := distribute(r, n, pr)
	if !ok {
		return errPlan
	}
	added := make([][]string, len(islands))
	put := func(i int, kind string) {
		islands[i].deposits = append(islands[i].deposits, kind)
		added[i] = append(added[i], kind)
	}
	var bag []string
	for k, e := range pool {
		left := perKind[k]
		if slices.Contains(rules.Home.Deposits, e.ID) {
			home := slices.IndexFunc(islands, func(p *plan) bool { return p.home })
			if left < 1 || room(islands[home]) < 1 {
				return errPlan
			}
			put(home, e.ID)
			left--
		}
		for range left {
			bag = append(bag, e.ID)
		}
	}
	r.shuffle(len(bag), func(i, j int) { bag[i], bag[j] = bag[j], bag[i] })
	for _, kind := range bag {
		var cands []int
		for i, p := range islands {
			if p.class.Rock || room(p) < 1 || (p.home && slices.Contains(rules.Home.DepositsNone, kind)) {
				continue
			}
			cands = append(cands, i)
		}
		if len(cands) == 0 {
			return errPlan
		}
		put(cands[r.intn(len(cands))], kind)
	}
	for i, p := range islands {
		if len(added[i]) > 1 {
			// Only the slots added here are sorted: the earlier ones keep their places.
			slices.Sort(p.deposits[len(p.deposits)-len(added[i]):])
		}
	}
	return nil
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

// assignDeposits assigns the first tier's deposit kinds (pool) over the
// islands within their slot ranges: the home rule's kinds and then any
// allowed kind to the home candidate, a shuffled bag to the others.
func assignDeposits(r *rng, rules *content.IslandRules, pool []content.PoolEntry, islands []*plan) error {
	var homeKinds []string
	for _, kind := range rules.Home.Deposits {
		if slices.ContainsFunc(pool, func(e content.PoolEntry) bool { return e.ID == kind }) {
			homeKinds = append(homeKinds, kind)
		}
	}
	ranges := make([]content.Range, len(islands))
	for i, p := range islands {
		ranges[i] = p.class.Deposits
		if p.home {
			ranges[i].Min = max(ranges[i].Min, len(homeKinds))
		}
	}
	pr := poolRanges(pool)
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
	for i, e := range pool {
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
		for _, kind := range homeKinds {
			if left[kind] < 1 {
				return errPlan
			}
			take(p, kind)
		}
		for len(p.deposits) < perIsland[i] {
			var allowed []string
			for _, e := range pool {
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
	for _, e := range pool {
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
