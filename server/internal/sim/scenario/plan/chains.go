package plan

import (
	"fmt"
	"maps"
	"slices"

	"github.com/ricoberger/new-shores/server/internal/layout"
	"github.com/ricoberger/new-shores/server/internal/sim"
)

// Chain plots (D-065): a ranked provider serves every house within its own
// radius, so the chain buildings are reserved by coverage over all
// quarters of an island once their civic plots and house land are
// reserved, not per quarter.
//
// For each chain, from its highest rank down to rank 1: the houses of a
// quarter's served tiers that need at least rank r stand on the
// chainTilesPerHouse tiles per house of its core house land nearest the
// centre (houses fill the land from the centre; upgrades take the houses
// most plots cover). While plots of rank >= r cover less than chainShare
// of that land in some quarter, the rank-r building is reserved at the
// connectable site that adds the most needed coverage over all those
// quarters (among the sites within chainSlack of the best, the one
// covering the most of all served land less its grass tiles). A site may
// take house land, but not the served land, while each quarter can still
// refill its house land from its remaining candidate tiles.

const (
	// chainShare (percent) of the land a rank's houses need must be
	// covered.
	chainShare = 80
	// chainSlack (percent): the sites whose gain is within it of the best
	// prefer the most served land covered less grass tiles.
	chainSlack = 10
	// chainTilesPerHouse is the land a served house takes near the centre:
	// its footprint and its share of the roads.
	chainTilesPerHouse = 14
)

// chainNeed is a quarter's demand on one rank of a chain.
type chainNeed struct {
	q       *quarter
	land    []int
	covered map[int]bool
}

func (cn *chainNeed) short() bool { return len(cn.covered)*100 < len(cn.land)*chainShare }

// reserveChains reserves the chain plots of an island once all its
// quarters are reserved.
func (g *gen) reserveChains(island string) error {
	if g.chains == nil || g.chained[island] {
		return nil
	}
	var qs []*quarter
	for _, q := range g.order {
		if q.spec.Island == island {
			if !q.reserved {
				return nil
			}
			qs = append(qs, q)
		}
	}
	g.chained[island] = true
	is := g.world().Island(island)
	cl := g.cellsOf(is)
	served := map[int]bool{}
	for _, q := range qs {
		total := 0
		for _, n := range q.spec.Serves {
			total += n
		}
		land := q.coreLand(cl)
		for _, t := range land[:min(len(land), total*chainTilesPerHouse)] {
			served[t] = true
		}
	}
	for _, chain := range slices.Sorted(maps.Keys(g.chains.Buildings)) {
		types := g.chains.Buildings[chain]
		for rank := len(types); rank >= 1; rank-- {
			var needs []*chainNeed
			for _, q := range qs {
				n := g.chainHouses(q, chain, rank)
				if n == 0 {
					continue
				}
				land := q.coreLand(cl)
				cn := &chainNeed{q: q, land: land[:min(len(land), n*chainTilesPerHouse)], covered: map[int]bool{}}
				for _, pl := range g.islandPlots(island) {
					if g.rankOf(chain, pl.typ) >= rank {
						g.cover(cn.covered, cn.land, pl.typ, pl.x, pl.y, pl.rot, cl.w)
					}
				}
				needs = append(needs, cn)
			}
			typ := types[rank-1]
			for {
				var open []*chainNeed
				for _, cn := range needs {
					if cn.short() {
						open = append(open, cn)
					}
				}
				if len(open) == 0 {
					break
				}
				pl, err := g.reserveChainPlot(island, typ, open, served)
				if err != nil {
					return fmt.Errorf("%s (rank %d of %s) for %s, %d of %d tiles covered: %w", typ, rank, chain, open[0].q.spec.ID, len(open[0].covered), len(open[0].land), err)
				}
				msg := ""
				for _, cn := range needs {
					before := len(cn.covered)
					g.cover(cn.covered, cn.land, pl.typ, pl.x, pl.y, pl.rot, cl.w)
					if len(cn.covered) == before {
						continue
					}
					key := typ
					for k := 2; cn.q.plots[key] != nil; k++ {
						key = fmt.Sprintf("%s-%d", typ, k)
					}
					cn.q.plots[key] = pl
					msg += fmt.Sprintf(" %s as %s %d/%d", cn.q.spec.ID, key, len(cn.covered), len(cn.land))
				}
				g.logf("chain %s rank %d: %s at (%d,%d) covers%s", chain, rank, typ, pl.x, pl.y, msg)
			}
		}
	}
	for _, q := range qs {
		q.refill(cl)
	}
	return nil
}

