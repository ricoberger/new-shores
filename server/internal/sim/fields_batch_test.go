package sim

import (
	"bytes"
	"errors"
	"math/rand/v2"
	"testing"

	"github.com/ricoberger/new-shores/server/internal/content"
)

// wheatWorld is fieldsWorld with Citizens unlocked, the wheat fertility,
// stone and a wheat farm at (16,5) (footprint x 16..18, y 5..7).
func wheatWorld(t *testing.T, c *content.Catalogue) (*World, int64) {
	t.Helper()
	w, _ := fieldsWorld(t, c)
	w.UnlockedTiers = []string{"citizens"}
	w.Islands[0].Fertilities = []string{"wheat"}
	if err := AddStock(w, c, "main", "stone", 50_000, nil); err != nil {
		t.Fatal(err)
	}
	farm := w.NextBuildingID
	mustApply(t, w, c, PlaceBuilding{IslandID: "main", Type: "wheat_farm", X: 16, Y: 5})
	return w, farm
}

// rectTiles lists the tiles of [x0, x1] x [y0, y1] row-major, reversed
// when rev is set.
func rectTiles(x0, y0, x1, y1 int, rev bool) []Pos {
	var out []Pos
	for y := y0; y <= y1; y++ {
		for x := x0; x <= x1; x++ {
			out = append(out, Pos{x, y})
		}
	}
	if rev {
		for i, j := 0, len(out)-1; i < j; i, j = i+1, j-1 {
			out[i], out[j] = out[j], out[i]
		}
	}
	return out
}

func encodeWorld(t testing.TB, w *World) []byte {
	t.Helper()
	b, err := Encode(w, "t")
	if err != nil {
		t.Fatal(err)
	}
	return b
}

// TestPlaceFieldsBatch: a painted rectangle listed far side first still
// grows its chain from the farm (repeated passes), stops at fields.max,
// charges each placed field once and reports every tile.
func TestPlaceFieldsBatch(t *testing.T) {
	c := catalogue(t)
	w, farm := wheatWorld(t, c)
	max := c.BuildingByID["wheat_farm"].Fields.Max
	gold := w.Gold
	tiles := rectTiles(14, 8, 22, 12, true)
	res, err := ApplyWithResult(w, c, PlaceFields{IslandID: "main", FarmID: farm, Type: "wheat_field", Tiles: tiles}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Tiles) != len(tiles) {
		t.Fatalf("%d results for %d tiles", len(res.Tiles), len(tiles))
	}
	is := w.Islands[0]
	ok := 0
	for i, r := range res.Tiles {
		if r.X != tiles[i].X || r.Y != tiles[i].Y {
			t.Errorf("result %d at (%d,%d), tile (%d,%d)", i, r.X, r.Y, tiles[i].X, tiles[i].Y)
		}
		b := is.BuildingAt(c, r.X, r.Y)
		switch {
		case r.Err == nil:
			ok++
			if b == nil || b.Type != "wheat_field" || b.FarmID != farm || b.Inactive {
				t.Errorf("ok tile (%d,%d) has %+v", r.X, r.Y, b)
			}
		case b != nil:
			t.Errorf("rejected tile (%d,%d) has %+v", r.X, r.Y, b)
		case !errors.Is(r.Err, ErrFieldMaxReached) && !errors.Is(r.Err, ErrFieldNotAdjacent):
			t.Errorf("tile (%d,%d): %v", r.X, r.Y, r.Err)
		}
	}
	if ok != max || len(farmFieldsOf(is, c, farm)) != max {
		t.Errorf("%d placed, %d fields, want %d", ok, len(farmFieldsOf(is, c, farm)), max)
	}
	if spent := gold - w.Gold; spent != int64(max)*c.BuildingByID["wheat_field"].Cost.Gold {
		t.Errorf("spent %d milli-gold", spent)
	}
	if b := is.Building(farm); b.Efficiency != 1000 {
		t.Errorf("farm efficiency %d", b.Efficiency)
	}
	// The farm is full: a further batch applies no tile and leaves the
	// world unchanged; the one-tile place_field fails with the reason.
	before := encodeWorld(t, w)
	res, err = ApplyWithResult(w, c, PlaceFields{IslandID: "main", FarmID: farm, Type: "wheat_field", Tiles: []Pos{{19, 5}}}, nil)
	if err != nil || !res.Unchanged || len(res.Tiles) != 1 || !errors.Is(res.Tiles[0].Err, ErrFieldMaxReached) {
		t.Errorf("full farm: %+v, %v", res, err)
	}
	expectApplyErr(t, w, c, PlaceField{IslandID: "main", FarmID: farm, Type: "wheat_field", X: 19, Y: 5}, ErrFieldMaxReached)
	if !bytes.Equal(before, encodeWorld(t, w)) {
		t.Error("a batch without a valid tile changed the world")
	}
}

