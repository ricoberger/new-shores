//go:build atlas

package archipelago

// The island atlas (D-058 step 3): every island of a seed as a PNG plus an
// archipelago overview, to judge shapes before renderer work. Standard
// library only. Run through `make island-atlas SEED=<seeds>` (comma
// separated; OUT= the output directory) or directly:
//
//	ATLAS_SEEDS=1053001,42 go test -tags atlas -run TestIslandAtlas ./internal/sim/archipelago/
//
// ATLAS_STATS=<n> prints the guarantee statistics over seeds 1..n instead.

import (
	"fmt"
	"image"
	"image/color"
	"image/png"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"testing"

	"github.com/ricoberger/new-shores/server/internal/content"
	"github.com/ricoberger/new-shores/server/internal/sim"
)

func TestIslandAtlas(t *testing.T) {
	c := catalogue(t)
	if n, _ := strconv.Atoi(os.Getenv("ATLAS_STATS")); n > 0 {
		atlasStats(t, c, n)
		return
	}
	seeds := os.Getenv("ATLAS_SEEDS")
	if seeds == "" {
		t.Skip("ATLAS_SEEDS not set")
	}
	out := os.Getenv("ATLAS_OUT")
	if out == "" {
		out = filepath.Join(repoRootAtlas(), ".experiment", "islands", "atlas")
	}
	for _, f := range strings.Split(seeds, ",") {
		seed, err := strconv.ParseUint(strings.TrimSpace(f), 10, 64)
		if err != nil {
			t.Fatalf("seed %q: %v", f, err)
		}
		a, err := Generate(seed, c)
		if err != nil {
			t.Fatalf("seed %d: %v", seed, err)
		}
		dir := filepath.Join(out, fmt.Sprint(seed))
		if err := os.MkdirAll(dir, 0o750); err != nil {
			t.Fatal(err)
		}
		for _, is := range a.Islands {
			img := renderIsland(is, c)
			writePNG(t, filepath.Join(dir, fmt.Sprintf("%s-%s.png", is.ID, is.SizeClass)), img)
		}
		writePNG(t, filepath.Join(dir, "overview.png"), renderOverview(a, c))
		t.Logf("seed %d: %d islands, %d buildable -> %s", seed, len(a.Islands), buildableArea(Main(&c.Islands, a.Islands)), dir)
	}
}

func repoRootAtlas() string {
	wd, _ := os.Getwd()
	return filepath.Join(wd, "..", "..", "..", "..")
}

func writePNG(t *testing.T, path string, img image.Image) {
	t.Helper()
	f, err := os.Create(path) // #nosec G304 -- atlas output path
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = f.Close() }()
	if err := png.Encode(f, img); err != nil {
		t.Fatal(err)
	}
}

func hex(s string) color.RGBA {
	v, _ := strconv.ParseUint(strings.TrimPrefix(s, "#"), 16, 32)
	return color.RGBA{uint8(v >> 16), uint8(v >> 8), uint8(v), 255}
}

func shade(c color.RGBA, pct int) color.RGBA {
	f := func(v uint8) uint8 { return uint8(min(255, max(0, int(v)*pct/100))) }
	return color.RGBA{f(c.R), f(c.G), f(c.B), 255}
}

// tileColour is the atlas colour of a tile; near is true for water within
// two tiles of land (the shallows).
func tileColour(t sim.Tile, near bool) color.RGBA {
	lv := []int{92, 100, 108}[min(t.Level, 2)]
	switch t.Terrain {
	case content.TerrainWater:
		if near {
			return hex("#4FB1B0")
		}
		return hex("#1F5F8B")
	case content.TerrainCoast:
		return hex("#E8D6A3")
	case content.TerrainCliff:
		return hex("#7D6B5A")
	case content.TerrainGrass:
		return shade(hex("#86AD5C"), lv)
	case content.TerrainForest:
		return shade(hex("#4C7A38"), lv)
	case content.TerrainMountain:
		return shade(hex("#9C8E7A"), 84+10*t.Height)
	case content.TerrainRiver:
		return hex("#3A9AC4")
	case content.TerrainIslet:
		if t.Height > 0 {
			return hex("#9A8C78")
		}
		return hex("#D9C48F")
	}
	return color.RGBA{255, 0, 255, 255}
}

