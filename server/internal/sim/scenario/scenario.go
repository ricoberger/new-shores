// Package scenario runs headless simulation scenarios: a hand-written island,
// a free seed and a list of steps that go through sim.Apply and sim.Advance.
// Scenarios are JSON documents (server/testdata/scenarios) so that golden
// reports can be shared with client tests and balancing tools.
package scenario

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"maps"
	"math"
	"path/filepath"
	"slices"
	"time"

	"github.com/ricoberger/new-shores/server/internal/content"
	"github.com/ricoberger/new-shores/server/internal/sim"
)

// DefaultContent is the content directory used when a scenario names none,
// relative to the repository root.
const DefaultContent = "content/old_coast"

// Scenario is a scenario document.
type Scenario struct {
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
	// Content is the region directory relative to the repository root.
	Content string    `json:"content,omitempty"`
	Start   time.Time `json:"start"`
	Island  Island    `json:"island"`
	Seed    Seed      `json:"seed"`
	Steps   []Step    `json:"steps"`
}

// Island is an ASCII island: one string per row, one character per tile
// ('~' water, 'c' coast, '.' grass, 'f' forest, 'm' mountain).
type Island struct {
	ID   string   `json:"id"`
	Rows []string `json:"rows"`
}

// Seed is the initial state granted free of charge.
type Seed struct {
	// Warehouse is placed without cost (optional).
	Warehouse *Placement `json:"warehouse,omitempty"`
	// Start grants the content starting stock (start.json: gold and goods)
	// after the warehouse; it excludes Gold and Stock.
	Start bool `json:"start,omitempty"`
	// Gold in units.
	Gold json.Number `json:"gold,omitempty"`
	// Stock in units per good (requires a warehouse for capacity).
	Stock map[string]json.Number `json:"stock,omitempty"`
	// Workforce grants whole phantom residents per tier to the island's
	// workforce pool (sim.GrantWorkforce). It is a seed-only grant, like the
	// free warehouse: no step can grant workforce.
	Workforce map[string]int64 `json:"workforce,omitempty"`
}

// Placement is a building position.
type Placement struct {
	Type     string `json:"type,omitempty"`
	X        int    `json:"x"`
	Y        int    `json:"y"`
	Rotation int    `json:"rotation"`
}

// Grid places Count buildings at (X + i*DX, Y + i*DY).
type Grid struct {
	Placement
	Count int `json:"count"`
	DX    int `json:"dx"`
	DY    int `json:"dy"`
}

// Road is a Manhattan L-path from From to To: horizontal first, then
// vertical, both ends inclusive. Tiles that already carry a road are
// skipped.
type Road struct {
	Type string `json:"type"`
	From [2]int `json:"from"`
	To   [2]int `json:"to"`
}

// At addresses the building covering a tile.
type At struct {
	X                 int  `json:"x"`
	Y                 int  `json:"y"`
	AcceptSurplusLoss bool `json:"accept_surplus_loss,omitempty"`
}

// MoveStep moves the building covering tile (X, Y) so that the top-left
// tile of its rotated footprint is (ToX, ToY) with the given rotation
// (sim.MoveBuilding). Like the other At steps it addresses the building by a
// covered tile, since building IDs are not written in scenarios.
type MoveStep struct {
	X        int `json:"x"`
	Y        int `json:"y"`
	ToX      int `json:"to_x"`
	ToY      int `json:"to_y"`
	Rotation int `json:"rotation"`
}

// StockGrant adds Amount units of Good to the island (fails above capacity).
type StockGrant struct {
	Good   string      `json:"good"`
	Amount json.Number `json:"amount"`
}

// AdvanceStep advances the world by Duration (Go duration syntax).
type AdvanceStep struct {
	Duration string `json:"duration"`
}

