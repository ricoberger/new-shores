// Package scenario runs headless simulation scenarios: hand-written islands
// (one island, or an archipelago of islands with positions), a free seed
// and a list of steps that go through sim.Apply and sim.Advance.
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
	// Island is the single-island form; Islands the archipelago form.
	// Exactly one of the two is set in a document; after Parse, Islands
	// holds the islands of both forms (the first island is the default of
	// every step and carries the seed).
	Island  *Island  `json:"island,omitempty"`
	Islands []Island `json:"islands,omitempty"`
	Seed    Seed     `json:"seed"`
	// DevBonus is extra gold and goods granted only to the dev server's
	// world (devworld.NewDev); BuildWorld ignores it.
	DevBonus *Bonus `json:"dev_bonus,omitempty"`
	Steps    []Step `json:"steps"`
}

// Bonus is gold and goods (units) granted on top of the seed.
type Bonus struct {
	Gold  json.Number            `json:"gold,omitempty"`
	Goods map[string]json.Number `json:"goods,omitempty"`
}

// Island is an ASCII island: one string per row, one character per tile
// ('~' water, 'c' coast, '.' grass, 'f' forest, 'm' mountain, 'I' mountain
// with an infinite iron deposit, 'S' mountain with an infinite stone
// deposit). X, Y is the archipelago position in tiles (ship travel times);
// Name the display name; Fertilities the island-wide fertility tags.
type Island struct {
	ID          string   `json:"id"`
	Name        string   `json:"name,omitempty"`
	X           int      `json:"x,omitempty"`
	Y           int      `json:"y,omitempty"`
	Fertilities []string `json:"fertilities,omitempty"`
	Rows        []string `json:"rows"`
}

// maxPosition bounds archipelago positions (tiles).
const maxPosition = 1_000_000

// Seed is the initial state granted free of charge.
type Seed struct {
	// TradingPost is placed without cost (optional); Type defaults to the
	// first building with a trading_post block.
	TradingPost *Placement `json:"trading_post,omitempty"`
	// Start grants the content starting stock (start.json: gold and goods)
	// after the Trading Post; it excludes Gold and Stock.
	Start bool `json:"start,omitempty"`
	// Gold in units.
	Gold json.Number `json:"gold,omitempty"`
	// Stock in units per good (requires a Trading Post for capacity).
	Stock map[string]json.Number `json:"stock,omitempty"`
	// Workforce grants whole phantom residents per tier to the island's
	// workforce pool (sim.GrantWorkforce). It is a seed-only grant, like the
	// free Trading Post: no step can grant workforce.
	Workforce map[string]int64 `json:"workforce,omitempty"`
}

// Placement is a building position. Island defaults to the first island.
type Placement struct {
	Island   string `json:"island,omitempty"`
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
	Island string `json:"island,omitempty"`
	Type   string `json:"type"`
	From   [2]int `json:"from"`
	To     [2]int `json:"to"`
}

// At addresses the building covering a tile.
type At struct {
	Island            string `json:"island,omitempty"`
	X                 int    `json:"x"`
	Y                 int    `json:"y"`
	AcceptSurplusLoss bool   `json:"accept_surplus_loss,omitempty"`
}

// MoveStep moves the building covering tile (X, Y) so that the top-left
// tile of its rotated footprint is (ToX, ToY) with the given rotation
// (sim.MoveBuilding). Like the other At steps it addresses the building by a
// covered tile, since building IDs are not written in scenarios.
type MoveStep struct {
	Island   string `json:"island,omitempty"`
	X        int    `json:"x"`
	Y        int    `json:"y"`
	ToX      int    `json:"to_x"`
	ToY      int    `json:"to_y"`
	Rotation int    `json:"rotation"`
}

