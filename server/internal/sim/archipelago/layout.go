package archipelago

import (
	"errors"
	"slices"

	"github.com/ricoberger/new-shores/server/internal/content"
	"github.com/ricoberger/new-shores/server/internal/sim"
)

// Gap2 returns the Euclidean gap in tiles between the grids of two islands,
// squared (0 when they touch or overlap).
func Gap2(a, b *sim.Island) int {
	dx := max(0, a.X-(b.X+b.Width), b.X-(a.X+a.Width))
	dy := max(0, a.Y-(b.Y+b.Height), b.Y-(a.Y+a.Height))
	return dx*dx + dy*dy
}

// layoutTries bounds the candidate positions per island.
const layoutTries = 400

// layout places the islands (the largest first) one by one next to a
// random placed anchor: every candidate keeps the minimum gap to all
// placed islands and is within the nearest-neighbour maximum of its
// anchor, so every island has a neighbour in reach; of up to eight valid
// candidates the one closest to the current centre wins (a compact
// archipelago). Positions are then shifted so the bounds start at (0, 0).
func layout(r *rng, islands []*sim.Island, rules *content.IslandRules) error {
	order := make([]int, len(islands))
	for i := range order {
		order[i] = i
	}
	slices.SortStableFunc(order, func(a, b int) int { return islands[b].Width*islands[b].Height - islands[a].Width*islands[a].Height })
	minGap, maxGap := rules.SpacingMin, rules.NearestMax
	reach := (minGap + maxGap) / 2
	var placed []*sim.Island
	for _, i := range order {
		is := islands[i]
		if len(placed) == 0 {
			is.X, is.Y = 0, 0
			placed = append(placed, is)
			continue
		}
		cx, cy := centre(placed)
		found := false
		bestX, bestY, bestD := 0, 0, 0
		valid := 0
		for range layoutTries {
			if valid >= 8 {
				break
			}
			a := placed[r.intn(len(placed))]
			is.X = r.between(a.X-is.Width-reach, a.X+a.Width+reach)
			is.Y = r.between(a.Y-is.Height-reach, a.Y+a.Height+reach)
			g := Gap2(is, a)
			if g < minGap*minGap || g > maxGap*maxGap {
				continue
			}
			ok := true
			for _, o := range placed {
				if Gap2(is, o) < minGap*minGap {
					ok = false
					break
				}
			}
			if !ok {
				continue
			}
			valid++
			dx, dy := 2*is.X+is.Width-2*cx, 2*is.Y+is.Height-2*cy
			if d := dx*dx + dy*dy; !found || d < bestD {
				found, bestX, bestY, bestD = true, is.X, is.Y, d
			}
		}
		if !found {
			return errors.New("no position for an island")
		}
		is.X, is.Y = bestX, bestY
		placed = append(placed, is)
	}
	minX, minY, _, _ := Bounds(islands)
	for _, is := range islands {
		is.X -= minX
		is.Y -= minY
	}
	return nil
}

// Bounds returns the bounding box of the islands' grids: [minX, maxX) x
// [minY, maxY).
func Bounds(islands []*sim.Island) (minX, minY, maxX, maxY int) {
	for i, is := range islands {
		if i == 0 {
			minX, minY, maxX, maxY = is.X, is.Y, is.X+is.Width, is.Y+is.Height
			continue
		}
		minX, minY = min(minX, is.X), min(minY, is.Y)
		maxX, maxY = max(maxX, is.X+is.Width), max(maxY, is.Y+is.Height)
	}
	return
}

func centre(islands []*sim.Island) (int, int) {
	minX, minY, maxX, maxY := Bounds(islands)
	return (minX + maxX) / 2, (minY + maxY) / 2
}

// AtSea reports whether p is at least ShipClearance tiles (Euclidean,
// tile to tile) from every land tile of the archipelago.
func AtSea(islands []*sim.Island, p sim.Pos) bool {
	const c = ShipClearance
	for _, is := range islands {
		if p.X < is.X-c || p.X >= is.X+is.Width+c || p.Y < is.Y-c || p.Y >= is.Y+is.Height+c {
			continue
		}
		for ty := max(0, p.Y-is.Y-c); ty <= min(is.Height-1, p.Y-is.Y+c); ty++ {
			for tx := max(0, p.X-is.X-c); tx <= min(is.Width-1, p.X-is.X+c); tx++ {
				if is.Tile(tx, ty).Terrain == content.TerrainWater {
					continue
				}
				dx, dy := is.X+tx-p.X, is.Y+ty-p.Y
				if dx*dx+dy*dy < c*c {
					return false
				}
			}
		}
	}
	return true
}

// spawn returns the sea tile closest to the archipelago's centre
// (Euclidean; ties by ring order) that is at least ShipClearance from
// land.
func spawn(islands []*sim.Island) (sim.Pos, bool) {
	cx, cy := centre(islands)
	minX, minY, maxX, maxY := Bounds(islands)
	limit := max(maxX-minX, maxY-minY)
	var best sim.Pos
	bestD := -1
	for ring := 0; ring <= limit; ring++ {
		// Once a candidate is found, rings farther than its distance
		// cannot hold a closer tile.
		if bestD >= 0 && ring*ring > bestD {
			break
		}
		for dy := -ring; dy <= ring; dy++ {
			for dx := -ring; dx <= ring; dx++ {
				if max(abs(dx), abs(dy)) != ring {
					continue
				}
				p := sim.Pos{X: cx + dx, Y: cy + dy}
				d := dx*dx + dy*dy
				if (bestD < 0 || d < bestD) && AtSea(islands, p) {
					best, bestD = p, d
				}
			}
		}
	}
	return best, bestD >= 0
}
