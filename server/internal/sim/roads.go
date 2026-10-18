package sim

import (
	"github.com/ricoberger/new-shores/server/internal/content"
)

// Road connectivity (refining MECHANICS §3):
//
//   - The road distance d between a producer and a warehouse is the number of
//     road tiles on the shortest 4-connected road path that starts on a road
//     tile adjacent to the producer's entrance and ends on a road tile
//     adjacent to the warehouse's entrance, counting both end tiles. When one
//     road tile touches both entrances, d = 1.
//   - Among paths of equal length the one with the lowest summed per-tile
//     transfer time is used (relevant once several road types exist).
//   - The producer is assigned to the warehouse with the smallest d; ties go
//     to the lowest warehouse ID.
//   - transfer delay = transfer_base + sum of seconds_per_tile of every road
//     tile on the path.

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
// the road tiles adjacent to the warehouse entrance.
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

// recomputeConnectivity assigns every producer to its nearest connected
// warehouse and updates road distance and transfer delay. Producers that
// become connected deliver their unconnected buffer immediately (up to the
// free committed capacity; the rest is lost and recorded in the ledger).
func recomputeConnectivity(is *Island, c *content.Catalogue, l *Ledger, now int64) {
	type wh struct {
		id    int64
		field roadField
	}
	var whs []wh
	for _, b := range is.Buildings {
		def := c.BuildingByID[b.Type]
		if def == nil || def.Warehouse == nil {
			continue
		}
		start := is.roadsAt(entrance(def, b.X, b.Y, b.Rotation))
		whs = append(whs, wh{id: b.ID, field: warehouseField(is, c, start)})
	}

	for _, b := range is.Buildings {
		def := c.BuildingByID[b.Type]
		if def == nil || def.Recipe == nil {
			continue
		}
		wasConnected := b.AssignedWarehouseID != 0
		b.AssignedWarehouseID, b.RoadDistance, b.TransferDelayMs = 0, 0, 0
		adj := is.roadsAt(entrance(def, b.X, b.Y, b.Rotation))
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
		if b.AssignedWarehouseID != 0 {
			b.RoadDistance = bestDist
			// At least 1 ms so that new output never arrives within the step
			// in which it is produced.
			b.TransferDelayMs = max(c.Region.Rules.TransferBaseMs+bestDelay, 1)
			if !wasConnected {
				deliverBuffer(is, c, b, l, now)
			}
		}
	}
}

// deliverBuffer moves the unconnected buffer of a producer into the island
// inventory, limited by the free committed capacity; any excess is lost.
func deliverBuffer(is *Island, c *content.Catalogue, b *Building, l *Ledger, now int64) {
	for _, good := range sortedKeys(b.Buffer, b.BufferSub) {
		amount := b.bufferFine(good)
		free := capacityFine(is, c) - committedFine(is, good, now)
		take := max(min(amount, free), 0)
		is.Inventory.setFine(good, is.Inventory.fine(good)+take)
		l.flow(is.ID, good).Lost += amount - take
		b.setBufferFine(good, 0)
	}
}