// Step is one scenario step; exactly one field must be set. Move moves the
// building covering a tile for free, keeping its ID and state (MoveStep,
// D-042).
type Step struct {
	Place      *Placement   `json:"place,omitempty"`
	PlaceGrid  *Grid        `json:"place_grid,omitempty"`
	Road       *Road        `json:"road,omitempty"`
	Demolish   *At          `json:"demolish,omitempty"`
	DemolishRd *Road        `json:"demolish_road,omitempty"`
	Pause      *At          `json:"pause,omitempty"`
	Resume     *At          `json:"resume,omitempty"`
	Upgrade    *At          `json:"upgrade,omitempty"`
	Move       *MoveStep    `json:"move,omitempty"`
	Stock      *StockGrant  `json:"stock,omitempty"`
	Advance    *AdvanceStep `json:"advance,omitempty"`
}

func (s Step) kind() (string, error) {
	var kinds []string
	for name, set := range map[string]bool{
		"place": s.Place != nil, "place_grid": s.PlaceGrid != nil, "road": s.Road != nil,
		"demolish": s.Demolish != nil, "demolish_road": s.DemolishRd != nil, "pause": s.Pause != nil,
		"resume": s.Resume != nil, "upgrade": s.Upgrade != nil, "move": s.Move != nil, "stock": s.Stock != nil, "advance": s.Advance != nil,
	} {
		if set {
			kinds = append(kinds, name)
		}
	}
	if len(kinds) != 1 {
		return "", fmt.Errorf("step must set exactly one operation, got %v", kinds)
	}
	return kinds[0], nil
}

// Load reads a scenario file from a file system, typically a directory file
// system rooted at the fixture directory (server/testdata/scenarios).
func Load(fsys fs.FS, name string) (*Scenario, error) {
	data, err := fs.ReadFile(fsys, name)
	if err != nil {
		return nil, err
	}
	return Parse(data)
}

// Parse decodes a scenario document.
func Parse(data []byte) (*Scenario, error) {
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.DisallowUnknownFields()
	dec.UseNumber()
	var s Scenario
	if err := dec.Decode(&s); err != nil {
		return nil, fmt.Errorf("parse scenario: %w", err)
	}
	if s.Content == "" {
		s.Content = DefaultContent
	}
	if s.Island.ID == "" {
		s.Island.ID = "main"
	}
	return &s, nil
}

// ContentDir returns the scenario's content directory below repoRoot.
func (s *Scenario) ContentDir(repoRoot string) string {
	return filepath.Join(repoRoot, filepath.FromSlash(s.Content))
}

// LoadContent loads the scenario's content validated against the shipped
// schemas (content/schema below repoRoot), so that test-only content
// directories need no schema copy.
func (s *Scenario) LoadContent(repoRoot string) (*content.Catalogue, error) {
	return content.LoadWithSchemas(s.ContentDir(repoRoot), filepath.Join(repoRoot, "content", "schema"))
}

// BuildWorld creates the scenario's initial world (island and seed).
func BuildWorld(s *Scenario, c *content.Catalogue, l *sim.Ledger) (*sim.World, error) {
	is, err := parseIsland(s.Island)
	if err != nil {
		return nil, err
	}
	w := sim.NewWorld(s.Start)
	w.Islands = []*sim.Island{is}
	if wh := s.Seed.Warehouse; wh != nil {
		typ := wh.Type
		if typ == "" {
			typ = firstWarehouseType(c)
		}
		if err := sim.PlaceFree(w, c, sim.PlaceBuilding{IslandID: is.ID, Type: typ, X: wh.X, Y: wh.Y, Rotation: wh.Rotation}, l); err != nil {
			return nil, fmt.Errorf("seed warehouse: %w", err)
		}
	}
	if s.Seed.Start {
		if s.Seed.Gold != "" || len(s.Seed.Stock) > 0 {
			return nil, errors.New("seed: start excludes gold and stock")
		}
		w.Gold = c.Start.Gold
		for _, g := range c.Start.Goods {
			if err := sim.AddStock(w, c, is.ID, g.Good, g.Amount, l); err != nil {
				return nil, fmt.Errorf("seed start: %w", err)
			}
		}
	}
	if s.Seed.Gold != "" {
		gold, err := content.ParseFixed(s.Seed.Gold, 3)
		if err != nil {
			return nil, fmt.Errorf("seed gold: %w", err)
		}
		w.Gold = gold
	}
	for _, good := range sortedKeys(s.Seed.Stock) {
		qty, err := content.ParseFixed(s.Seed.Stock[good], 3)
		if err != nil {
			return nil, fmt.Errorf("seed stock %s: %w", good, err)
		}
		if err := sim.AddStock(w, c, is.ID, good, qty, l); err != nil {
			return nil, fmt.Errorf("seed stock: %w", err)
		}
	}
	for _, tier := range sortedKeys(s.Seed.Workforce) {
		// Validate in whole residents before converting to milli-residents,
		// so that a negative or huge count cannot overflow into a valid one.
		n := s.Seed.Workforce[tier]
		if n < 0 || n > math.MaxInt64/content.MilliPerUnit {
			return nil, fmt.Errorf("seed workforce: %w: %s = %d residents is negative or too large", sim.ErrInvalidCommand, tier, n)
		}
		if err := sim.GrantWorkforce(w, c, is.ID, tier, n*content.MilliPerUnit); err != nil {
			return nil, fmt.Errorf("seed workforce: %w", err)
		}
	}
	return w, nil
}

