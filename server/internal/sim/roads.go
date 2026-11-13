package sim

import (
	"slices"

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
//     to the lowest warehouse ID. A production building is only assignable
//     to a collector whose reach at its level covers the building's
//     footprint (never its fields): Euclidean distance between the nearest
//     footprint tiles, like a service radius (D-069, MECHANICS §5). A
//     producer road-connected only to collectors out of reach gets no
//     assignment and is marked OutOfReach (it stalls).
//   - transfer delay = transfer_base + sum of seconds_per_tile of every road
//     tile on the path.
//   - Public buildings (service block), shipyards and houses are connected
//     by the same rule; they get AssignedWarehouseID (connection only, no
//     transfers). A shipyard orders ships only while connected.
//     Building needs require connected public buildings and houses
//     (MECHANICS §6.2); unconnected houses receive no goods (MECHANICS §2).

const unreachable = -1

// roadField holds a collector's road distances per road tile (the index
// in roadNet.tiles).
type roadField struct {
	dist  []int32 // tiles on path, unreachable when not reachable
	delay []int64 // summed per-tile ms along the path
}

// roadNet is the island's road graph, built once per
// recomputeConnectivity: every collector's field then holds the road
// tiles only, not the whole island grid.
type roadNet struct {
	tiles []int      // the road tiles (island tile index), ascending
	ms    []int64    // per road tile: ms per tile of its road type
	nb    [][4]int32 // per road tile: its road neighbours, unreachable for none
}

func newRoadNet(is *Island, c *content.Catalogue) *roadNet {
	n := &roadNet{tiles: make([]int, 0, len(is.Roads))}
	size := is.Width * is.Height
	for i, rt := range is.Roads {
		if rt != "" && i >= 0 && i < size {
			n.tiles = append(n.tiles, i)
		}
	}
	slices.Sort(n.tiles)
	n.ms = make([]int64, len(n.tiles))
	n.nb = make([][4]int32, len(n.tiles))
	// The neighbours in one sweep: left and right are the adjacent
	// entries, up and down two pointers that only move forward.
	up, down := 0, 0
	for k, i := range n.tiles {
		n.ms[k] = roadMs(c, is.Roads[i])
		n.nb[k] = [4]int32{unreachable, unreachable, unreachable, unreachable} // neighbours() order
		x := i % is.Width
		for up < len(n.tiles) && n.tiles[up] < i-is.Width {
			up++
		}
		if i-is.Width >= 0 && up < len(n.tiles) && n.tiles[up] == i-is.Width {
			n.nb[k][0] = int32(up) // #nosec G115 -- tiles << 2^31
		}
		if x < is.Width-1 && k+1 < len(n.tiles) && n.tiles[k+1] == i+1 {
			n.nb[k][1] = int32(k + 1) // #nosec G115 -- tiles << 2^31
		}
		for down < len(n.tiles) && n.tiles[down] < i+is.Width {
			down++
		}
		if i+is.Width < size && down < len(n.tiles) && n.tiles[down] == i+is.Width {
			n.nb[k][2] = int32(down) // #nosec G115 -- tiles << 2^31
		}
		if x > 0 && k > 0 && n.tiles[k-1] == i-1 {
			n.nb[k][3] = int32(k - 1) // #nosec G115 -- tiles << 2^31
		}
	}
	return n
}

// at returns the road index of island tile i (unreachable: no road).
func (n *roadNet) at(i int) int {
	if k, ok := slices.BinarySearch(n.tiles, i); ok {
		return k
	}
	return unreachable
}

func roadMs(c *content.Catalogue, roadType string) int64 {
	if def := c.BuildingByID[roadType]; def != nil && def.Road != nil {
		return def.Road.MsPerTile
	}
	return 0
}

// warehouseField runs a breadth-first search over road tiles starting from
// the road tiles adjacent to the warehouse footprint (layer by layer; the
// result does not depend on the order within a layer).
func warehouseField(is *Island, net *roadNet, start []Pos) roadField {
	n := len(net.tiles)
	f := roadField{dist: make([]int32, n), delay: make([]int64, n)}
	for i := range f.dist {
		f.dist[i] = unreachable
	}
	var layer, next []int32
	for _, p := range start {
		i := net.at(is.index(p.X, p.Y))
		if f.dist[i] == unreachable {
			f.dist[i] = 1
			f.delay[i] = net.ms[i]
			layer = append(layer, int32(i)) // #nosec G115 -- tiles << 2^31
		}
	}
	for d := int32(1); len(layer) > 0; d++ {
		next = next[:0]
		for _, i := range layer {
			for _, j := range net.nb[i] {
				if j == unreachable {
					continue
				}
				delay := f.delay[i] + net.ms[j]
				switch {
				case f.dist[j] == unreachable:
					f.dist[j] = d + 1
					f.delay[j] = delay
					next = append(next, j)
				case f.dist[j] == d+1 && delay < f.delay[j]:
					f.delay[j] = delay
				}
			}
		}
		layer, next = next, layer
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
		b     *Building
		def   *content.Building
		field roadField
	}
	var whs []wh
	var net *roadNet
	var at []int // per building: the road index of every adjacent road tile
	for _, b := range is.Buildings {
		def := c.BuildingByID[b.Type]
		if def == nil || !def.Collector() {
			continue
		}
		if net == nil {
			net = newRoadNet(is, c)
		}
		start := is.buildingRoads(def, b)
		whs = append(whs, wh{id: b.ID, b: b, def: def, field: warehouseField(is, net, start)})
	}

	for _, b := range is.Buildings {
		def := c.BuildingByID[b.Type]
		if def == nil || (def.Recipe == nil && def.Service == nil && def.House == nil && def.Shipyard == nil) {
			continue
		}
		b.AssignedWarehouseID, b.RoadDistance, b.TransferDelayMs, b.OutOfReach = 0, 0, 0, false
		adj := is.buildingRoads(def, b)
		at = at[:0]
		if net != nil {
			for _, p := range adj {
				at = append(at, net.at(is.index(p.X, p.Y)))
			}
		}
		bestDist := unreachable
		var bestDelay int64
		fw, fh := footprint(def, b.Rotation)
		roadOnly := false       // connected by road to a collector out of reach
		for _, w := range whs { // ascending ID: strict < keeps the lowest ID on ties
			d, delay := unreachable, int64(0)
			for _, i := range at {
				fd := int(w.field.dist[i])
				if fd == unreachable {
					continue
				}
				if d == unreachable || fd < d || (fd == d && w.field.delay[i] < delay) {
					d, delay = fd, w.field.delay[i]
				}
			}
			if d != unreachable && def.Recipe != nil {
				if r := w.def.ReachAt(w.b.Level); r > 0 && !withinRadius(w.def, w.b, b.X, b.Y, fw, fh, r) {
					roadOnly = true
					continue
				}
			}
			if d != unreachable && (bestDist == unreachable || d < bestDist) {
				bestDist, bestDelay = d, delay
				b.AssignedWarehouseID = w.id
			}
		}
		b.OutOfReach = roadOnly && b.AssignedWarehouseID == 0
		if b.AssignedWarehouseID != 0 && def.Recipe != nil {
			b.RoadDistance = bestDist
			// At least 1 ms so that new output never arrives within the step
			// in which it is produced.
			b.TransferDelayMs = max(c.Region.Rules.TransferBaseMs+bestDelay, 1)
		}
	}
}