// TestPlaceFieldsPartial: invalid tiles (road, water, occupied, out of
// bounds, unaffordable) are rejected with their reason while the valid
// ones are placed.
func TestPlaceFieldsPartial(t *testing.T) {
	c := catalogue(t)
	w, farm := wheatWorld(t, c)
	cost := c.BuildingByID["wheat_field"].Cost.Gold
	w.Gold = 3 * cost
	tiles := []Pos{{19, 4}, {19, 5}, {23, 13}, {30, 5}, {17, 6}, {19, 6}, {19, 7}, {19, 8}}
	res, err := ApplyWithResult(w, c, PlaceFields{IslandID: "main", FarmID: farm, Type: "wheat_field", Tiles: tiles}, nil)
	if err != nil {
		t.Fatal(err)
	}
	want := []error{ErrOccupied, nil, ErrTerrain, ErrOutOfBounds, ErrOccupied, nil, nil, ErrInsufficientGold}
	for i, r := range res.Tiles {
		if (want[i] == nil) != (r.Err == nil) || (want[i] != nil && !errors.Is(r.Err, want[i])) {
			t.Errorf("tile %d (%d,%d): %v, want %v", i, r.X, r.Y, r.Err, want[i])
		}
	}
	if w.Gold != 0 || len(farmFieldsOf(w.Islands[0], c, farm)) != 3 {
		t.Errorf("gold %d, fields %d", w.Gold, len(farmFieldsOf(w.Islands[0], c, farm)))
	}
}

// TestPlaceFieldsErrors: whole-command errors leave the world unchanged.
func TestPlaceFieldsErrors(t *testing.T) {
	c := catalogue(t)
	w, farm := wheatWorld(t, c)
	many := rectTiles(0, 0, 23, 13, false)
	many = append(many, rectTiles(30, 0, 30, 300, false)...)
	for _, tt := range []struct {
		name string
		cmd  PlaceFields
		want error
	}{
		{"no tiles", PlaceFields{IslandID: "main", FarmID: farm, Type: "wheat_field"}, ErrInvalidCommand},
		{"duplicate", PlaceFields{IslandID: "main", FarmID: farm, Type: "wheat_field", Tiles: []Pos{{19, 5}, {19, 5}}}, ErrInvalidCommand},
		{"too many", PlaceFields{IslandID: "main", FarmID: farm, Type: "wheat_field", Tiles: many[:MaxFieldTiles+1]}, ErrInvalidCommand},
		{"wrong farm", PlaceFields{IslandID: "main", FarmID: farm, Type: "pasture", Tiles: []Pos{{19, 5}}}, ErrFieldWrongFarm},
		{"unknown farm", PlaceFields{IslandID: "main", FarmID: 999, Type: "wheat_field", Tiles: []Pos{{19, 5}}}, ErrBuildingNotFound},
	} {
		t.Run(tt.name, func(t *testing.T) {
			before := encodeWorld(t, w)
			expectApplyErr(t, w, c, tt.cmd, tt.want)
			if !bytes.Equal(before, encodeWorld(t, w)) {
				t.Error("world changed")
			}
		})
	}
	if len(many) <= MaxFieldTiles {
		t.Fatal("test list too short")
	}
	// MaxFieldTiles tiles are accepted.
	if _, err := ApplyWithResult(w, c, PlaceFields{IslandID: "main", FarmID: farm, Type: "wheat_field", Tiles: many[:MaxFieldTiles]}, nil); err != nil {
		t.Errorf("%d tiles: %v", MaxFieldTiles, err)
	}
}