// FieldsStep places fields of the field building Type (sim.PlaceFields,
// D-049). Exactly one of Rect and Tiles is set. Rect [x0, y0, x1, y1] is a
// rectangle with inclusive corners in any order: the step places a field on
// every tile of it, in row-major order, that is a valid field site at that
// moment (sim.ValidFieldTiles, the rule the client's rectangle drag
// mirrors) and fails when no tile is valid. Tiles ([x, y] pairs) are sent
// verbatim.
type FieldsStep struct {
	Island string   `json:"island,omitempty"`
	Type   string   `json:"type"`
	Rect   *[4]int  `json:"rect,omitempty"`
	Tiles  [][2]int `json:"tiles,omitempty"`
}

// DemolishFieldsStep demolishes the fields on Tiles ([x, y] pairs,
// sim.DemolishFields).
type DemolishFieldsStep struct {
	Island string   `json:"island,omitempty"`
	Tiles  [][2]int `json:"tiles"`
}

// StockGrant adds Amount units of Good to the island (fails above capacity).
type StockGrant struct {
	Island string      `json:"island,omitempty"`
	Good   string      `json:"good"`
	Amount json.Number `json:"amount"`
}

// OrderShipStep orders a ship at the shipyard covering tile (X, Y).
type OrderShipStep struct {
	Island   string `json:"island,omitempty"`
	X        int    `json:"x"`
	Y        int    `json:"y"`
	ShipType string `json:"ship_type"`
}

// RouteStep creates (Route 0), updates or deletes (Stops empty) a route.
// Load maximums are in units.
type RouteStep struct {
	Route int64           `json:"route,omitempty"`
	Name  string          `json:"name,omitempty"`
	Stops []RouteStopSpec `json:"stops,omitempty"`
}

// RouteStopSpec is a route stop; Load maps goods to the maximum aboard in
// units.
type RouteStopSpec struct {
	Island string                 `json:"island"`
	Load   map[string]json.Number `json:"load,omitempty"`
	Unload []string               `json:"unload,omitempty"`
}

// ShipStep addresses a ship (and a route for assign_ship) by sequential ID.
type ShipStep struct {
	Ship  int64 `json:"ship"`
	Route int64 `json:"route,omitempty"`
}

// ShipmentStep sends a ship to island To with cargo in units.
type ShipmentStep struct {
	Ship  int64                  `json:"ship"`
	To    string                 `json:"to"`
	Cargo map[string]json.Number `json:"cargo,omitempty"`
}

// FoundStep founds Island with a Trading Post (Type defaults to the first
// trading_post building) from the cargo of Ship.
type FoundStep struct {
	Ship     int64  `json:"ship"`
	Island   string `json:"island"`
	Type     string `json:"type,omitempty"`
	X        int    `json:"x"`
	Y        int    `json:"y"`
	Rotation int    `json:"rotation"`
}

// AdvanceStep advances the world by Duration (Go duration syntax).
type AdvanceStep struct {
	Duration string `json:"duration"`
}

// ClaimStep claims the rewards of a completed quest; Island receives
// reward goods (required for quests that reward goods).
type ClaimStep struct {
	Quest  string `json:"quest"`
	Island string `json:"island,omitempty"`
}

