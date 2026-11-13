package sim

import (
	"math/rand/v2"
	"testing"

	"github.com/ricoberger/new-shores/server/internal/content"
)

// gridField is the road field as warehouseField computed it before the
// road graph (one W x H grid per collector): the reference of
// TestRoadNetFieldMatchesGrid.
func gridField(is *Island, c *content.Catalogue, start []Pos) ([]int, []int64) {
	n := is.Width * is.Height
	dist, delay := make([]int, n), make([]int64, n)
	for i := range dist {
		dist[i] = unreachable
	}
	var layer []Pos
	for _, p := range start {
		i := is.index(p.X, p.Y)
		if dist[i] == unreachable {
			dist[i] = 1
			delay[i] = roadMs(c, is.Roads[i])
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
				dl := delay[i] + roadMs(c, rt)
				switch {
				case dist[j] == unreachable:
					dist[j], delay[j] = d+1, dl
					next = append(next, q)
				case dist[j] == d+1 && dl < delay[j]:
					delay[j] = dl
				}
			}
		}
		layer = next
	}
	return dist, delay
}

// TestRoadNetFieldMatchesGrid: the road-graph field gives every road tile
// the distance and delay of the grid search, on random networks of dirt
// and paved roads (the generator's reference games depend on it, D-067).
func TestRoadNetFieldMatchesGrid(t *testing.T) {
	c := shippedCatalogue(t)
	types := []string{"road_dirt", "road_paved"}
	for _, typ := range types {
		if c.BuildingByID[typ] == nil || c.BuildingByID[typ].Road == nil {
			t.Fatalf("no road %s", typ)
		}
	}
	rng := rand.New(rand.NewPCG(7, 11)) // #nosec G404 -- deterministic test data
	for round := range 200 {
		w, h := 5+rng.IntN(30), 5+rng.IntN(30)
		is := &Island{ID: "i", Width: w, Height: h, Roads: map[int]string{}}
		for i := range w * h {
			if rng.IntN(100) < 55 {
				is.Roads[i] = types[rng.IntN(len(types))]
			}
		}
		net := newRoadNet(is, c)
		for range 3 {
			var start []Pos
			for range 1 + rng.IntN(4) {
				x, y := rng.IntN(w), rng.IntN(h)
				if is.RoadAt(x, y) != "" {
					start = append(start, Pos{x, y})
				}
			}
			dist, delay := gridField(is, c, start)
			f := warehouseField(is, net, start)
			for i := range w * h {
				k := net.at(i)
				if k == unreachable {
					if is.Roads[i] != "" {
						t.Fatalf("round %d: road tile %d not in the graph", round, i)
					}
					continue
				}
				if int(f.dist[k]) != dist[i] || f.delay[k] != delay[i] {
					t.Fatalf("round %d tile %d: dist %d delay %d, grid %d %d", round, i, f.dist[k], f.delay[k], dist[i], delay[i])
				}
			}
		}
	}
}

// TestCloneSharingTiles: the copy shares the tiles and nothing else.
func TestCloneSharingTiles(t *testing.T) {
	w := NewWorld(t0)
	tiles := make([]Tile, 4*4)
	for i := range tiles {
		tiles[i].Terrain = content.TerrainGrass
	}
	tiles[5].Deposit = &Deposit{Kind: "stone"}
	is := NewIsland("i", 4, 4, tiles)
	is.Roads = map[int]string{1: "road_dirt"}
	is.Buildings = []*Building{{ID: 1, Type: "lumberjack"}}
	w.Regions = []*Region{{Islands: []*Island{is}}}

	deep, shared := w.Clone(), w.CloneSharingTiles()
	if &deep.Islands()[0].Tiles[0] == &is.Tiles[0] || deep.Islands()[0].Tiles[5].Deposit == is.Tiles[5].Deposit {
		t.Error("Clone shares tiles")
	}
	cs := shared.Islands()[0]
	if &cs.Tiles[0] != &is.Tiles[0] {
		t.Error("CloneSharingTiles copied the tiles")
	}
	cs.Roads[2] = "road_dirt"
	cs.Buildings[0].X = 3
	cs.Buildings = append(cs.Buildings, &Building{ID: 2})
	if is.Roads[2] != "" || is.Buildings[0].X != 0 || len(is.Buildings) != 1 {
		t.Error("CloneSharingTiles shares more than the tiles")
	}
}