func depositColour(kind string) color.RGBA {
	switch kind {
	case "stone":
		return hex("#D8D8D0")
	case "iron":
		return hex("#B5522E")
	case "clay":
		return hex("#C9783E")
	case "salt":
		return hex("#FFFFFF")
	case "coal":
		return hex("#202020")
	case "quartz":
		return hex("#C8E8F0")
	case "copper":
		return hex("#3FA88A")
	case "gold":
		return hex("#F2C230")
	}
	return color.RGBA{255, 0, 255, 255}
}

func scaleFor(class string) int {
	switch class {
	case "large":
		return 4
	case "medium":
		return 6
	case "small":
		return 10
	}
	return 24
}

func fillRect(img *image.RGBA, x0, y0, x1, y1 int, c color.RGBA) {
	for y := max(0, y0); y < min(img.Bounds().Dy(), y1); y++ {
		for x := max(0, x0); x < min(img.Bounds().Dx(), x1); x++ {
			img.SetRGBA(x, y, c)
		}
	}
}

func outline(img *image.RGBA, x0, y0, x1, y1, w int, c color.RGBA) {
	fillRect(img, x0, y0, x1, y0+w, c)
	fillRect(img, x0, y1-w, x1, y1, c)
	fillRect(img, x0, y0, x0+w, y1, c)
	fillRect(img, x1-w, y0, x1, y1, c)
}

// islandStats are the numbers of one island shown in the caption and
// collected by the statistics.
type islandStats struct {
	buildable, plain, rivers, islets, mountain, cliff, coast, land int
	levels                                                         [3]int
	// cliffShore and beachShore count the cliff and beach tiles next to
	// the sea; riverReach is the shortest river's reach (bounding box
	// diagonal) in percent of the island's span; isletMax the largest
	// islet.
	cliffShore, beachShore, riverReach, isletMax int
	// bay and pen are the deepest bay and the longest peninsula, percent
	// of the span (outlineOf).
	bay, pen int
}

func statsOf(is *sim.Island) islandStats {
	var s islandStats
	for _, t := range is.Tiles {
		switch t.Terrain {
		case content.TerrainWater:
			continue
		case content.TerrainCoast:
			s.coast++
			s.buildable++
		case content.TerrainGrass, content.TerrainForest:
			s.buildable++
		case content.TerrainMountain:
			s.mountain++
		case content.TerrainCliff:
			s.cliff++
		}
		if t.Terrain != content.TerrainIslet {
			s.land++
		}
		if t.Terrain != content.TerrainRiver && t.Terrain != content.TerrainIslet {
			s.levels[min(t.Level, 2)]++
		}
	}
	for i, t := range is.Tiles {
		if !touches(is, i, content.TerrainWater) {
			continue
		}
		switch t.Terrain {
		case content.TerrainCliff:
			s.cliffShore++
		case content.TerrainCoast:
			s.beachShore++
		}
	}
	s.plain = largestSquare(is)
	s.rivers = countComponents(is, content.TerrainRiver)
	s.islets = countComponents(is, content.TerrainIslet)
	x0, y0, x1, y1 := is.Width, is.Height, 0, 0
	for i, t := range is.Tiles {
		if t.Terrain != content.TerrainWater && t.Terrain != content.TerrainIslet {
			x0, y0, x1, y1 = min(x0, i%is.Width), min(y0, i/is.Width), max(x1, i%is.Width), max(y1, i/is.Width)
		}
	}
	span := max(x1-x0, y1-y0) + 1
	land := make([]bool, len(is.Tiles))
	for i, t := range is.Tiles {
		land[i] = t.Terrain != content.TerrainWater && t.Terrain != content.TerrainIslet
	}
	if sp, bay, pen := outlineOf(land, is.Width, is.Height); sp > 0 {
		s.bay, s.pen = bay*100/sp, pen*100/sp
	}
	s.riverReach = -1
	for _, comp := range islandComponents(is, content.TerrainRiver) {
		bx0, by0, bx1, by1 := is.Width, is.Height, 0, 0
		for _, i := range comp {
			bx0, by0, bx1, by1 = min(bx0, i%is.Width), min(by0, i/is.Width), max(bx1, i%is.Width), max(by1, i/is.Width)
		}
		reach := isqrt((bx1-bx0)*(bx1-bx0)+(by1-by0)*(by1-by0)) * 100 / span
		if s.riverReach < 0 || reach < s.riverReach {
			s.riverReach = reach
		}
	}
	for _, comp := range islandComponents(is, content.TerrainIslet) {
		s.isletMax = max(s.isletMax, len(comp))
	}
	return s
}