// Step is one scenario step; exactly one operation must be set. Move moves
// the building covering a tile for free, keeping its ID and state
// (MoveStep, D-042). Ships and routes are addressed by their sequential
// IDs. ExpectError (a sentinel's snake_case name, e.g. "no_deposit", the
// API error code) turns the step into an expected failure: it must fail
// with that sentinel and leave the world byte-identical.
type Step struct {
	ExpectError string `json:"expect_error,omitempty"`

	UpgradeWarehouse   *At `json:"upgrade_warehouse,omitempty"`
	UpgradeTradingPost *At `json:"upgrade_trading_post,omitempty"`

	OrderShip       *OrderShipStep `json:"order_ship,omitempty"`
	CancelShipOrder *At            `json:"cancel_ship_order,omitempty"`
	CreateRoute     *RouteStep     `json:"create_route,omitempty"`
	UpdateRoute     *RouteStep     `json:"update_route,omitempty"`
	DeleteRoute     *RouteStep     `json:"delete_route,omitempty"`
	AssignShip      *ShipStep      `json:"assign_ship,omitempty"`
	UnassignShip    *ShipStep      `json:"unassign_ship,omitempty"`
	ManualShipment  *ShipmentStep  `json:"manual_shipment,omitempty"`
	FoundIsland     *FoundStep     `json:"found_island,omitempty"`
	ScrapShip       *ShipStep      `json:"scrap_ship,omitempty"`
	ClaimQuest      *ClaimStep     `json:"claim_quest,omitempty"`
	// AwaySummary (true) produces the "while you were away" summary over
	// the time since the last command step, stores it as the world's
	// pending summary and writes it into the report. Advance steps never
	// produce one.
	AwaySummary bool `json:"away_summary,omitempty"`

	Place      *Placement  `json:"place,omitempty"`
	PlaceGrid  *Grid       `json:"place_grid,omitempty"`
	Road       *Road       `json:"road,omitempty"`
	Demolish   *At         `json:"demolish,omitempty"`
	DemolishRd *Road       `json:"demolish_road,omitempty"`
	Pause      *At         `json:"pause,omitempty"`
	Resume     *At         `json:"resume,omitempty"`
	Upgrade    *At         `json:"upgrade,omitempty"`
	Move       *MoveStep   `json:"move,omitempty"`
	Fields     *FieldsStep `json:"fields,omitempty"`
	// DemolishFields removes fields (sim.DemolishFields).
	DemolishFields *DemolishFieldsStep `json:"demolish_fields,omitempty"`
	Stock          *StockGrant         `json:"stock,omitempty"`
	Advance        *AdvanceStep        `json:"advance,omitempty"`
}