// TestDemolishFields: tiles name the farm's fields; a field covered by
// several tiles goes once, foreign and empty tiles are rejected; each
// demolished field refunds like a demolition; no valid tile is a success
// without a state change.
func TestDemolishFields(t *testing.T) {
	c := catalogue(t)
	w, sheep := fieldsWorld(t, c)
	p1 := putField(t, w, c, sheep, "pasture", 11, 5)
	p2 := putField(t, w, c, sheep, "pasture", 13, 5)
	before := encodeWorld(t, w)
	// No field of the farm under any tile (empty, the farm itself): success
	// without a state change, every tile with its reason (like place_fields).
	for _, tiles := range [][]Pos{{{20, 12}}, {{9, 6}}, {{20, 12}, {9, 6}, {-1, 0}}} {
		res, err := ApplyWithResult(w, c, DemolishFields{IslandID: "main", FarmID: sheep, Tiles: tiles}, nil)
		if err != nil || !res.Unchanged || len(res.Tiles) != len(tiles) {
			t.Fatalf("%v: %+v, %v", tiles, res, err)
		}
		for i, r := range res.Tiles {
			if r.Err == nil || (r.X != tiles[i].X || r.Y != tiles[i].Y) {
				t.Errorf("%v tile %d: %+v", tiles, i, r)
			}
		}
	}
	expectApplyErr(t, w, c, DemolishFields{IslandID: "main", FarmID: sheep, Tiles: []Pos{{11, 5}, {11, 5}}}, ErrInvalidCommand)
	expectApplyErr(t, w, c, DemolishFields{IslandID: "main", FarmID: 999, Tiles: []Pos{{11, 5}}}, ErrBuildingNotFound)
	if !bytes.Equal(before, encodeWorld(t, w)) {
		t.Fatal("a failed demolish_fields changed the world")
	}
	tiles := []Pos{{11, 5}, {12, 6}, {20, 12}, {-1, 0}}
	res, err := ApplyWithResult(w, c, DemolishFields{IslandID: "main", FarmID: sheep, Tiles: tiles}, nil)
	if err != nil {
		t.Fatal(err)
	}
	want := []error{nil, nil, ErrBuildingNotFound, ErrOutOfBounds}
	for i, r := range res.Tiles {
		if (want[i] == nil) != (r.Err == nil) || (want[i] != nil && !errors.Is(r.Err, want[i])) {
			t.Errorf("tile %d: %v, want %v", i, r.Err, want[i])
		}
	}
	is := w.Islands[0]
	if is.Building(p1) != nil || is.Building(p2) == nil || !is.Building(p2).Inactive {
		t.Errorf("p1 %+v p2 %+v", is.Building(p1), is.Building(p2))
	}
}

// TestPlaceFieldAlias: place_field is place_fields with one tile.
func TestPlaceFieldAlias(t *testing.T) {
	c := catalogue(t)
	a, farm := wheatWorld(t, c)
	b := a.Clone()
	mustApply(t, a, c, PlaceField{IslandID: "main", FarmID: farm, Type: "wheat_field", X: 19, Y: 5})
	mustApply(t, b, c, PlaceFields{IslandID: "main", FarmID: farm, Type: "wheat_field", Tiles: []Pos{{19, 5}}})
	if !bytes.Equal(encodeWorld(t, a), encodeWorld(t, b)) {
		t.Error("place_field and a one-tile place_fields differ")
	}
}

// sequentialFields is the reference of PlaceFields: one PlaceField per
// tile, in passes over the list while a pass placed one.
func sequentialFields(w *World, c *content.Catalogue, cmd PlaceFields) int {
	placed := 0
	done := make([]bool, len(cmd.Tiles))
	for progress := true; progress; {
		progress = false
		for i, p := range cmd.Tiles {
			if done[i] {
				continue
			}
			if Apply(w, c, PlaceField{IslandID: cmd.IslandID, FarmID: cmd.FarmID, Type: cmd.Type, X: p.X, Y: p.Y, Rotation: cmd.Rotation}) == nil {
				done[i], progress = true, true
				placed++
			}
		}
	}
	return placed
}

