package devworld

import (
	"fmt"
	"slices"
	"time"

	"github.com/ricoberger/new-shores/server/internal/content"
	"github.com/ricoberger/new-shores/server/internal/sim"
)

// FixtureHarbourBasin is the harbour basin of D-077 §8: town plus the
// citizens and merchants tiers (granted), a pier of basinQuayTiles quay
// tiles on the home island — a stem from the coast out to basinDepth
// tiles off the land, then an arm along the coast at that distance — and
// a trading pier fully on the water against the pier's head, with a
// harbour tower beside it (D-077 §3), and a 3×3 town square (D-077 §2)
// near the Trading Post: the quay wall and the square's fine cobbles of
// UI.md §3 in one fixture.
const FixtureHarbourBasin = "harbour-basin"

// harbourBasinHistory: the town's history plus a minute for the basin.
const harbourBasinHistory = townHistory + 2*time.Minute

const (
	// basinQuayTiles is the length of the fixture's pier (tiles).
	basinQuayTiles = 60
	// basinDepth is the distance (tiles, Chebyshev) from the land at which
	// the pier's arm runs, inside the shallows band (sim.ShallowsReach).
	basinDepth = 5
	// basinPier is the shore building at the pier's head.
	basinPier = "trading_pier"
	// basinTower watches over the pier's head.
	basinTower = "harbour_tower"
	// basinSquare is the ground paint family of the fixture's town square.
	basinSquare = "square"
	// basinSquareSide is the town square's side (tiles).
	basinSquareSide = 3
)

// harbourBasin builds the fixture's pier and the trading pier at its head.
func harbourBasin(f *fixture) {
	if f.err != nil {
		return
	}
	for _, tier := range []string{citizensTier, merchantsTier} {
		if !slices.Contains(f.w.UnlockedTiers, tier) {
			f.w.UnlockedTiers = append(f.w.UnlockedTiers, tier)
		}
	}
	home := f.home()
	is := f.w.Island(home)
	quay := f.c.BuildingByID["quay"]
	pier := f.c.BuildingByID[basinPier]
	tower := f.c.BuildingByID[basinTower]
	square := f.c.BuildingByID[basinSquare]
	if quay == nil || pier == nil || tower == nil || square == nil {
		f.err = fmt.Errorf("the %s fixture needs quay, %s, %s and %s content", FixtureHarbourBasin, basinPier, basinTower, basinSquare)
		return
	}
	for range basinQuayTiles {
		f.grant(home, &quay.Cost)
	}
	f.grant(home, &pier.Cost)
	f.grant(home, &tower.Cost)
	dist := landDistances(is)
	centre := f.tradingPostCentre(home)
	for _, start := range basinStarts(is, is.Occupancy(f.c), dist, centre) {
		tiles := basinPath(is, dist, start)
		if len(tiles) < basinQuayTiles {
			continue
		}
		backup := f.w
		// A road from the street to the pier's root, then the pier.
		path, ok := f.roadPath(home, start.X, start.Y, 1, 1)
		if !ok || (len(path) > 0 && !f.try(sim.PlaceRoad{IslandID: home, Type: fixtureRoad, Tiles: path})) {
			continue
		}
		if !f.try(sim.PlaceRoad{IslandID: home, Type: quay.ID, Tiles: tiles}) {
			f.w = backup
			continue
		}
		if head := tiles[len(tiles)-1]; f.placeAtHead(home, pier, head) && f.placeAtHead(home, tower, head) {
			f.townSquare(home, square, centre)
			if f.err != nil {
				return
			}
			f.advance(time.Minute)
			return
		}
		f.w = backup
	}
	f.err = fmt.Errorf("no site for the %s fixture's pier on %s", FixtureHarbourBasin, home)
}