// firstWarehouseType returns the first building type with a warehouse block.
func firstWarehouseType(c *content.Catalogue) string {
	for _, b := range c.Buildings {
		if b.Warehouse != nil {
			return b.ID
		}
	}
	return ""
}

func parseIsland(spec Island) (*sim.Island, error) {
	if len(spec.Rows) == 0 {
		return nil, errors.New("island has no rows")
	}
	width := len(spec.Rows[0])
	tiles := make([]sim.Tile, 0, width*len(spec.Rows))
	for y, row := range spec.Rows {
		if len(row) != width {
			return nil, fmt.Errorf("island row %d has length %d, want %d", y, len(row), width)
		}
		for x, ch := range row {
			var terrain string
			switch ch {
			case '~':
				terrain = content.TerrainWater
			case 'c':
				terrain = content.TerrainCoast
			case '.':
				terrain = content.TerrainGrass
			case 'f':
				terrain = content.TerrainForest
			case 'm':
				terrain = content.TerrainMountain
			default:
				return nil, fmt.Errorf("island tile (%d,%d): unknown symbol %q", x, y, ch)
			}
			tiles = append(tiles, sim.Tile{Terrain: terrain})
		}
	}
	return sim.NewIsland(spec.ID, width, len(spec.Rows), tiles), nil
}

func lPath(r *Road) []sim.Pos {
	var out []sim.Pos
	x0, y0, x1, y1 := r.From[0], r.From[1], r.To[0], r.To[1]
	dx := 1
	if x1 < x0 {
		dx = -1
	}
	for x := x0; ; x += dx {
		out = append(out, sim.Pos{X: x, Y: y0})
		if x == x1 {
			break
		}
	}
	dy := 1
	if y1 < y0 {
		dy = -1
	}
	for y := y0; y != y1; {
		y += dy
		out = append(out, sim.Pos{X: x1, Y: y})
	}
	return out
}

// runner holds the state of one scenario run.
type runner struct {
	s      *Scenario
	c      *content.Catalogue
	w      *sim.World
	l      *sim.Ledger
	report *Report
}

// Run executes the scenario and returns its report. A failing step fails the
// run with the step index.
func Run(s *Scenario, c *content.Catalogue) (*Report, error) {
	l := sim.NewLedger()
	w, err := BuildWorld(s, c, l)
	if err != nil {
		return nil, err
	}
	r := &runner{s: s, c: c, w: w, l: l, report: &Report{Name: s.Name, ContentVersion: c.Region.Version}}
	for i, st := range s.Steps {
		kind, err := st.kind()
		if err != nil {
			return nil, fmt.Errorf("step %d: %w", i, err)
		}
		if err := r.step(i, st); err != nil {
			return nil, fmt.Errorf("step %d (%s): %w", i, kind, err)
		}
	}
	if err := r.finish(); err != nil {
		return nil, err
	}
	return r.report, nil
}

