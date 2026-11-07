package plan

import (
	"github.com/ricoberger/new-shores/server/internal/content"
	"github.com/ricoberger/new-shores/server/internal/layout"
	"github.com/ricoberger/new-shores/server/internal/sim"
	"github.com/ricoberger/new-shores/server/internal/sim/scenario"
)

// collectorsReach is the Plan.Collectors mode in which the generator
// keeps every production building within a collector's reach and under
// its throughput (D-069): before a producer is placed where no collector
// reaches it, or where the collector it would deliver to would exceed its
// throughput at the producers' nominal rates, a warehouse is placed next
// to its site first.
const collectorsReach = "reach"

// collectorsUpgrade is collectorsReach preferring to raise a collector's
// level over placing a warehouse (reachByUpgrade).
const collectorsUpgrade = "reach_upgrade"

// loadSlack (percent of its throughput) is the nominal load a collector
// may carry before the generator adds a warehouse. Producers rarely all
// run at their nominal rate, but near the Trading Post they do: at 130 %
// the Citizens game's Trading Post ran at 103 % (throttled).
const loadSlack = 100

// warehouseType is the collector the generator places.
const warehouseType = "warehouse"

// collectorFor returns the collector a producer at the footprint would
// deliver to — the nearest (Euclidean, ties lowest ID) collector whose
// reach covers it, the generator's stand-in for the nearest by road —
// or nil.
func (g *gen) collectorFor(is *sim.Island, x, y, w, h int) *sim.Building {
	var best *sim.Building
	bestD := 0
	for _, b := range is.Buildings {
		def := g.c.BuildingByID[b.Type]
		if def == nil || !def.Collector() {
			continue
		}
		d := footprintDist2(def, b, x, y, w, h)
		if r := def.ReachAt(b.Level); r > 0 && d > r*r {
			continue
		}
		if best == nil || d < bestD {
			best, bestD = b, d
		}
	}
	return best
}

// footprintDist2 is the squared Euclidean distance between the nearest
// tiles of b's footprint and the footprint [x, x+w) x [y, y+h) (tile
// centres), as the sim measures a service radius (MECHANICS §6).
func footprintDist2(def *content.Building, b *sim.Building, x, y, w, h int) int {
	bw, bh := layout.Dims(def, b.Rotation)
	dx := max(b.X-(x+w-1), 0, x-(b.X+bw-1))
	dy := max(b.Y-(y+h-1), 0, y-(b.Y+bh-1))
	return dx*dx + dy*dy
}

// nominalRate is a producer's output (milli-units per minute) at full
// rate: the sum of its outputs per cycle.
func nominalRate(def *content.Building) int64 {
	if def.Recipe == nil || def.Recipe.CycleMs <= 0 {
		return 0
	}
	var sum int64
	for _, o := range def.Recipe.Outputs {
		sum += int64(o.Amount)
	}
	return sum * 60_000 / def.Recipe.CycleMs
}

// collectorLoads sums the nominal rates of the island's producers per
// collector they deliver to: the sim's assignment (nearest by road; a new
// warehouse takes over the producers nearer to it), else collectorFor.
func (g *gen) collectorLoads(is *sim.Island) map[int64]int64 {
	loads := map[int64]int64{}
	for _, b := range is.Buildings {
		bd := g.c.BuildingByID[b.Type]
		if bd == nil || bd.Recipe == nil {
			continue
		}
		if b.AssignedWarehouseID != 0 {
			loads[b.AssignedWarehouseID] += nominalRate(bd)
			continue
		}
		bw, bh := layout.Dims(bd, b.Rotation)
		if c := g.collectorFor(is, b.X, b.Y, bw, bh); c != nil {
			loads[c.ID] += nominalRate(bd)
		}
	}
	return loads
}

// needsCollector reports whether a producer of def at site s needs a new
// warehouse: no collector reaches it, or the one it would deliver to
// would exceed its throughput (loads: collectorLoads of the island).
func (g *gen) needsCollector(is *sim.Island, loads map[int64]int64, def *content.Building, s layout.Site) bool {
	w, h := layout.Dims(def, s.Rot)
	col := g.collectorFor(is, s.X, s.Y, w, h)
	if col == nil {
		return true
	}
	cdef := g.c.BuildingByID[col.Type]
	return (loads[col.ID]+nominalRate(def))*100 > int64(cdef.ThroughputAt(col.Level))*loadSlack
}