// landDistances returns, per island tile, the Chebyshev distance to the
// island's own land (0 on land, ShallowsReach+1 beyond the band).
func landDistances(is *sim.Island) []int {
	far := sim.ShallowsReach + 1
	dist := make([]int, is.Width*is.Height)
	for y := range is.Height {
		for x := range is.Width {
			d := far
			if ownLand(is.Tile(x, y).Terrain) {
				d = 0
			} else {
				for r := 1; r < far && d == far; r++ {
					for ty := y - r; ty <= y+r && d == far; ty++ {
						for tx := x - r; tx <= x+r; tx++ {
							if (ty == y-r || ty == y+r || tx == x-r || tx == x+r) && is.InBounds(tx, ty) && ownLand(is.Tile(tx, ty).Terrain) {
								d = r
								break
							}
						}
					}
				}
			}
			dist[y*is.Width+x] = d
		}
	}
	return dist
}

func ownLand(t string) bool {
	return t != content.TerrainWater && t != content.TerrainRiver && t != content.TerrainIslet
}

// basinStarts lists the free water tiles next to the land (distance 1,
// an edge-adjacent land tile) by distance from the anchor, from 12 tiles
// on (off the Trading Post's own water).
func basinStarts(is *sim.Island, occ []int64, dist []int, anchor sim.Pos) []sim.Pos {
	type cand struct {
		p sim.Pos
		d int
	}
	var out []cand
	for y := range is.Height {
		for x := range is.Width {
			if dist[y*is.Width+x] != 1 || is.RoadAt(x, y) != "" || occ[y*is.Width+x] != 0 {
				continue
			}
			d := (x-anchor.X)*(x-anchor.X) + (y-anchor.Y)*(y-anchor.Y)
			if d < 12*12 {
				continue
			}
			out = append(out, cand{sim.Pos{X: x, Y: y}, d})
		}
	}
	slices.SortStableFunc(out, func(a, b cand) int { return a.d - b.d })
	starts := make([]sim.Pos, 0, len(out))
	for _, c := range out {
		starts = append(starts, c.p)
	}
	return starts
}

// basinPath walks a single-width pier from start: straight away from the
// land up to basinDepth, then along the tiles at that distance (straight
// where it can), until basinQuayTiles tiles or a dead end. A tile of the
// path touches no earlier tile but its predecessor.
func basinPath(is *sim.Island, dist []int, start sim.Pos) []sim.Pos {
	dirs := []sim.Pos{{X: 1}, {X: -1}, {Y: 1}, {Y: -1}}
	at := func(p sim.Pos) int {
		if !is.InBounds(p.X, p.Y) {
			return -1
		}
		return dist[p.Y*is.Width+p.X]
	}
	// Away from the land: the direction whose opposite neighbour is land.
	var out sim.Pos
	found := false
	for _, d := range dirs {
		if at(sim.Pos{X: start.X - d.X, Y: start.Y - d.Y}) == 0 {
			out, found = d, true
			break
		}
	}
	if !found {
		return nil
	}
	path := []sim.Pos{start}
	on := map[sim.Pos]bool{start: true}
	free := func(p sim.Pos, from sim.Pos) bool {
		if !is.InBounds(p.X, p.Y) || on[p] || !sim.Shallow(is, p.X, p.Y) || is.RoadAt(p.X, p.Y) != "" || is.PlannedRoadAt(p.X, p.Y) != "" {
			return false
		}
		for _, d := range dirs {
			n := sim.Pos{X: p.X + d.X, Y: p.Y + d.Y}
			if n != from && on[n] {
				return false
			}
		}
		return true
	}
	cur := start
	for at(cur) < basinDepth {
		next := sim.Pos{X: cur.X + out.X, Y: cur.Y + out.Y}
		if !free(next, cur) {
			return nil
		}
		path = append(path, next)
		on[next] = true
		cur = next
	}
	// Along the coast: keep the heading, else turn; first turn either way
	// (the first that runs on).
	heading := sim.Pos{X: out.Y, Y: out.X}
	for len(path) < basinQuayTiles {
		moved := false
		for _, d := range []sim.Pos{heading, {X: heading.Y, Y: heading.X}, {X: -heading.Y, Y: -heading.X}, {X: -heading.X, Y: -heading.Y}} {
			next := sim.Pos{X: cur.X + d.X, Y: cur.Y + d.Y}
			if at(next) != basinDepth || !free(next, cur) {
				continue
			}
			path = append(path, next)
			on[next] = true
			cur, heading, moved = next, d, true
			break
		}
		if !moved {
			break
		}
	}
	return path
}