// rankOf returns the rank of a building type in a chain (0: not in it).
func (g *gen) rankOf(chain, typ string) int {
	return slices.Index(g.chains.Buildings[chain], typ) + 1
}

// chainHouses counts a quarter's served houses that need at least rank r
// of the chain.
func (g *gen) chainHouses(q *quarter, chain string, r int) int {
	n := 0
	for tier, houses := range q.spec.Serves {
		if g.chains.MinRank[tier][chain] >= r {
			n += houses
		}
	}
	return n
}

// cover marks the tiles of land a plot covers.
func (g *gen) cover(covered map[int]bool, land []int, typ string, x, y, rot, w int) {
	def := g.c.BuildingByID[typ]
	for _, t := range land {
		if !covered[t] && covers(def, x, y, rot, t%w, t/w, 1, 1, 0) {
			covered[t] = true
		}
	}
}

// islandPlots lists the island's reserved plots (each once, in quarter
// order).
func (g *gen) islandPlots(island string) []*plot {
	var out []*plot
	for _, q := range g.order {
		if q.spec.Island != island {
			continue
		}
		for _, k := range slices.Sorted(maps.Keys(q.plots)) {
			if pl := q.plots[k]; !slices.Contains(out, pl) {
				out = append(out, pl)
			}
		}
	}
	return out
}