// TestPropertyPlaceFields: on random worlds with farms, a random painted
// rectangle (random order, sometimes out of reach, of a wrong type or
// unaffordable) applies atomically: on error or without a valid tile
// (Result.Unchanged, every tile rejected) the world is byte-identical;
// otherwise the world equals the one tile-by-tile PlaceField reference,
// every ok tile carries a new field of the farm, every rejected tile
// none, the farm stays within fields.max; and demolish_fields of a random
// rectangle equals demolishing the covered fields one by one.
func TestPropertyPlaceFields(t *testing.T) {
	cats := propertyCatalogues(t)
	cats["shipped"] = shippedCatalogue(t)
	for name, c := range cats {
		c := withoutQuests(c)
		t.Run(name, func(t *testing.T) {
			batches, partial, failed := 0, 0, 0
			for seed := range uint64(propertyCases) {
				var p *propCase
				if name == "shipped" {
					p = shippedFieldsCase(t, c, 310_000+seed)
				} else {
					p = moveWorld(t, c, 310_000+seed)
				}
				for range 6 {
					cmd, ok := p.randomFieldBatch()
					if !ok {
						break
					}
					ref := p.w.Clone()
					before := encodeWorld(t, p.w)
					beforeIDs := map[int64]bool{}
					for _, b := range p.w.Islands[0].Buildings {
						beforeIDs[b.ID] = true
					}
					res, err := ApplyWithResult(p.w, p.c, cmd, nil)
					n := sequentialFields(ref, p.c, cmd)
					if err != nil || res.Unchanged {
						failed++
						if err == nil && !noTileApplied(res.Tiles) {
							t.Fatalf("seed %d: unchanged batch with an applied tile", seed)
						}
						if !bytes.Equal(before, encodeWorld(t, p.w)) {
							t.Fatalf("seed %d: failed batch (%v) changed the world", seed, err)
						}
						if n != 0 {
							t.Fatalf("seed %d: batch failed (%v) but the reference placed %d", seed, err, n)
						}
						continue
					}
					batches++
					if !bytes.Equal(encodeWorld(t, ref), encodeWorld(t, p.w)) {
						a, b := string(encodeWorld(t, ref)), string(encodeWorld(t, p.w))
						i := 0
						for i < len(a) && i < len(b) && a[i] == b[i] {
							i++
						}
						t.Fatalf("seed %d: batch differs from the tile-by-tile reference at\nref   %s\nbatch %s", seed, a[max(0, i-200):min(len(a), i+100)], b[max(0, i-200):min(len(b), i+100)])
					}
					is := p.w.Islands[0]
					okTiles := 0
					for _, r := range res.Tiles {
						b := is.BuildingAt(p.c, r.X, r.Y)
						isNew := b != nil && !beforeIDs[b.ID] && b.X == r.X && b.Y == r.Y && b.FarmID == cmd.FarmID
						if (r.Err == nil) != isNew {
							t.Fatalf("seed %d: tile (%d,%d) err %v, new field %v", seed, r.X, r.Y, r.Err, isNew)
						}
						if r.Err == nil {
							okTiles++
						}
					}
					if okTiles != n {
						t.Fatalf("seed %d: %d ok tiles, reference placed %d", seed, okTiles, n)
					}
					if okTiles < len(cmd.Tiles) {
						partial++
					}
					p.checkFields(seed)
					p.checkDemolishFields(seed, cmd.FarmID)
				}
			}
			t.Logf("%d batches applied (%d partial), %d failed", batches, partial, failed)
			if batches == 0 || partial == 0 || failed == 0 {
				t.Error("the cases miss applied, partial or failed batches")
			}
		})
	}
}

// randomFieldBatch returns a PlaceFields of a random farm: a rectangle of
// up to 9x9 anchors near the farm (sometimes elsewhere), in row-major,
// reversed or shuffled order, sometimes of a wrong field type; the gold is
// sometimes cut to a few fields.
func (p *propCase) randomFieldBatch() (PlaceFields, bool) {
	cmd, ok := p.randomFieldCommand().(PlaceField)
	if !ok {
		return PlaceFields{}, false
	}
	w, h := 1+p.rng.IntN(9), 1+p.rng.IntN(9)
	if p.rng.IntN(4) == 0 {
		// A large drag of one-tile crops (up to 22x22 = 484 <= MaxFieldTiles).
		w, h = 1+p.rng.IntN(22), 1+p.rng.IntN(22)
	}
	tiles := rectTiles(cmd.X, cmd.Y, cmd.X+w-1, cmd.Y+h-1, p.rng.IntN(2) == 0)
	if p.rng.IntN(3) == 0 {
		p.rng.Shuffle(len(tiles), func(i, j int) { tiles[i], tiles[j] = tiles[j], tiles[i] })
	}
	if def := p.c.BuildingByID[cmd.Type]; def != nil && p.rng.IntN(5) == 0 {
		p.w.Gold = def.Cost.Gold * int64(p.rng.IntN(4))
	}
	return PlaceFields{IslandID: cmd.IslandID, FarmID: cmd.FarmID, Type: cmd.Type, Tiles: tiles}, true
}