func countComponents(is *sim.Island, terrain string) int {
	seen := make([]bool, len(is.Tiles))
	n := 0
	for i, t := range is.Tiles {
		if t.Terrain != terrain || seen[i] {
			continue
		}
		n++
		stack := []int{i}
		seen[i] = true
		for len(stack) > 0 {
			j := stack[len(stack)-1]
			stack = stack[:len(stack)-1]
			x, y := j%is.Width, j/is.Width
			for _, d := range dirs4() {
				nx, ny := x+d[0], y+d[1]
				if !is.InBounds(nx, ny) {
					continue
				}
				k := ny*is.Width + nx
				if !seen[k] && is.Tiles[k].Terrain == terrain {
					seen[k] = true
					stack = append(stack, k)
				}
			}
		}
	}
	return n
}

func renderIsland(is *sim.Island, c *content.Catalogue) *image.RGBA {
	s := scaleFor(is.SizeClass)
	captionH := 2*7*2 + 16
	img := image.NewRGBA(image.Rect(0, 0, max(is.Width*s, 420), is.Height*s+captionH))
	fillRect(img, 0, 0, img.Bounds().Dx(), img.Bounds().Dy(), hex("#F4EFE2"))
	land := func(x, y int) bool {
		return is.InBounds(x, y) && is.Tile(x, y).Terrain != content.TerrainWater
	}
	for y := range is.Height {
		for x := range is.Width {
			t := is.Tile(x, y)
			near := false
			for dy := -2; dy <= 2 && !near; dy++ {
				for dx := -2; dx <= 2; dx++ {
					if land(x+dx, y+dy) && is.Tile(x+dx, y+dy).Terrain != content.TerrainIslet {
						near = true
						break
					}
				}
			}
			col := tileColour(t, near)
			fillRect(img, x*s, y*s, x*s+s, y*s+s, col)
			if t.Deposit != nil {
				m := max(1, s/4)
				fillRect(img, x*s+m, y*s+m, x*s+s-m, y*s+s-m, depositColour(t.Deposit.Kind))
			}
		}
	}
	// Level edges: a dark line on the border to a lower land tile.
	edge := color.RGBA{40, 40, 30, 255}
	lw := max(1, s/4)
	lvl := func(x, y int) int { return is.Tile(x, y).Level }
	ground := func(x, y int) bool {
		if !is.InBounds(x, y) {
			return false
		}
		tr := is.Tile(x, y).Terrain
		return tr != content.TerrainWater && tr != content.TerrainIslet
	}
	for y := range is.Height {
		for x := range is.Width {
			if !ground(x, y) {
				continue
			}
			if ground(x+1, y) && lvl(x+1, y) != lvl(x, y) {
				fillRect(img, (x+1)*s-lw/2-1, y*s, (x+1)*s+lw/2, y*s+s, edge)
			}
			if ground(x, y+1) && lvl(x, y+1) != lvl(x, y) {
				fillRect(img, x*s, (y+1)*s-lw/2-1, x*s+s, (y+1)*s+lw/2, edge)
			}
		}
	}
	sc := c.Islands.SizeClassByID[is.SizeClass]
	// Two disjoint Trading Post sites (red) and a shipyard site (orange).
	if tp := TradingPost(c); tp != nil {
		sites := Sites(is, c, tp)
		var picked []Rect
		for _, r := range sites {
			if len(picked) == 2 {
				break
			}
			if len(picked) == 1 && picked[0].overlaps(r) {
				continue
			}
			picked = append(picked, r)
		}
		for _, r := range picked {
			outline(img, r.X*s, r.Y*s, (r.X+r.W)*s, (r.Y+r.H)*s, max(1, s/3), hex("#D7263D"))
		}
	}
	if yard := firstBuilding(c, func(b *content.Building) bool { return b.Shipyard != nil }); yard != nil && !sc.Rock {
		if sites := Sites(is, c, yard); len(sites) > 0 {
			r := sites[len(sites)/2]
			outline(img, r.X*s, r.Y*s, (r.X+r.W)*s, (r.Y+r.H)*s, max(1, s/3), hex("#F08A24"))
		}
	}
	st := statsOf(is)
	if sc != nil && sc.Shape.Plain > 0 {
		if x, y, ok := plainAt(is, sc.Shape.Plain); ok {
			p := sc.Shape.Plain
			outline(img, x*s, y*s, (x+p)*s, (y+p)*s, max(1, s/4), hex("#FFE14D"))
		}
	}
	ink := color.RGBA{30, 30, 30, 255}
	y0 := is.Height*s + 6
	drawText(img, 6, y0, 2, ink, fmt.Sprintf("%s %s %s %dX%d", is.ID, strings.ToUpper(is.Name), strings.ToUpper(is.SizeClass), is.Width, is.Height))
	drawText(img, 6, y0+14, 2, ink, fmt.Sprintf("BUILD %d PLAIN %d RIV %d ISL %d MTN %d CLIFF %d LV %d/%d/%d BAY %d PEN %d", st.buildable, st.plain, st.rivers, st.islets, st.mountain, st.cliff, st.levels[0], st.levels[1], st.levels[2], st.bay, st.pen))
	return img
}

