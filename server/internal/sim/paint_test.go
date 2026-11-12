package sim

import (
	"errors"
	"testing"
)

func paintAt(t *testing.T, w *World, cmd PlacePaint) []TileResult {
	t.Helper()
	res, err := ApplyWithResult(w, shippedCatalogue(t), cmd, nil)
	if err != nil {
		t.Fatalf("Apply(%+v): %v", cmd, err)
	}
	return res.Tiles
}

func countType(is *Island, typ string) (n int) {
	for _, b := range is.Buildings {
		if b.Type == typ {
			n++
		}
	}
	return n
}

// TestPaintFamilies (D-077 §2–§3): a paint family is painted tile by tile,
// each tile a 1×1 building charged on its own; taken tiles are refused
// per tile; plans are free; demolish_paint removes them with the refund.
func TestPaintFamilies(t *testing.T) {
	c := shippedCatalogue(t)
	w := shoreWorld(t)
	is := w.Island("main")
	gold := w.Gold
	res := paintAt(t, w, PlacePaint{IslandID: "main", Type: "hedge", Tiles: []Pos{{20, 25}, {21, 25}, {22, 25}}})
	if noTileApplied(res) || countType(is, "hedge") != 3 || w.Gold != gold-3*c.BuildingByID["hedge"].Cost.Gold {
		t.Fatalf("hedges %d, gold %d (results %+v)", countType(is, "hedge"), gold-w.Gold, res)
	}
	// A painted tile is taken: the drag over it places only the new tile.
	res = paintAt(t, w, PlacePaint{IslandID: "main", Type: "hedge", Tiles: []Pos{{22, 25}, {23, 25}}})
	if !errors.Is(res[0].Err, ErrOccupied) || res[1].Err != nil || countType(is, "hedge") != 4 {
		t.Fatalf("results %+v, hedges %d", res, countType(is, "hedge"))
	}
	// Plans: free, no buildings.
	gold = w.Gold
	paintAt(t, w, PlacePaint{IslandID: "main", Type: "square", Tiles: []Pos{{20, 30}, {21, 30}}, Planned: true})
	if len(is.Plans) != 2 || w.Gold != gold || countType(is, "square") != 0 {
		t.Fatalf("plans %d, gold %d", len(is.Plans), gold-w.Gold)
	}
	// Not a paint family.
	if err := Apply(w, c, PlacePaint{IslandID: "main", Type: "well", Tiles: []Pos{{30, 30}}}); !errors.Is(err, ErrInvalidCommand) {
		t.Fatalf("paint a well = %v", err)
	}
	// Demolish: hedges and the plan go, an empty tile is refused.
	res2, err := ApplyWithResult(w, c, DemolishPaint{IslandID: "main", Tiles: []Pos{{20, 25}, {21, 25}, {20, 30}, {30, 30}}}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if res2.Tiles[0].Err != nil || res2.Tiles[2].Err != nil || !errors.Is(res2.Tiles[3].Err, ErrBuildingNotFound) || countType(is, "hedge") != 2 || len(is.Plans) != 1 {
		t.Fatalf("results %+v, hedges %d, plans %d", res2.Tiles, countType(is, "hedge"), len(is.Plans))
	}
}

// TestCityWallRoadCrossing (D-077 §3): a road crosses a city wall in
// either order and stays when the wall goes; other paint families and
// buildings keep roads off.
func TestCityWallRoadCrossing(t *testing.T) {
	c := shippedCatalogue(t)
	w := shoreWorld(t)
	is := w.Island("main")
	mustApply(t, w, c, PlaceRoad{IslandID: "main", Type: "road_dirt", Tiles: []Pos{{20, 22}, {20, 23}, {20, 24}}})
	// Wall over the road.
	res := paintAt(t, w, PlacePaint{IslandID: "main", Type: "city_wall", Tiles: []Pos{{19, 23}, {20, 23}, {21, 23}}})
	if noTileApplied(res) || res[1].Err != nil || countType(is, "city_wall") != 3 {
		t.Fatalf("results %+v", res)
	}
	// Road over a wall.
	mustApply(t, w, c, PlaceRoad{IslandID: "main", Type: "road_dirt", Tiles: []Pos{{21, 24}, {21, 23}, {21, 22}}})
	// A hedge keeps roads off and stays off roads.
	paintAt(t, w, PlacePaint{IslandID: "main", Type: "hedge", Tiles: []Pos{{25, 23}}})
	if err := Apply(w, c, PlaceRoad{IslandID: "main", Type: "road_dirt", Tiles: []Pos{{25, 23}}}); !errors.Is(err, ErrOccupied) {
		t.Fatalf("road over a hedge = %v", err)
	}
	if res := paintAt(t, w, PlacePaint{IslandID: "main", Type: "hedge", Tiles: []Pos{{20, 22}}}); !errors.Is(res[0].Err, ErrOccupied) {
		t.Fatalf("hedge on a road = %+v", res)
	}
	// Demolishing the wall keeps the road; demolishing the road keeps the wall.
	if _, err := ApplyWithResult(w, c, DemolishPaint{IslandID: "main", Tiles: []Pos{{20, 23}}}, nil); err != nil {
		t.Fatal(err)
	}
	if is.Roads[is.index(20, 23)] != "road_dirt" {
		t.Fatal("the road under the wall went with it")
	}
	mustApply(t, w, c, DemolishRoads{IslandID: "main", Tiles: []Pos{{21, 23}}})
	if b := is.BuildingAt(c, 21, 23); b == nil || b.Type != "city_wall" {
		t.Fatalf("wall after road demolition: %+v", b)
	}
}

// TestGatehouse (D-077 §3): a gatehouse needs a city wall beside the
// middle of the two sides its passage does not cross; a road runs along
// its centre line only.
func TestGatehouse(t *testing.T) {
	c := shippedCatalogue(t)
	w := shoreWorld(t)
	gate := PlaceBuilding{IslandID: "main", Type: "gatehouse", X: 20, Y: 25}
	if err := Apply(w, c, gate); !errors.Is(err, ErrGateNeedsWall) {
		t.Fatalf("gate without walls = %v", err)
	}
	// Rotation 0: the passage runs north–south through x 21; the walls
	// stand west and east of the middle row (y 26).
	paintAt(t, w, PlacePaint{IslandID: "main", Type: "city_wall", Tiles: []Pos{{19, 26}}})
	if err := Apply(w, c, gate); !errors.Is(err, ErrGateNeedsWall) {
		t.Fatalf("gate with one wall = %v", err)
	}
	paintAt(t, w, PlacePaint{IslandID: "main", Type: "city_wall", Tiles: []Pos{{23, 26}}, Planned: true})
	mustApply(t, w, c, gate)
	mustApply(t, w, c, PlaceRoad{IslandID: "main", Type: "road_dirt", Tiles: []Pos{{21, 24}, {21, 25}, {21, 26}, {21, 27}, {21, 28}}})
	if err := Apply(w, c, PlaceRoad{IslandID: "main", Type: "road_dirt", Tiles: []Pos{{20, 25}}}); !errors.Is(err, ErrOccupied) {
		t.Fatalf("road beside the passage = %v", err)
	}
	// Rotation 90: the passage runs east–west through y 32; the walls
	// stand north and south of the middle column (x 31), and the gate
	// may be placed over an existing road on its passage.
	mustApply(t, w, c, PlaceRoad{IslandID: "main", Type: "road_dirt", Tiles: []Pos{{29, 32}, {30, 32}, {31, 32}, {32, 32}, {33, 32}}})
	paintAt(t, w, PlacePaint{IslandID: "main", Type: "city_wall", Tiles: []Pos{{31, 30}, {31, 34}}})
	mustApply(t, w, c, PlaceBuilding{IslandID: "main", Type: "gatehouse", X: 30, Y: 31, Rotation: 90})
	if err := Apply(w, c, PlaceBuilding{IslandID: "main", Type: "gatehouse", X: 30, Y: 31, Rotation: 0}); err == nil {
		t.Fatal("a second gate on the same site")
	}
}