// shippedFieldsCase is a property case on the shipped content (D-054
// sizes): a 64x44 island with random forest and mountain tiles, a 6x9
// Trading Post on a three-row bay, the Citizens unlocked, the fertilities
// of the crop farms, plenty of gold and planks, and the four farms
// (sheep, wheat, orchard, hemp) on cleared ground.
func shippedFieldsCase(t *testing.T, c *content.Catalogue, seed uint64) *propCase {
	t.Helper()
	p := &propCase{t: t, c: c, types: propertyTypes(c), rng: rand.New(rand.NewPCG(seed, 0x5eed)), l: NewLedger(), splitKinds: map[string]int{}} // #nosec G404 -- deterministic test data
	const width, height = 64, 44
	farms := []struct {
		typ  string
		x, y int
	}{{"sheep_farm", 12, 10}, {"wheat_farm", 40, 10}, {"orchard", 12, 30}, {"hemp_farm", 44, 30}}
	cleared := func(x, y int) bool {
		if x <= 8 && y <= 9 {
			return true // the Trading Post and its bay
		}
		for _, f := range farms {
			if x >= f.x-1 && x <= f.x+4 && y >= f.y-1 && y <= f.y+4 {
				return true
			}
		}
		return false
	}
	tiles := make([]Tile, width*height)
	for y := range height {
		for x := range width {
			terrain := content.TerrainGrass
			switch r := p.rng.IntN(100); {
			case x == 0 || y == 0 || x == width-1 || y == height-1, x <= 8 && y < c.BuildingByID["trading_post"].WaterRows.Max:
				terrain = content.TerrainWater
			case cleared(x, y):
			case r < 8:
				terrain = content.TerrainForest
			case r < 11:
				terrain = content.TerrainMountain
			}
			tiles[y*width+x] = Tile{Terrain: terrain}
		}
	}
	w := NewWorld(t0)
	w.Islands = []*Island{NewIsland("main", width, height, tiles)}
	w.Islands[0].Fertilities = []string{"wheat", "apple", "hemp"}
	w.UnlockedTiers = []string{"citizens"}
	if err := PlaceFree(w, c, PlaceBuilding{IslandID: "main", Type: "trading_post", X: 1, Y: 0}, p.l); err != nil {
		t.Fatalf("seed %d: trading post: %v", seed, err)
	}
	w.Gold = 100_000_000
	for _, g := range []string{"planks", "stone"} {
		if err := AddStock(w, c, "main", g, 40_000, nil); err != nil {
			t.Fatal(err)
		}
	}
	for _, f := range farms {
		if err := PlaceFree(w, c, PlaceBuilding{IslandID: "main", Type: f.typ, X: f.x, Y: f.y}, p.l); err != nil {
			t.Fatalf("seed %d: %s: %v", seed, f.typ, err)
		}
	}
	p.w = w
	return p
}

// checkDemolishFields demolishes a random rectangle of the farm's fields
// and compares with one Demolish per covered field (in the order the
// tiles first name them).
func (p *propCase) checkDemolishFields(seed uint64, farm int64) {
	is := p.w.Islands[0]
	b := is.Building(farm)
	if b == nil {
		return
	}
	x, y := b.X-3+p.rng.IntN(7), b.Y-3+p.rng.IntN(7)
	tiles := rectTiles(x, y, x+p.rng.IntN(6), y+p.rng.IntN(6), false)
	ref := p.w.Clone()
	var order []int64
	seen := map[int64]bool{}
	for _, t := range tiles {
		if f := is.BuildingAt(p.c, t.X, t.Y); f != nil && f.FarmID == farm && !seen[f.ID] {
			seen[f.ID] = true
			order = append(order, f.ID)
		}
	}
	before := encodeWorld(p.t, p.w)
	res, err := ApplyWithResult(p.w, p.c, DemolishFields{IslandID: is.ID, FarmID: farm, Tiles: tiles}, nil)
	if err != nil || res.Unchanged != (len(order) == 0) {
		p.t.Fatalf("seed %d: demolish_fields %+v, %v with %d fields covered", seed, res, err, len(order))
	}
	if res.Unchanged {
		if !bytes.Equal(before, encodeWorld(p.t, p.w)) {
			p.t.Fatalf("seed %d: demolish_fields without a field changed the world", seed)
		}
		return
	}
	for _, id := range order {
		if err := Apply(ref, p.c, Demolish{IslandID: is.ID, BuildingID: id}); err != nil {
			p.t.Fatalf("seed %d: reference demolish %d: %v", seed, id, err)
		}
	}
	if !bytes.Equal(encodeWorld(p.t, ref), encodeWorld(p.t, p.w)) {
		p.t.Fatalf("seed %d: demolish_fields differs from one demolish per field", seed)
	}
	p.checkFields(seed)
}