// plainAt returns the first side x side square of grass/forest.
func plainAt(is *sim.Island, side int) (int, int, bool) {
	for y := 0; y+side <= is.Height; y++ {
		for x := 0; x+side <= is.Width; x++ {
			ok := true
			for yy := y; yy < y+side && ok; yy++ {
				for xx := x; xx < x+side; xx++ {
					t := is.Tile(xx, yy).Terrain
					if t != content.TerrainGrass && t != content.TerrainForest {
						ok = false
						break
					}
				}
			}
			if ok {
				return x, y, true
			}
		}
	}
	return 0, 0, false
}

func renderOverview(a *Archipelago, c *content.Catalogue) *image.RGBA {
	x0, y0, x1, y1 := Bounds(a.Islands)
	x0, y0 = x0-20, y0-20
	w, h := x1-x0+20, y1-y0+20
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	fillRect(img, 0, 0, w, h, hex("#1F5F8B"))
	for _, is := range a.Islands {
		for y := range is.Height {
			for x := range is.Width {
				t := is.Tile(x, y)
				if t.Terrain == content.TerrainWater {
					continue
				}
				img.SetRGBA(is.X+x-x0, is.Y+y-y0, tileColour(t, false))
			}
		}
		if is.Name != "" {
			drawText(img, is.X-x0, max(0, is.Y-y0-12), 2, color.RGBA{255, 255, 255, 255}, is.ID+" "+strings.ToUpper(is.Name))
		}
	}
	fillRect(img, a.Ship.X-x0-3, a.Ship.Y-y0-3, a.Ship.X-x0+4, a.Ship.Y-y0+4, hex("#D7263D"))
	_ = c
	return img
}