// collectedSite finds a site for a producer that a collector with spare
// throughput reaches, for the first choice s (with its fields) that has
// none: another site near the anchor a collector serves; else a
// warehouse within reach of s, then the producer's site again; else a
// warehouse as near to s as there is room and a site it serves.
func (g *gen) collectedSite(island string, def *content.Building, anchor sim.Pos, spare bool, s layout.Site, path, fields []sim.Pos) (layout.Site, []sim.Pos, []sim.Pos, bool, error) {
	w, h := layout.Dims(def, s.Rot)
	is := g.world().Island(island)
	var loads map[int64]int64
	served := func(d *content.Building, ss layout.Site) bool {
		return d.ID != def.ID || !g.needsCollector(is, loads, def, ss)
	}
	reaches := func(d *content.Building, ws layout.Site) bool {
		ww, wh := layout.Dims(d, ws.Rot)
		r := d.ReachAt(1)
		return rectDist2(ws.X, ws.Y, ww, wh, s.X, s.Y, w, h) <= r*r
	}
	again := func() (layout.Site, []sim.Pos, []sim.Pos, bool) {
		is = g.world().Island(island)
		loads = g.collectorLoads(is)
		g.siteFilter = served
		defer func() { g.siteFilter = nil }()
		return g.site(g.planner(island, spare), island, def, anchor, spare)
	}
	if s2, path, f2, ok := again(); ok {
		return s2, path, f2, true, nil
	}
	// A farm's fields need the grass a warehouse would take: raise a
	// collector's level first (reach and throughput grow, no land).
	if def.Fields != nil || g.collectors == collectorsUpgrade {
		if up, err := g.reachByUpgrade(island, s, w, h); err != nil || up {
			return s, path, fields, up, err
		}
	}
	placed, err := g.placeCollector(island, def, s, path, fields, reaches)
	if err != nil {
		return s, nil, nil, false, err
	}
	if !placed {
		if up, err := g.reachByUpgrade(island, s, w, h); err != nil || up {
			return s, path, fields, up, err
		}
		// No room for a warehouse within reach: the first choice, beyond
		// reach or over throughput (the scenario shows it).
		g.logf("collector: no warehouse site within reach of %s at (%d,%d)", def.ID, s.X, s.Y)
		return s, nil, nil, false, nil
	}
	if s2, path, f2, ok := again(); ok {
		return s2, path, f2, true, nil
	}
	// The warehouse kept the first choice free (footprint, road, fields)
	// and reaches it.
	return s, path, fields, true, nil
}

// collectAfter gives a producer placed beyond every collector's reach a
// warehouse after all: one its own road now reaches (before the producer
// stood there, no road came near enough), else a collector upgrade.
func (g *gen) collectAfter(island string, def *content.Building, s layout.Site) error {
	w, h := layout.Dims(def, s.Rot)
	if g.collectorFor(g.world().Island(island), s.X, s.Y, w, h) != nil {
		return nil
	}
	reaches := func(d *content.Building, ws layout.Site) bool {
		ww, wh := layout.Dims(d, ws.Rot)
		r := d.ReachAt(1)
		return rectDist2(ws.X, ws.Y, ww, wh, s.X, s.Y, w, h) <= r*r
	}
	placed, err := g.placeCollector(island, def, s, nil, nil, reaches)
	if err != nil || placed {
		return err
	}
	up, err := g.reachByUpgrade(island, s, w, h)
	if err == nil && !up {
		g.logf("collector: %s at (%d,%d) stays beyond reach", def.ID, s.X, s.Y)
	}
	return err
}

// relieve gives a placed producer a warehouse of its own when the sim
// assigned it another collector (nearest by road) than the one
// collectorFor predicted (predicted: its ID, the generator's stand-in)
// and that collector now carries more than its throughput: the new
// warehouse, next to the producer, takes over the producers nearer to it.
func (g *gen) relieve(island string, def *content.Building, s layout.Site, id, predicted int64) error {
	is := g.world().Island(island)
	b := is.Building(id)
	if b == nil || b.AssignedWarehouseID == 0 || b.AssignedWarehouseID == predicted {
		return nil
	}
	col := is.Building(b.AssignedWarehouseID)
	if col == nil {
		return nil
	}
	cdef := g.c.BuildingByID[col.Type]
	if g.collectorLoads(is)[col.ID]*100 <= int64(cdef.ThroughputAt(col.Level))*loadSlack {
		return nil
	}
	w, h := layout.Dims(def, s.Rot)
	// Next to the producer, so that the road to it is shorter than the
	// one to the overloaded collector.
	near := func(d *content.Building, ws layout.Site) bool {
		ww, wh := layout.Dims(d, ws.Rot)
		return rectDist2(ws.X, ws.Y, ww, wh, s.X, s.Y, w, h) <= relieveDist*relieveDist
	}
	g.logf("collector: %s at (%d,%d) overloads %s %d", def.ID, s.X, s.Y, col.Type, col.ID)
	placed, err := g.placeCollector(island, def, s, nil, nil, near)
	if err != nil || placed {
		return err
	}
	if g.collectors == collectorsUpgrade {
		_, err = g.reachByUpgrade(island, s, w, h)
	}
	return err
}

// relieveDist (tiles) is the farthest a relieving warehouse stands from
// the producer it relieves.
const relieveDist = 6