// reserveChainPlot reserves a plot of typ off the served land where it
// adds the most needed coverage.
func (g *gen) reserveChainPlot(island, typ string, open []*chainNeed, served map[int]bool) (*plot, error) {
	is := g.world().Island(island)
	cl := g.cellsOf(is)
	def := g.c.BuildingByID[typ]
	if def == nil || def.Service == nil {
		return nil, fmt.Errorf("%q is not a public building", typ)
	}
	lp := g.planner(island, false)
	reach := lp.Reachable(island)
	chk := sim.NewSiteChecker(is, g.c)
	// Anchor: the centre of the short quarters, weighed by their shortfall.
	var ax, ay, wsum int
	for _, cn := range open {
		k := len(cn.land) - len(cn.covered)
		ax += cn.q.centre.X * k
		ay += cn.q.centre.Y * k
		wsum += k
	}
	anchor := sim.Pos{X: ax / wsum, Y: ay / wsum}
	far := 0
	for _, cn := range open {
		far = max(far, int(dist(anchor, cn.q.centre)))
	}
	rr := far + def.Service.RadiusAt(1) + 2*max(def.Width, def.Height)
	type cand struct {
		s     layout.Site
		gain  int
		score int // served land covered less grass tiles
	}
	var cands []cand
	for _, s := range layout.Candidates(is, def, anchor) {
		if s.D > 4*rr*rr { // D is the doubled distance, squared
			break
		}
		fw, fh := layout.Dims(def, s.Rot)
		if !cl.plotFree(s.X, s.Y, fw, fh, served) || !layout.Touches(is, reach, s.X, s.Y, fw, fh) || !chk.Valid(def, s.X, s.Y, s.Rot) {
			continue
		}
		n := 0
		for _, cn := range open {
			add := 0
			for _, t := range cn.land {
				if !cn.covered[t] && covers(def, s.X, s.Y, s.Rot, t%cl.w, t/cl.w, 1, 1, 0) {
					add++
				}
			}
			// Only the coverage a quarter still needs counts.
			want := (len(cn.land)*chainShare+99)/100 - len(cn.covered)
			n += min(add, want)
		}
		if n == 0 {
			continue
		}
		wide := 0
		for t := range served {
			if covers(def, s.X, s.Y, s.Rot, t%cl.w, t/cl.w, 1, 1, 0) {
				wide++
			}
		}
		cands = append(cands, cand{s, n, wide - grassTiles(is, s.X, s.Y, fw, fh)})
	}
	if len(cands) == 0 {
		return nil, fmt.Errorf("no site adds coverage near (%d,%d)", anchor.X, anchor.Y)
	}
	slices.SortStableFunc(cands, func(a, b cand) int { return b.gain - a.gain })
	good := cands[0].gain - cands[0].gain*chainSlack/100
	k := 0
	for k < len(cands) && cands[k].gain >= good {
		k++
	}
	slices.SortStableFunc(cands[:k], func(a, b cand) int { return b.score - a.score })
	clp := g.plotPlanner(lp, island)
	for _, cd := range cands {
		s := cd.s
		fw, fh := layout.Dims(def, s.Rot)
		path, ok := clp.RoadPath(island, s.X, s.Y, fw, fh)
		if !ok || g.cutsOff(lp, island, reach, s.X, s.Y, fw, fh) {
			continue
		}
		pl := &plot{typ: typ, x: s.X, y: s.Y, rot: s.Rot, path: path, reach: true}
		for ty := s.Y; ty < s.Y+fh; ty++ {
			for tx := s.X; tx < s.X+fw; tx++ {
				cl.kind[ty*cl.w+tx], cl.owner[ty*cl.w+tx] = cellPlot, open[0].q.index
			}
		}
		for _, t := range path {
			i := t.Y*cl.w + t.X
			if cl.kind[i] == cellFree || cl.kind[i] == cellRegion {
				cl.kind[i] = cellRoad
			}
		}
		return pl, nil
	}
	return nil, fmt.Errorf("no connected site near (%d,%d)", anchor.X, anchor.Y)
}

// unbuiltPlotTiles counts the footprint tiles of the island's plots that
// were never built (only chain buildings with chain).
func (g *gen) unbuiltPlotTiles(island string, chain bool) int {
	n := 0
	for _, pl := range g.islandPlots(island) {
		inChain := false
		if g.chains != nil {
			for c := range g.chains.Buildings {
				inChain = inChain || g.rankOf(c, pl.typ) > 0
			}
		}
		if pl.built == 0 && (!chain || inChain) {
			w, h := layout.Dims(g.c.BuildingByID[pl.typ], pl.rot)
			n += w * h
		}
	}
	return n
}

// checkServes reports a quarter with more houses at or above a tier than
// its serves declares there (the chain plots were reserved for fewer);
// houses still below their final tier count toward the higher ones.
func (g *gen) checkServes() error {
	if g.chains == nil {
		return nil
	}
	for _, q := range g.order {
		is := g.world().Island(q.spec.Island)
		if is == nil {
			continue
		}
		count := map[string]int{}
		for _, id := range q.houses {
			if b := is.Building(id); b != nil {
				if def := g.c.BuildingByID[b.Type]; def != nil && def.House != nil {
					count[def.House.Tier]++
				}
			}
		}
		// From the highest tier down: houses at or above it against the
		// served houses at or above it.
		have, served := 0, 0
		for k := len(g.c.Tiers) - 1; k >= 1; k-- {
			tier := g.c.Tiers[k].ID
			have += count[tier]
			served += q.spec.Serves[tier]
			if have > served {
				return fmt.Errorf("quarter %s has %d houses of tier %s or above, serves %d", q.spec.ID, have, tier, served)
			}
		}
	}
	return nil
}