func (r *runner) island() *sim.Island { return r.w.Island(r.s.Island.ID) }

func (r *runner) buildingAt(at *At) (*sim.Building, error) {
	b := r.island().BuildingAt(r.c, at.X, at.Y)
	if b == nil {
		return nil, fmt.Errorf("no building at (%d,%d)", at.X, at.Y)
	}
	return b, nil
}

func (r *runner) apply(cmd sim.Command) error {
	return sim.ApplyWithLedger(r.w, r.c, cmd, r.l)
}

func (r *runner) step(i int, st Step) error {
	id := r.s.Island.ID
	switch {
	case st.Place != nil:
		p := st.Place
		return r.apply(sim.PlaceBuilding{IslandID: id, Type: p.Type, X: p.X, Y: p.Y, Rotation: p.Rotation})
	case st.PlaceGrid != nil:
		g := st.PlaceGrid
		for k := 0; k < g.Count; k++ {
			if err := r.apply(sim.PlaceBuilding{IslandID: id, Type: g.Type, X: g.X + k*g.DX, Y: g.Y + k*g.DY, Rotation: g.Rotation}); err != nil {
				return fmt.Errorf("grid item %d: %w", k, err)
			}
		}
		return nil
	case st.Road != nil:
		var tiles []sim.Pos
		for _, p := range lPath(st.Road) {
			if r.island().RoadAt(p.X, p.Y) == "" {
				tiles = append(tiles, p)
			}
		}
		if len(tiles) == 0 {
			return nil
		}
		return r.apply(sim.PlaceRoad{IslandID: id, Type: st.Road.Type, Tiles: tiles})
	case st.DemolishRd != nil:
		return r.apply(sim.DemolishRoad{IslandID: id, Tiles: lPath(st.DemolishRd)})
	case st.Demolish != nil:
		b, err := r.buildingAt(st.Demolish)
		if err != nil {
			return err
		}
		return r.apply(sim.Demolish{IslandID: id, BuildingID: b.ID, AcceptSurplusLoss: st.Demolish.AcceptSurplusLoss})
	case st.Pause != nil, st.Resume != nil:
		at, paused := st.Pause, true
		if at == nil {
			at, paused = st.Resume, false
		}
		b, err := r.buildingAt(at)
		if err != nil {
			return err
		}
		return r.apply(sim.SetPaused{IslandID: id, BuildingID: b.ID, Paused: paused})
	case st.Upgrade != nil:
		b, err := r.buildingAt(st.Upgrade)
		if err != nil {
			return err
		}
		return r.apply(sim.UpgradeHouse{IslandID: id, BuildingID: b.ID})
	case st.Move != nil:
		m := st.Move
		b, err := r.buildingAt(&At{X: m.X, Y: m.Y})
		if err != nil {
			return err
		}
		return r.apply(sim.MoveBuilding{IslandID: id, BuildingID: b.ID, X: m.ToX, Y: m.ToY, Rotation: m.Rotation})
	case st.Stock != nil:
		qty, err := content.ParseFixed(st.Stock.Amount, 3)
		if err != nil {
			return err
		}
		return sim.AddStock(r.w, r.c, id, st.Stock.Good, qty, r.l)
	case st.Advance != nil:
		d, err := time.ParseDuration(st.Advance.Duration)
		if err != nil {
			return err
		}
		to := r.w.LastEvaluatedAt.Add(d)
		start := time.Now()
		bs, err := sim.AdvanceWithLedger(r.w, r.c, to, r.l)
		r.report.advanceDuration += time.Since(start)
		if err != nil {
			return err
		}
		r.report.BoundaryCount += len(bs)
		r.recordPauseEvents(bs)
		r.report.Snapshots = append(r.report.Snapshots, r.snapshot(i, len(bs)))
		return nil
	}
	return errors.New("empty step")
}

func sortedKeys[V any](m map[string]V) []string {
	return slices.Sorted(maps.Keys(m))
}