// placeAtHead places def fully on the open water (no quay under it) with
// its back edge against the pier's head, the site nearest the head first.
// townSquare paints a basinSquareSide square of the paint family on the
// free land nearest the anchor (the first 3×3 the server accepts).
func (f *fixture) townSquare(island string, def *content.Building, anchor sim.Pos) {
	is := f.w.Island(island)
	type site struct{ x, y, d int }
	var sites []site
	const reach = 20
	for y := anchor.Y - reach; y <= anchor.Y+reach; y++ {
		for x := anchor.X - reach; x <= anchor.X+reach; x++ {
			if x < 0 || y < 0 || x+basinSquareSide > is.Width || y+basinSquareSide > is.Height {
				continue
			}
			dx, dy := 2*x+basinSquareSide-2*anchor.X, 2*y+basinSquareSide-2*anchor.Y
			sites = append(sites, site{x, y, dx*dx + dy*dy})
		}
	}
	slices.SortStableFunc(sites, func(a, b site) int { return a.d - b.d })
	occ := is.Occupancy(f.c)
	for _, s := range sites {
		var tiles []sim.Pos
		for ty := s.y; ty < s.y+basinSquareSide; ty++ {
			for tx := s.x; tx < s.x+basinSquareSide; tx++ {
				if occ[ty*is.Width+tx] != 0 || is.RoadAt(tx, ty) != "" || is.PlannedRoadAt(tx, ty) != "" || !ownLand(is.Tile(tx, ty).Terrain) {
					tiles = nil
					break
				}
				tiles = append(tiles, sim.Pos{X: tx, Y: ty})
			}
			if tiles == nil {
				break
			}
		}
		if len(tiles) != basinSquareSide*basinSquareSide {
			continue
		}
		for range tiles {
			f.grant(island, &def.Cost)
		}
		if f.try(sim.PlacePaint{IslandID: island, Type: def.ID, Tiles: tiles}) {
			return
		}
	}
	f.err = fmt.Errorf("no site for the %s fixture's %s on %s", FixtureHarbourBasin, def.ID, island)
}

func (f *fixture) placeAtHead(island string, def *content.Building, head sim.Pos) bool {
	is := f.w.Island(island)
	const reach = 12
	type site struct{ x, y, rot, d int }
	var sites []site
	for _, rot := range []int{0, 90, 180, 270} {
		w, h := def.Width, def.Height
		if rot == 90 || rot == 270 {
			w, h = h, w
		}
		for y := head.Y - reach; y <= head.Y+reach; y++ {
			for x := head.X - reach; x <= head.X+reach; x++ {
				if x < 0 || y < 0 || x+w > is.Width || y+h > is.Height {
					continue
				}
				water := true
				for ty := y; ty < y+h && water; ty++ {
					for tx := x; tx < x+w; tx++ {
						if is.Tile(tx, ty).Terrain != content.TerrainWater || is.RoadAt(tx, ty) != "" {
							water = false
							break
						}
					}
				}
				if !water {
					continue
				}
				dx, dy := 2*x+w-2*head.X-1, 2*y+h-2*head.Y-1
				sites = append(sites, site{x, y, rot, dx*dx + dy*dy})
			}
		}
	}
	slices.SortStableFunc(sites, func(a, b site) int { return a.d - b.d })
	for _, s := range sites {
		if sim.CheckSite(is, f.c, def, s.x, s.y, s.rot) != nil {
			continue
		}
		if f.try(sim.PlaceBuilding{IslandID: island, Type: def.ID, X: s.x, Y: s.y, Rotation: s.rot}) {
			return true
		}
	}
	return false
}