// font3x5 holds 3 x 5 pixel glyphs (rows top to bottom).
func font3x5(ch rune) [5]string {
	glyphs := map[rune][5]string{
		'A': {"010", "101", "111", "101", "101"}, 'B': {"110", "101", "110", "101", "110"},
		'C': {"011", "100", "100", "100", "011"}, 'D': {"110", "101", "101", "101", "110"},
		'E': {"111", "100", "110", "100", "111"}, 'F': {"111", "100", "110", "100", "100"},
		'G': {"011", "100", "101", "101", "011"}, 'H': {"101", "101", "111", "101", "101"},
		'I': {"111", "010", "010", "010", "111"}, 'J': {"001", "001", "001", "101", "010"},
		'K': {"101", "101", "110", "101", "101"}, 'L': {"100", "100", "100", "100", "111"},
		'M': {"101", "111", "111", "101", "101"}, 'N': {"110", "101", "101", "101", "101"},
		'O': {"010", "101", "101", "101", "010"}, 'P': {"110", "101", "110", "100", "100"},
		'Q': {"010", "101", "101", "110", "011"}, 'R': {"110", "101", "110", "101", "101"},
		'S': {"011", "100", "010", "001", "110"}, 'T': {"111", "010", "010", "010", "010"},
		'U': {"101", "101", "101", "101", "111"}, 'V': {"101", "101", "101", "101", "010"},
		'W': {"101", "101", "111", "111", "101"}, 'X': {"101", "101", "010", "101", "101"},
		'Y': {"101", "101", "010", "010", "010"}, 'Z': {"111", "001", "010", "100", "111"},
		'0': {"111", "101", "101", "101", "111"}, '1': {"010", "110", "010", "010", "111"},
		'2': {"110", "001", "010", "100", "111"}, '3': {"110", "001", "010", "001", "110"},
		'4': {"101", "101", "111", "001", "001"}, '5': {"111", "100", "110", "001", "110"},
		'6': {"011", "100", "110", "101", "010"}, '7': {"111", "001", "010", "010", "010"},
		'8': {"010", "101", "010", "101", "010"}, '9': {"010", "101", "011", "001", "110"},
		'-': {"000", "000", "111", "000", "000"}, '/': {"001", "001", "010", "100", "100"},
		'.': {"000", "000", "000", "000", "010"}, '\'': {"010", "010", "000", "000", "000"},
		'%': {"101", "001", "010", "100", "101"},
	}
	return glyphs[ch]
}

func drawText(img *image.RGBA, x, y, scale int, c color.RGBA, text string) {
	for k, ch := range strings.ToUpper(text) {
		g := font3x5(ch)
		for row, bits := range g {
			for col, b := range bits {
				if b == '1' {
					fillRect(img, x+(k*4+col)*scale, y+row*scale, x+(k*4+col+1)*scale, y+(row+1)*scale, c)
				}
			}
		}
	}
}