func (s Step) kind() (string, error) {
	var kinds []string
	for name, set := range map[string]bool{
		"place": s.Place != nil, "place_grid": s.PlaceGrid != nil, "road": s.Road != nil,
		"demolish": s.Demolish != nil, "demolish_road": s.DemolishRd != nil, "pause": s.Pause != nil,
		"resume": s.Resume != nil, "upgrade": s.Upgrade != nil, "move": s.Move != nil, "fields": s.Fields != nil, "demolish_fields": s.DemolishFields != nil, "stock": s.Stock != nil, "advance": s.Advance != nil,
		"order_ship": s.OrderShip != nil, "cancel_ship_order": s.CancelShipOrder != nil, "create_route": s.CreateRoute != nil,
		"update_route": s.UpdateRoute != nil, "delete_route": s.DeleteRoute != nil, "assign_ship": s.AssignShip != nil,
		"unassign_ship": s.UnassignShip != nil, "manual_shipment": s.ManualShipment != nil, "found_island": s.FoundIsland != nil,
		"scrap_ship": s.ScrapShip != nil, "upgrade_warehouse": s.UpgradeWarehouse != nil, "upgrade_trading_post": s.UpgradeTradingPost != nil,
		"claim_quest": s.ClaimQuest != nil, "away_summary": s.AwaySummary,
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
	switch {
	case s.Island != nil && len(s.Islands) > 0:
		return nil, errors.New("parse scenario: set either island or islands, not both")
	case s.Island != nil:
		if s.Island.ID == "" {
			s.Island.ID = "main"
		}
		s.Islands = []Island{*s.Island}
	case len(s.Islands) == 0:
		return nil, errors.New("parse scenario: no island")
	}
	seen := map[string]bool{}
	for i, is := range s.Islands {
		switch {
		case is.ID == "":
			return nil, fmt.Errorf("parse scenario: island %d has no id", i)
		case seen[is.ID]:
			return nil, fmt.Errorf("parse scenario: duplicate island %q", is.ID)
		case is.X < -maxPosition || is.X > maxPosition || is.Y < -maxPosition || is.Y > maxPosition:
			return nil, fmt.Errorf("parse scenario: island %q position out of range", is.ID)
		}
		seen[is.ID] = true
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
	if len(s.Islands) == 0 {
		return nil, errors.New("scenario has no island (use Parse)")
	}
	w := sim.NewWorld(s.Start)
	for _, spec := range s.Islands {
		is, err := parseIsland(spec)
		if err != nil {
			return nil, err
		}
		w.Islands = append(w.Islands, is)
	}
	is := w.Islands[0]
	if wh := s.Seed.TradingPost; wh != nil {
		typ := wh.Type
		if typ == "" {
			typ = firstTradingPostType(c)
		}
		if err := sim.PlaceFree(w, c, sim.PlaceBuilding{IslandID: is.ID, Type: typ, X: wh.X, Y: wh.Y, Rotation: wh.Rotation}, l); err != nil {
			return nil, fmt.Errorf("seed trading post: %w", err)
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

// RunSteps builds the scenario's world and executes its first n steps
// (advances included, expected failures checked) without a report. Tests
// use it to continue a scenario's world elsewhere, e.g. over the API.
func RunSteps(s *Scenario, c *content.Catalogue, n int) (*sim.World, error) {
	if n < 0 || n > len(s.Steps) {
		return nil, fmt.Errorf("run steps: %d of %d", n, len(s.Steps))
	}
	l := sim.NewLedger()
	w, err := BuildWorld(s, c, l)
	if err != nil {
		return nil, err
	}
	r := &runner{s: s, c: c, w: w, l: l, report: &Report{Name: s.Name}}
	for i, st := range s.Steps[:n] {
		var err error
		if st.ExpectError != "" {
			err = r.expectError(i, st)
		} else {
			err = r.step(i, st)
		}
		if err != nil {
			return nil, fmt.Errorf("step %d: %w", i, err)
		}
	}
	return w, nil
}

// ApplyBonus grants the dev bonus of a scenario (gold and goods on the first
// island). Gold adds to the seeded gold.
func ApplyBonus(s *Scenario, c *content.Catalogue, w *sim.World, l *sim.Ledger) error {
	b := s.DevBonus
	if b == nil {
		return nil
	}
	if b.Gold != "" {
		gold, err := content.ParseFixed(b.Gold, 3)
		if err != nil || gold < 0 {
			return fmt.Errorf("dev bonus gold: %v", err)
		}
		w.Gold += gold
	}
	for _, good := range sortedKeys(b.Goods) {
		qty, err := content.ParseFixed(b.Goods[good], 3)
		if err != nil {
			return fmt.Errorf("dev bonus %s: %w", good, err)
		}
		if err := sim.AddStock(w, c, w.Islands[0].ID, good, qty, l); err != nil {
			return fmt.Errorf("dev bonus: %w", err)
		}
	}
	return nil
}

// firstTradingPostType returns the first building type with a
// trading_post block.
func firstTradingPostType(c *content.Catalogue) string {
	for _, b := range c.Buildings {
		if b.TradingPost != nil {
			return b.ID
		}
	}
	return ""
}

func parseIsland(spec Island) (*sim.Island, error) {
	if len(spec.Rows) == 0 {
		return nil, fmt.Errorf("island %q has no rows", spec.ID)
	}
	width := len(spec.Rows[0])
	tiles := make([]sim.Tile, 0, width*len(spec.Rows))
	for y, row := range spec.Rows {
		if len(row) != width {
			return nil, fmt.Errorf("island %q row %d has length %d, want %d", spec.ID, y, len(row), width)
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
			case 'm', 'I', 'S':
				terrain = content.TerrainMountain
			default:
				return nil, fmt.Errorf("island %q tile (%d,%d): unknown symbol %q", spec.ID, x, y, ch)
			}
			tile := sim.Tile{Terrain: terrain}
			switch ch {
			case 'I':
				tile.Deposit = &sim.Deposit{Kind: "iron", Quantity: -1}
			case 'S':
				tile.Deposit = &sim.Deposit{Kind: "stone", Quantity: -1}
			}
			tiles = append(tiles, tile)
		}
	}
	is := sim.NewIsland(spec.ID, width, len(spec.Rows), tiles)
	is.Name, is.X, is.Y = spec.Name, spec.X, spec.Y
	if len(spec.Fertilities) > 0 {
		is.Fertilities = slices.Clone(spec.Fertilities)
	}
	return is, nil
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
		if st.ExpectError != "" {
			if err := r.expectError(i, st); err != nil {
				return nil, fmt.Errorf("step %d (%s): %w", i, kind, err)
			}
			continue
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

// islandID resolves a step's island ("" = the first island).
func (r *runner) islandID(id string) string {
	if id == "" {
		return r.s.Islands[0].ID
	}
	return id
}

func (r *runner) island() *sim.Island { return r.w.Island(r.s.Islands[0].ID) }

func (r *runner) buildingAt(at *At) (string, *sim.Building, error) {
	id := r.islandID(at.Island)
	is := r.w.Island(id)
	if is == nil {
		return "", nil, fmt.Errorf("%w: %q", sim.ErrUnknownIsland, id)
	}
	b := is.BuildingAt(r.c, at.X, at.Y)
	if b == nil {
		return "", nil, fmt.Errorf("no building at (%d,%d) on %q", at.X, at.Y, id)
	}
	return id, b, nil
}

// apply applies a player command; like a real command it sets the
// world's last seen time when it succeeds.
func (r *runner) apply(cmd sim.Command) error {
	if err := sim.ApplyWithLedger(r.w, r.c, cmd, r.l); err != nil {
		return err
	}
	sim.MarkSeen(r.w)
	return nil
}

// parseUnits converts unit amounts of a scenario to milli-units.
func parseUnits(n json.Number) (int64, error) { return content.ParseFixed(n, 3) }

func (r *runner) stops(specs []RouteStopSpec) ([]sim.Stop, error) {
	var out []sim.Stop
	for _, sp := range specs {
		st := sim.Stop{IslandID: sp.Island, Unload: sp.Unload}
		for _, g := range sortedKeys(sp.Load) {
			v, err := parseUnits(sp.Load[g])
			if err != nil {
				return nil, fmt.Errorf("load %s: %w", g, err)
			}
			st.Load = append(st.Load, sim.LoadRule{Good: g, MaxAmount: v})
		}
		out = append(out, st)
	}
	return out, nil
}

func (r *runner) step(i int, st Step) error {
	switch {
	case st.Place != nil:
		p := st.Place
		return r.apply(sim.PlaceBuilding{IslandID: r.islandID(p.Island), Type: p.Type, X: p.X, Y: p.Y, Rotation: p.Rotation})
	case st.PlaceGrid != nil:
		g := st.PlaceGrid
		for k := 0; k < g.Count; k++ {
			if err := r.apply(sim.PlaceBuilding{IslandID: r.islandID(g.Island), Type: g.Type, X: g.X + k*g.DX, Y: g.Y + k*g.DY, Rotation: g.Rotation}); err != nil {
				return fmt.Errorf("grid item %d: %w", k, err)
			}
		}
		return nil
	case st.Road != nil:
		id := r.islandID(st.Road.Island)
		is := r.w.Island(id)
		if is == nil {
			return fmt.Errorf("%w: %q", sim.ErrUnknownIsland, id)
		}
		var tiles []sim.Pos
		for _, p := range lPath(st.Road) {
			if is.RoadAt(p.X, p.Y) == "" {
				tiles = append(tiles, p)
			}
		}
		if len(tiles) == 0 {
			return nil
		}
		return r.apply(sim.PlaceRoad{IslandID: id, Type: st.Road.Type, Tiles: tiles})
	case st.DemolishRd != nil:
		return r.apply(sim.DemolishRoad{IslandID: r.islandID(st.DemolishRd.Island), Tiles: lPath(st.DemolishRd)})
	case st.Demolish != nil:
		id, b, err := r.buildingAt(st.Demolish)
		if err != nil {
			return err
		}
		return r.apply(sim.Demolish{IslandID: id, BuildingID: b.ID, AcceptSurplusLoss: st.Demolish.AcceptSurplusLoss})
	case st.Pause != nil, st.Resume != nil:
		at, paused := st.Pause, true
		if at == nil {
			at, paused = st.Resume, false
		}
		id, b, err := r.buildingAt(at)
		if err != nil {
			return err
		}
		return r.apply(sim.SetPaused{IslandID: id, BuildingID: b.ID, Paused: paused})
	case st.UpgradeWarehouse != nil:
		id, b, err := r.buildingAt(st.UpgradeWarehouse)
		if err != nil {
			return err
		}
		return r.apply(sim.UpgradeWarehouse{IslandID: id, BuildingID: b.ID})
	case st.UpgradeTradingPost != nil:
		id, b, err := r.buildingAt(st.UpgradeTradingPost)
		if err != nil {
			return err
		}
		return r.apply(sim.UpgradeTradingPost{IslandID: id, BuildingID: b.ID})
	case st.Upgrade != nil:
		id, b, err := r.buildingAt(st.Upgrade)
		if err != nil {
			return err
		}
		return r.apply(sim.UpgradeHouse{IslandID: id, BuildingID: b.ID})
	case st.Move != nil:
		m := st.Move
		id, b, err := r.buildingAt(&At{Island: m.Island, X: m.X, Y: m.Y})
		if err != nil {
			return err
		}
		return r.apply(sim.MoveBuilding{IslandID: id, BuildingID: b.ID, X: m.ToX, Y: m.ToY, Rotation: m.Rotation})
	case st.Fields != nil:
		return r.fields(st.Fields)
	case st.DemolishFields != nil:
		var tiles []sim.Pos
		for _, t := range st.DemolishFields.Tiles {
			tiles = append(tiles, sim.Pos{X: t[0], Y: t[1]})
		}
		return r.apply(sim.DemolishFields{IslandID: r.islandID(st.DemolishFields.Island), Tiles: tiles})
	case st.Stock != nil:
		qty, err := parseUnits(st.Stock.Amount)
		if err != nil {
			return err
		}
		return sim.AddStock(r.w, r.c, r.islandID(st.Stock.Island), st.Stock.Good, qty, r.l)
	case st.OrderShip != nil:
		o := st.OrderShip
		id, b, err := r.buildingAt(&At{Island: o.Island, X: o.X, Y: o.Y})
		if err != nil {
			return err
		}
		return r.apply(sim.OrderShip{IslandID: id, BuildingID: b.ID, ShipType: o.ShipType})
	case st.CancelShipOrder != nil:
		id, b, err := r.buildingAt(st.CancelShipOrder)
		if err != nil {
			return err
		}
		return r.apply(sim.CancelShipOrder{IslandID: id, BuildingID: b.ID})
	case st.CreateRoute != nil, st.UpdateRoute != nil:
		rs := st.CreateRoute
		if rs == nil {
			rs = st.UpdateRoute
		}
		stops, err := r.stops(rs.Stops)
		if err != nil {
			return err
		}
		if st.CreateRoute != nil {
			return r.apply(sim.CreateRoute{Name: rs.Name, Stops: stops})
		}
		return r.apply(sim.UpdateRoute{RouteID: rs.Route, Name: rs.Name, Stops: stops})
	case st.DeleteRoute != nil:
		return r.apply(sim.DeleteRoute{RouteID: st.DeleteRoute.Route})
	case st.AssignShip != nil:
		return r.apply(sim.AssignShip{ShipID: st.AssignShip.Ship, RouteID: st.AssignShip.Route})
	case st.UnassignShip != nil:
		return r.apply(sim.UnassignShip{ShipID: st.UnassignShip.Ship})
	case st.ScrapShip != nil:
		return r.apply(sim.ScrapShip{ShipID: st.ScrapShip.Ship})
	case st.ManualShipment != nil:
		m := st.ManualShipment
		var cargo []sim.CargoAmount
		for _, g := range sortedKeys(m.Cargo) {
			v, err := parseUnits(m.Cargo[g])
			if err != nil {
				return fmt.Errorf("cargo %s: %w", g, err)
			}
			cargo = append(cargo, sim.CargoAmount{Good: g, Amount: v})
		}
		return r.apply(sim.ManualShipment{ShipID: m.Ship, ToIslandID: m.To, Cargo: cargo})
	case st.FoundIsland != nil:
		f := st.FoundIsland
		typ := f.Type
		if typ == "" {
			typ = firstTradingPostType(r.c)
		}
		return r.apply(sim.FoundIsland{ShipID: f.Ship, IslandID: f.Island, BuildingType: typ, X: f.X, Y: f.Y, Rotation: f.Rotation})
	case st.ClaimQuest != nil:
		cq := st.ClaimQuest
		if err := r.apply(sim.ClaimQuest{QuestID: cq.Quest, IslandID: cq.Island}); err != nil {
			return err
		}
		r.report.claimedAt(cq.Quest, r.w.LastEvaluatedAt)
		return nil
	case st.AwaySummary:
		// Like a request after the gap: the summary becomes the world's
		// pending summary (shown by Display) and is reported.
		sum := sim.ProduceSummary(r.w, r.c)
		r.w.PendingSummary = sum
		r.report.AwaySummaries = append(r.report.AwaySummaries, *sum)
		return nil
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

// fields places the fields of a fields step.
func (r *runner) fields(f *FieldsStep) error {
	id := r.islandID(f.Island)
	is := r.w.Island(id)
	if is == nil {
		return fmt.Errorf("%w: %q", sim.ErrUnknownIsland, id)
	}
	var tiles []sim.Pos
	switch {
	case (f.Rect == nil) == (len(f.Tiles) == 0):
		return errors.New("fields: set exactly one of rect and tiles")
	case f.Rect != nil:
		x0, y0, x1, y1 := f.Rect[0], f.Rect[1], f.Rect[2], f.Rect[3]
		if x0 > x1 {
			x0, x1 = x1, x0
		}
		if y0 > y1 {
			y0, y1 = y1, y0
		}
		var rect []sim.Pos
		for y := y0; y <= y1; y++ {
			for x := x0; x <= x1; x++ {
				rect = append(rect, sim.Pos{X: x, Y: y})
			}
		}
		tiles = sim.ValidFieldTiles(is, r.c, f.Type, rect)
		if len(tiles) == 0 {
			return fmt.Errorf("fields: no valid %s tile in rect %v", f.Type, *f.Rect)
		}
	default:
		for _, t := range f.Tiles {
			tiles = append(tiles, sim.Pos{X: t[0], Y: t[1]})
		}
	}
	return r.apply(sim.PlaceFields{IslandID: id, Type: f.Type, Tiles: tiles})
}

// expectError runs a step that must fail with the sentinel named by
// st.ExpectError and must leave the encoded world unchanged; the failure is
// recorded in the report. Advance steps cannot be expected to fail.
func (r *runner) expectError(i int, st Step) error {
	want, ok := Sentinels()[st.ExpectError]
	if !ok {
		return fmt.Errorf("expect_error: unknown sentinel %q", st.ExpectError)
	}
	if st.Advance != nil {
		return errors.New("expect_error: advance steps cannot fail")
	}
	before, err := sim.Encode(r.w, r.c.Region.Version)
	if err != nil {
		return err
	}
	err = r.step(i, st)
	switch {
	case err == nil:
		return fmt.Errorf("expected %s, step succeeded", st.ExpectError)
	case !errors.Is(err, want):
		return fmt.Errorf("expected %s, got: %w", st.ExpectError, err)
	}
	after, encErr := sim.Encode(r.w, r.c.Region.Version)
	if encErr != nil {
		return encErr
	}
	if !bytes.Equal(before, after) {
		return fmt.Errorf("failed with %s but changed the world", st.ExpectError)
	}
	r.report.ExpectedErrors = append(r.report.ExpectedErrors, ExpectedError{Step: i, Error: st.ExpectError, Message: err.Error()})
	return nil
}

// Sentinels maps the snake_case name of every simulation sentinel (its
// name without the Err prefix; the API error code) to the sentinel, for
// expect_error steps.
func Sentinels() map[string]error {
	return map[string]error{
		"unknown_island": sim.ErrUnknownIsland, "unknown_building": sim.ErrUnknownBuilding,
		"building_not_found": sim.ErrBuildingNotFound, "invalid_command": sim.ErrInvalidCommand,
		"out_of_bounds": sim.ErrOutOfBounds, "occupied": sim.ErrOccupied, "terrain": sim.ErrTerrain,
		"not_coastal": sim.ErrNotCoastal, "not_on_water": sim.ErrNotOnWater, "no_work_area": sim.ErrNoWorkArea, "no_fertility": sim.ErrNoFertility,
		"no_deposit": sim.ErrNoDeposit, "insufficient_gold": sim.ErrInsufficientGold,
		"insufficient_materials": sim.ErrInsufficientMaterials, "surplus_loss": sim.ErrSurplusLoss,
		"not_pausable": sim.ErrNotPausable, "no_road": sim.ErrNoRoad, "over_capacity": sim.ErrOverCapacity,
		"time_backwards": sim.ErrTimeBackwards, "schema_version": sim.ErrSchemaVersion,
		"display_time": sim.ErrDisplayTime, "tier_locked": sim.ErrTierLocked, "not_a_house": sim.ErrNotAHouse,
		"upgrade_unavailable": sim.ErrUpgradeUnavailable, "house_not_full": sim.ErrHouseNotFull,
		"needs_unmet": sim.ErrNeedsUnmet, "upgrade_only": sim.ErrUpgradeOnly, "shipyard_busy": sim.ErrShipyardBusy,
		"not_a_shipyard": sim.ErrNotAShipyard, "unknown_ship_type": sim.ErrUnknownShipType,
		"no_ship_order": sim.ErrNoShipOrder, "ship_not_found": sim.ErrShipNotFound, "ship_not_idle": sim.ErrShipNotIdle,
		"ship_not_on_route": sim.ErrShipNotOnRoute, "route_not_found": sim.ErrRouteNotFound,
		"route_invalid": sim.ErrRouteInvalid, "route_in_use": sim.ErrRouteInUse,
		"island_already_settled": sim.ErrIslandAlreadySettled, "island_not_settled": sim.ErrIslandNotSettled,
		"cargo_insufficient": sim.ErrCargoInsufficient, "cargo_exceeds_slots": sim.ErrCargoExceedsSlots,
		"last_trading_post": sim.ErrLastTradingPost, "not_connected": sim.ErrNotConnected,
		"quest_not_found": sim.ErrQuestNotFound, "quest_not_completed": sim.ErrQuestNotCompleted,
		"quest_already_claimed": sim.ErrQuestAlreadyClaimed,
		"no_farm_in_range":      sim.ErrNoFarmInRange, "field_type_mismatch": sim.ErrFieldTypeMismatch,
		"not_a_field": sim.ErrNotAField,
	}
}

func sortedKeys[V any](m map[string]V) []string {
	return slices.Sorted(maps.Keys(m))
}