// reachByUpgrade upgrades the nearest collector whose next level (its
// tier unlocked) reaches the footprint at s and reports whether it did.
func (g *gen) reachByUpgrade(island string, s layout.Site, w, h int) (bool, error) {
	is := g.world().Island(island)
	var best *sim.Building
	var bestDef *content.Building
	bestD := 0
	for _, b := range is.Buildings {
		def := g.c.BuildingByID[b.Type]
		if def == nil || !def.Collector() {
			continue
		}
		next := max(b.Level, 1) + 1
		if next > def.LevelCount() {
			continue
		}
		if t := def.LevelTier(next); t != "" && !sim.TierUnlocked(g.world(), g.c, t) {
			continue
		}
		d := footprintDist2(def, b, s.X, s.Y, w, h)
		if r := def.ReachAt(next); r <= 0 || d > r*r {
			continue
		}
		if !g.obtainable(is, def.LevelCost(next)) {
			continue
		}
		if best == nil || d < bestD {
			best, bestDef, bestD = b, def, d
		}
	}
	if best == nil {
		return false, nil
	}
	at := &scenario.At{Island: island, X: best.X, Y: best.Y}
	st := scenario.Step{UpgradeWarehouse: at}
	if bestDef.TradingPost != nil {
		st = scenario.Step{UpgradeTradingPost: at}
	}
	g.logf("collector: upgrade %s at (%d,%d) to level %d for reach", bestDef.ID, best.X, best.Y, max(best.Level, 1)+1)
	return true, g.do(st, "upgrade "+bestDef.ID+" for reach")
}

// obtainable reports whether the island can pay a cost's materials in
// time: each is in stock or produced there (D-074: the opening has no
// stone, so a level-2 collector waits for a quarry; a warehouse is placed
// instead of waiting).
func (g *gen) obtainable(is *sim.Island, cost *content.Cost) bool {
	if cost == nil {
		return true
	}
	for _, m := range cost.Materials {
		if is.Inventory.Stock[m.Good] > 0 {
			continue
		}
		made := false
		for _, b := range is.Buildings {
			if bd := g.c.BuildingByID[b.Type]; bd != nil && bd.Recipe != nil {
				for _, o := range bd.Recipe.Outputs {
					made = made || o.Good == m.Good
				}
			}
		}
		if !made {
			return false
		}
	}
	return true
}

// placeCollector places a warehouse as near as possible to a producer's
// planned site (its footprint, road and fields stay free; filter, when
// set, accepts the warehouse sites) and reports whether one was placed.
func (g *gen) placeCollector(island string, def *content.Building, s layout.Site, path, fields []sim.Pos, filter func(*content.Building, layout.Site) bool) (bool, error) {
	wdef := g.c.BuildingByID[warehouseType]
	if wdef == nil {
		return false, nil
	}
	is := g.world().Island(island)
	cl := g.cellsOf(is)
	w, h := layout.Dims(def, s.Rot)
	var held []int
	hold := func(x, y int) {
		if i := y*cl.w + x; cl.kind[i] == cellFree {
			cl.kind[i] = cellPlot
			held = append(held, i)
		}
	}
	for ty := s.Y; ty < s.Y+h; ty++ {
		for tx := s.X; tx < s.X+w; tx++ {
			hold(tx, ty)
		}
	}
	fw, fh := 1, 1
	if def.Fields != nil {
		if fd := g.c.FieldByType[def.Fields.Type]; fd != nil {
			fw, fh = fd.Width, fd.Height
		}
	}
	for _, f := range fields {
		for ty := f.Y; ty < f.Y+fh; ty++ {
			for tx := f.X; tx < f.X+fw; tx++ {
				if is.InBounds(tx, ty) {
					hold(tx, ty)
				}
			}
		}
	}
	for _, p := range path {
		hold(p.X, p.Y)
	}
	g.siteFilter = filter
	defer func() {
		g.siteFilter = nil
		for _, i := range held {
			cl.kind[i] = cellFree
		}
	}()
	anchor := sim.Pos{X: s.X + w/2, Y: s.Y + h/2}
	// Like every building without fields: forest first, grass is the farms' land.
	for _, spare := range []bool{false, true} {
		lp := g.planner(island, spare)
		ws, path, _, ok := g.site(lp, island, wdef, anchor, spare)
		if !ok {
			continue
		}
		for _, i := range held {
			cl.kind[i] = cellFree
		}
		held = nil
		ww, wh := layout.Dims(wdef, ws.Rot)
		g.logf("collector: warehouse at (%d,%d) for %s at (%d,%d), %d tiles apart", ws.X, ws.Y, def.ID, s.X, s.Y, isqrt(rectDist2(ws.X, ws.Y, ww, wh, s.X, s.Y, w, h)))
		_, err := g.place(island, warehouseType, ws, path, nil)
		return err == nil, err
	}
	return false, nil
}

func rectDist2(ax, ay, aw, ah, bx, by, bw, bh int) int {
	dx := max(ax-(bx+bw-1), 0, bx-(ax+aw-1))
	dy := max(ay-(by+bh-1), 0, by-(ay+ah-1))
	return dx*dx + dy*dy
}

func isqrt(v int) int {
	r := 0
	for (r+1)*(r+1) <= v {
		r++
	}
	return r
}