// atlasStats generates seeds 1..n with attempt counting and logs the
// guarantee statistics: archipelago and shape retries, plain sizes,
// river and islet counts, buildable area.
func atlasStats(t *testing.T, c *content.Catalogue, n int) {
	type agg struct {
		islands                            int
		plainMin, plainSum                 int
		rivers, islets, buildable, coast   map[int]int
		buildSum, mtnSum, landSum, clifSum int
		mtnMin, mtnMax                     int // percent of land
		shoreMin, shoreMax, cliffShore     int // cliff share of the shore, percent
		shoreSum, reachMin, isletMax       int
		bays, pens                         []int
		level2                             map[int]int // level-2 share of land, by tens of percent
	}
	per := map[string]*agg{}
	archAttempts := map[int]int{}
	reasons := map[string]int{}
	var areas, extents, voids []int
	skerries, skerryTiles := 0, 0
	for seed := uint64(1); seed <= uint64(n); seed++ {
		attempts := 0
		var a *Archipelago
		for attempt := range maxAttempts {
			attempts++
			var err error
			a, err = try(seed, derive(seed, uint64(attempt)), c)
			if err == nil {
				break
			}
			msg := err.Error()
			for _, d := range "0123456789" {
				msg = strings.ReplaceAll(msg, string(d), "#")
			}
			reasons[msg]++
		}
		archAttempts[attempts]++
		if a == nil {
			t.Errorf("seed %d failed", seed)
			continue
		}
		main := Main(&c.Islands, a.Islands)
		areas = append(areas, buildableArea(main))
		x0, y0, x1, y1 := Bounds(a.Islands)
		extents = append(extents, max(x1-x0, y1-y0))
		voids = append(voids, MaxVoid(main))
		for _, is := range a.Islands[len(main):] {
			skerries++
			skerryTiles += statsOf(is).land
		}
		for _, is := range main {
			g := per[is.SizeClass]
			if g == nil {
				g = &agg{plainMin: 1 << 30, rivers: map[int]int{}, islets: map[int]int{}, buildable: map[int]int{}, coast: map[int]int{},
					mtnMin: 100, shoreMin: 100, reachMin: -1, level2: map[int]int{}}
				per[is.SizeClass] = g
			}
			st := statsOf(is)
			g.islands++
			g.plainMin = min(g.plainMin, st.plain)
			g.plainSum += st.plain
			g.rivers[st.rivers]++
			g.islets[st.islets]++
			g.buildSum += st.buildable
			g.mtnSum += st.mountain
			g.clifSum += st.cliff
			g.landSum += st.land
			mp := 100 * (st.mountain + st.cliff) / max(1, st.land)
			g.mtnMin, g.mtnMax = min(g.mtnMin, mp), max(g.mtnMax, mp)
			sp := 100 * st.cliffShore / max(1, st.cliffShore+st.beachShore)
			g.shoreMin, g.shoreMax = min(g.shoreMin, sp), max(g.shoreMax, sp)
			g.cliffShore += st.cliffShore
			g.shoreSum += st.cliffShore + st.beachShore
			if st.riverReach >= 0 && (g.reachMin < 0 || st.riverReach < g.reachMin) {
				g.reachMin = st.riverReach
			}
			g.isletMax = max(g.isletMax, st.isletMax)
			g.bays, g.pens = append(g.bays, st.bay), append(g.pens, st.pen)
			g.level2[10*st.levels[2]/max(1, st.levels[0]+st.levels[1]+st.levels[2])*10]++
		}
	}
	// Shape retries: rerun buildIsland's loop for the plans of seed 1..min(n, 50).
	shapeTries := map[string][]int{}
	for seed := uint64(1); seed <= uint64(min(n, 50)); seed++ {
		sub := derive(seed, 0)
		late := func(k int) *rng { return newRNG(derive(sub, 3+uint64(k))) }
		plans, err := planComposition(newRNG(derive(sub, 1)), late, c)
		if err != nil {
			continue
		}
		home := slices.IndexFunc(plans, func(p *plan) bool { return p.home })
		plans = append(append([]*plan{plans[home]}, plans[:home]...), plans[home+1:]...)
		for i, p := range plans {
			s := &scratch{}
			gap := slotGap(c)
			for attempt := range maxShapeAttempts {
				r := newRNG(derive(derive(sub, 100+uint64(i)), uint64(attempt)))
				g := shape(r, p.class, p.deposits, gap, s)
				if g != nil && verifyIsland(g.island(p), c) == nil {
					shapeTries[p.class.ID] = append(shapeTries[p.class.ID], attempt+1)
					break
				}
				if attempt == maxShapeAttempts-1 {
					shapeTries[p.class.ID] = append(shapeTries[p.class.ID], -1)
				}
			}
		}
	}
	t.Logf("archipelago rejections: %v", reasons)
	slices.Sort(extents)
	slices.Sort(voids)
	t.Logf("extent (longer side) min %d median %d max %d | open sea bound min %d median %d max %d (max %d) | skerries %d (mean %d tiles)",
		extents[0], extents[len(extents)/2], extents[len(extents)-1], voids[0], voids[len(voids)/2], voids[len(voids)-1], c.Islands.VoidMax,
		skerries, skerryTiles/max(1, skerries))
	slices.Sort(areas)
	t.Logf("seeds 1..%d: archipelago attempts histogram %v; buildable area min %d median %d max %d (target %d ±%d‰)",
		n, archAttempts, areas[0], areas[len(areas)/2], areas[len(areas)-1], c.Islands.BuildableTarget, c.Islands.BuildableTolerance)
	for _, sc := range c.Islands.SizeClasses {
		g := per[sc.ID]
		if g == nil {
			continue
		}
		tries := shapeTries[sc.ID]
		sum, fails, worst := 0, 0, 0
		for _, v := range tries {
			if v < 0 {
				fails++
				continue
			}
			sum += v
			worst = max(worst, v)
		}
		t.Logf("%-6s islands %4d | plain min %3d mean %3d (want %d) | rivers %v | islets %v | buildable mean %5d (%2d%% of land; mountain %2d%%, cliff %d%%) | shape attempts mean %.1f max %d fails %d (of %d, seeds 1..50)",
			sc.ID, g.islands, g.plainMin, g.plainSum/g.islands, sc.Shape.Plain, g.rivers, g.islets,
			g.buildSum/g.islands, 100*g.buildSum/max(1, g.landSum), 100*g.mtnSum/max(1, g.landSum), 100*g.clifSum/max(1, g.landSum),
			float64(sum)/float64(max(1, len(tries)-fails)), worst, fails, len(tries))
		t.Logf("%-6s mountain+cliff %d-%d%% of land | cliff shore %d-%d%% (mean %d%%) | shortest river reach %d%% of span | largest islet %d | level-2 share histogram (%%) %v",
			sc.ID, g.mtnMin, g.mtnMax, g.shoreMin, g.shoreMax, 100*g.cliffShore/max(1, g.shoreSum), g.reachMin, g.isletMax, g.level2)
		slices.Sort(g.bays)
		slices.Sort(g.pens)
		q := func(v []int) string { return fmt.Sprintf("%d/%d/%d", v[0], v[len(v)/2], v[len(v)-1]) }
		t.Logf("%-6s deepest bay %s%% of span (min/median/max) | longest peninsula %s%%", sc.ID, q(g.bays), q(g.pens))
	}
}

