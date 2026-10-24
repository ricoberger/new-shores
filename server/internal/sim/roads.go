package sim

import (
	"github.com/ricoberger/new-shores/server/internal/content"
)

// Road connectivity (refining MECHANICS §3, D-042):
//
//   - The road distance d between a building and a warehouse is the number
//     of road tiles on the shortest 4-connected road path that starts on a
//     road tile adjacent to the building's footprint and ends on a road tile
//     adjacent to the warehouse's footprint, counting both end tiles. When
//     one road tile touches both footprints, d = 1.
//   - Among paths of equal length the one with the lowest summed per-tile
//     transfer time is used (relevant once several road types exist).
//   - The building is assigned to the warehouse with the smallest d; ties go
//     to the lowest warehouse ID.
//   - transfer delay = transfer_base + sum of seconds_per_tile of every road
//     tile on the path.
//   - Public buildings (service block), shipyards and houses are connected
//     by the same rule; they get AssignedWarehouseID (connection only, no
//     transfers). A shipyard orders ships only while connected.
//     Building needs require connected public buildings and houses
//     (MECHANICS §6.2); unconnected houses receive no goods (MECHANICS §2).

const unreachable = -1

type roadField struct {
	dist  []int   // tiles on path, unreachable when not reachable
	delay []int64 // summed per-tile ms along the path
}

func roadMs(c *content.Catalogue, roadType string) int64 {
	if def := c.BuildingByID[roadType]; def != nil && def.Road != nil {
		return def.Road.MsPerTile
	}
	return 0
}

// warehouseField runs a breadth-first search over road tiles starting from
// the road tiles adjacent to the warehouse footprint.
func warehouseField(is *Island, c *content.Catalogue, start []Pos) roadField {
	n := is.Width * is.Height
	f := roadField{dist: make([]int, n), delay: make([]int64, n)}
	for i := range f.dist {
		f.dist[i] = unreachable
	}
	var layer []Pos
	for _, p := range start {
		i := is.index(p.X, p.Y)
		if f.dist[i] == unreachable {
			f.dist[i] = 1
			f.delay[i] = roadMs(c, is.Roads[i])
			layer = append(layer, p)
		}
	}
	for d := 1; len(layer) > 0; d++ {
		var next []Pos
		for _, p := range layer {
			i := is.index(p.X, p.Y)
			for _, nb := range neighbours() {
				q := Pos{p.X + nb.X, p.Y + nb.Y}
				rt := is.RoadAt(q.X, q.Y)
				if rt == "" {
					continue
				}
				j := is.index(q.X, q.Y)
				delay := f.delay[i] + roadMs(c, rt)
				switch {
				case f.dist[j] == unreachable:
					f.dist[j] = d + 1
					f.delay[j] = delay
					next = append(next, q)
				case f.dist[j] == d+1 && delay < f.delay[j]:
					f.delay[j] = delay
				}
			}
		}
		layer = next
	}
	return f
}

// recomputeConnectivity assigns every producer, public building and house to
// its nearest connected warehouse and updates the road distance and transfer
// delay of producers. The buffer of a producer that becomes connected is not touched here: it leaves with the
// producer's output stream during Advance (see step), so it is subject to
// throughput and the warehouse-full rule and is never lost.
func recomputeConnectivity(is *Island, c *content.Catalogue) {
	type wh struct {
		id    int64
		field roadField
	}
	var whs []wh
	for _, b := range is.Buildings {
		def := c.BuildingByID[b.Type]
		if def == nil || !def.Collector() {
			continue
		}
		start := is.buildingRoads(def, b)
		whs = append(whs, wh{id: b.ID, field: warehouseField(is, c, start)})
	}

	for _, b := range is.Buildings {
		def := c.BuildingByID[b.Type]
		if def == nil || (def.Recipe == nil && def.Service == nil && def.House == nil && def.Shipyard == nil) {
			continue
		}
		b.AssignedWarehouseID, b.RoadDistance, b.TransferDelayMs = 0, 0, 0
		adj := is.buildingRoads(def, b)
		bestDist := unreachable
		var bestDelay int64
		for _, w := range whs { // ascending ID: strict < keeps the lowest ID on ties
			d, delay := unreachable, int64(0)
			for _, p := range adj {
				i := is.index(p.X, p.Y)
				fd := w.field.dist[i]
				if fd == unreachable {
					continue
				}
				if d == unreachable || fd < d || (fd == d && w.field.delay[i] < delay) {
					d, delay = fd, w.field.delay[i]
				}
			}
			if d != unreachable && (bestDist == unreachable || d < bestDist) {
				bestDist, bestDelay = d, delay
				b.AssignedWarehouseID = w.id
			}
		}
		if b.AssignedWarehouseID != 0 && def.Recipe != nil {
			b.RoadDistance = bestDist
			// At least 1 ms so that new output never arrives within the step
			// in which it is produced.
			b.TransferDelayMs = max(c.Region.Rules.TransferBaseMs+bestDelay, 1)
		}
	}
}