// TestShapeAttempts renders ATLAS_ATTEMPTS shape attempts of every size
// class of the plans of seed ATLAS_SEED (default 1) with their outcome
// (the rejecting step or verification error) and logs the reasons:
// tuning the generator.
func TestShapeAttempts(t *testing.T) {
	n, _ := strconv.Atoi(os.Getenv("ATLAS_ATTEMPTS"))
	if n <= 0 {
		t.Skip("ATLAS_ATTEMPTS not set")
	}
	c := catalogue(t)
	seed := uint64(1)
	if v, err := strconv.ParseUint(os.Getenv("ATLAS_SEED"), 10, 64); err == nil {
		seed = v
	}
	out := os.Getenv("ATLAS_OUT")
	if out == "" {
		out = filepath.Join(repoRootAtlas(), ".experiment", "islands", "attempts")
	}
	_ = os.MkdirAll(out, 0o750)
	sub := derive(seed, 0)
	late := func(k int) *rng { return newRNG(derive(sub, 3+uint64(k))) }
	plans, err := planComposition(newRNG(derive(sub, 1)), late, c)
	if err != nil {
		t.Fatal(err)
	}
	done := map[string]bool{}
	for i, p := range plans {
		if done[p.class.ID] {
			continue
		}
		done[p.class.ID] = true
		reasons := map[string]int{}
		var sheet []*image.RGBA
		s := &scratch{}
		for attempt := range n {
			r := newRNG(derive(derive(sub, 100+uint64(i)), uint64(attempt)))
			s.reject = ""
			g := shape(r, p.class, p.deposits, slotGap(c), s)
			why := s.reject
			if g != nil {
				is := g.island(p)
				is.ID, is.Name = fmt.Sprintf("a%02d", attempt), "ok"
				if err := verifyIsland(is, c); err != nil {
					why = "verify: " + err.Error()
					is.Name = strings.ReplaceAll(strings.SplitN(err.Error(), ":", 2)[0], " ", "-")
				} else {
					why = "ok"
				}
				img := renderIsland(is, c)
				writePNG(t, filepath.Join(out, fmt.Sprintf("%s-%02d.png", p.class.ID, attempt)), img)
				sheet = append(sheet, img)
			}
			reasons[why]++
		}
		if len(sheet) > 0 {
			writePNG(t, filepath.Join(out, p.class.ID+"-sheet.png"), contactSheet(sheet, 4, 2))
		}
		t.Logf("%s: %v", p.class.ID, reasons)
	}
}

// contactSheet tiles images cols wide, each shrunk by div.
func contactSheet(imgs []*image.RGBA, cols, div int) *image.RGBA {
	cw, ch := 0, 0
	for _, im := range imgs {
		cw, ch = max(cw, im.Bounds().Dx()/div), max(ch, im.Bounds().Dy()/div)
	}
	rows := (len(imgs) + cols - 1) / cols
	out := image.NewRGBA(image.Rect(0, 0, cols*cw, rows*ch))
	fillRect(out, 0, 0, cols*cw, rows*ch, hex("#F4EFE2"))
	for k, im := range imgs {
		ox, oy := (k%cols)*cw, (k/cols)*ch
		for y := 0; y < im.Bounds().Dy()/div; y++ {
			for x := 0; x < im.Bounds().Dx()/div; x++ {
				out.Set(ox+x, oy+y, im.At(x*div, y*div))
			}
		}
	}
	return out
}
