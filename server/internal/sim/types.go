// Package sim is the pure, deterministic island simulation (docs/MECHANICS.md).
//
// The package performs no I/O, never reads the wall clock and uses no
// randomness: Apply validates and executes player commands, Advance moves a
// world forward in time with a piecewise-constant-rate model and Display
// derives the client payload. Behaviour is driven entirely by the content
// Catalogue (capability blocks on buildings); there is no building-specific
// code.
//
// # Units
//
// Quantities (goods, gold, residents) are fixed-point milli-units (Qty, 1 unit
// = 1000). Internally the simulation accounts goods in sub-milli units
// (SubPerMilli per milli-unit) so that every production, consumption and
// transfer rate is an exact integer per millisecond; inventories keep the
// sub-milli remainder next to the milli-unit stock. Durations are integer
// milliseconds and timestamps are UTC with millisecond precision.
//
// Gold is accounted in GoldSubPerMilli sub-units per milli-gold, so that a
// rate of n sub-units per millisecond is exactly n milli-gold per minute.
// Houses grow through a signed accumulator in ResidentSub units per resident.
// Ratios (satisfaction, fulfilment, variety multiplier, workforce factor) are
// parts per million (ppm) internally and per-mille in the display.
package sim

import (
	"maps"
	"time"

	"github.com/ricoberger/new-shores/server/internal/content"
)

// Qty is a fixed-point quantity in milli-units (1 unit = 1000).
type Qty = content.Qty

// SubPerMilli is the number of internal sub-milli units per milli-unit.
//
// It is chosen so that the nominal progress rate SubPerMilli / cycle_ms is an
// integer for every cycle length that divides 360 s (30, 40, 45, 60, 90,
// 120 s, ...), and so that a warehouse throughput in milli-units per minute
// converts to an integer sub-milli rate per millisecond.
const SubPerMilli int64 = 360_000_000

// msPerMinute is the number of milliseconds in a minute.
const msPerMinute = 60_000

// GoldSubPerMilli is the number of internal gold sub-units per milli-gold.
// A gold rate of n sub-units per millisecond equals n milli-gold per minute,
// so upkeep and tax rates in milli-gold per minute are exact per-ms rates.
const GoldSubPerMilli int64 = msPerMinute

// ResidentSub is the number of growth accumulator units per resident. A rate
// of 1 milli-resident per minute is exactly 1000 units per millisecond.
const ResidentSub int64 = 60_000_000_000

// ppm is the fixed-point scale of ratios (parts per million).
const ppm = 1_000_000

// Paused reasons (MECHANICS §7).
const (
	PausedReasonPlayer = "player"
	PausedReasonUnpaid = "unpaid"
)

// World is the complete simulation state of one player.
type World struct {
	Islands []*Island `json:"islands"`
	// Gold in milli-gold. World-level, shared by all islands.
	Gold Qty `json:"gold"`
	// GoldSub is the gold remainder in [0, GoldSubPerMilli).
	GoldSub         int64     `json:"gold_sub,omitempty"`
	LastEvaluatedAt time.Time `json:"last_evaluated_at"`
	// NextBuildingID is the ID assigned to the next placed building.
	// Building IDs are sequential per world (deterministic, no UUIDs).
	NextBuildingID int64 `json:"next_building_id"`
	// RNGState is the seed of the world's deterministic RNG. Unused by this
	// slice; reserved for event handlers (MECHANICS §1.2).
	RNGState uint64 `json:"rng_state"`
	// PauseSeq is the sequence number of the last insolvency pause
	// (world-wide, monotonic); auto-resume goes in reverse order.
	PauseSeq int64 `json:"pause_seq,omitempty"`
	// UnlockedTiers lists the tiers unlocked by their unlock conditions in
	// progression order. The first tier is always unlocked and not listed.
	// Unlocks are permanent (MECHANICS §12).
	UnlockedTiers []string `json:"unlocked_tiers,omitempty"`
}

// Island is a tile grid with its buildings, roads and shared inventory.
type Island struct {
	ID     string `json:"id"`
	Width  int    `json:"width"`
	Height int    `json:"height"`
	// Tiles in row-major order (index = y*Width + x).
	Tiles []Tile `json:"tiles"`
	// Roads maps a tile index to the road type (content ID). Tiles without a
	// road are absent.
	Roads map[int]string `json:"roads,omitempty"`
	// Buildings sorted by ascending ID.
	Buildings []*Building `json:"buildings,omitempty"`
	Inventory Inventory   `json:"inventory"`
}

// Tile is one map tile.
type Tile struct {
	// Terrain is one of the content.Terrain* constants.
	Terrain   string   `json:"terrain"`
	Fertility []string `json:"fertility,omitempty"`
	Deposit   *Deposit `json:"deposit,omitempty"`
}

// Deposit is a resource deposit on a tile.
type Deposit struct {
	Kind string `json:"kind"`
	// Quantity in milli-units; -1 means infinite.
	Quantity int64 `json:"quantity"`
}

// Inventory is the island-wide shared stock (D-014). Capacity is derived from
// the island's warehouses and never stored.
type Inventory struct {
	// Stock in milli-units per good.
	Stock map[string]Qty `json:"stock,omitempty"`
	// StockSub is the sub-milli remainder per good, in [0, SubPerMilli).
	StockSub map[string]int64 `json:"stock_sub,omitempty"`
	// Starved marks goods in the input-starved regime: consumers are limited
	// to the arrival rate of the good.
	Starved map[string]bool `json:"starved,omitempty"`
	// Full marks goods in the warehouse-full regime: producers are limited to
	// the consumption rate of the good.
	Full map[string]bool `json:"full,omitempty"`
}

// Building is a placed building.
type Building struct {
	ID int64 `json:"id"`
	// Type is the content building ID.
	Type string `json:"type"`
	// X, Y is the top-left tile of the rotated footprint.
	X int `json:"x"`
	Y int `json:"y"`
	// Rotation in degrees: 0, 90, 180 or 270.
	Rotation     int    `json:"rotation"`
	Paused       bool   `json:"paused,omitempty"`
	PausedReason string `json:"paused_reason,omitempty"`
	// PauseSeq is the world pause sequence number of an insolvency pause
	// (0 unless PausedReason is unpaid).
	PauseSeq int64 `json:"pause_seq,omitempty"`
	// Efficiency in per-mille from the work area (1000 without work area).
	Efficiency int64 `json:"efficiency"`
	// Level of a warehouse (1-based); 0 for other buildings.
	Level int `json:"level,omitempty"`

	// AssignedWarehouseID is the warehouse a producer delivers to; 0 when
	// the producer is not connected.
	AssignedWarehouseID int64 `json:"assigned_warehouse_id,omitempty"`
	// RoadDistance is the road distance in tiles to the assigned warehouse.
	RoadDistance int `json:"road_distance,omitempty"`
	// TransferDelayMs is the delivery latency to the assigned warehouse.
	TransferDelayMs int64 `json:"transfer_delay_ms,omitempty"`

	// Progress is the production cycle accumulator in [0, SubPerMilli);
	// one full cycle at 100 % corresponds to SubPerMilli.
	Progress int64 `json:"progress,omitempty"`
	// Buffer holds the output of an unconnected producer (milli-units and
	// sub-milli remainder).
	Buffer    map[string]Qty   `json:"buffer,omitempty"`
	BufferSub map[string]int64 `json:"buffer_sub,omitempty"`
	// Transit holds the deliveries on their way to the island inventory.
	Transit []TransitSegment `json:"transit,omitempty"`

	House *HouseState `json:"house,omitempty"`
}

// TransitSegment is output produced at a constant rate that arrives in the
// island inventory during [FromMs, ToMs) (Unix milliseconds) at RateSub
// sub-milli units per millisecond.
type TransitSegment struct {
	Good    string `json:"good"`
	FromMs  int64  `json:"from_ms"`
	ToMs    int64  `json:"to_ms"`
	RateSub int64  `json:"rate_sub"`
}

// HouseState is the state of a residential building.
type HouseState struct {
	// Residents in milli-residents; always whole residents (a multiple of
	// 1000) in [floor, max] of the house tier.
	Residents Qty `json:"residents"`
	// Growth is the signed growth accumulator in ResidentSub units per
	// resident, strictly between -ResidentSub and +ResidentSub after every
	// settle. Reaching +/-ResidentSub adds/removes one resident.
	Growth int64 `json:"growth,omitempty"`
}

// Pos is a tile position.
type Pos struct {
	X int `json:"x"`
	Y int `json:"y"`
}

// Island returns the island with the given ID or nil.
func (w *World) Island(id string) *Island {
	for _, is := range w.Islands {
		if is.ID == id {
			return is
		}
	}
	return nil
}

// Building returns the building with the given ID or nil.
func (is *Island) Building(id int64) *Building {
	for _, b := range is.Buildings {
		if b.ID == id {
			return b
		}
	}
	return nil
}

// InBounds reports whether the tile is on the island.
func (is *Island) InBounds(x, y int) bool {
	return x >= 0 && y >= 0 && x < is.Width && y < is.Height
}

func (is *Island) index(x, y int) int { return y*is.Width + x }

// Tile returns the tile at (x, y); the caller must check bounds.
func (is *Island) Tile(x, y int) Tile { return is.Tiles[is.index(x, y)] }

// RoadAt returns the road type at (x, y) or "".
func (is *Island) RoadAt(x, y int) string {
	if !is.InBounds(x, y) {
		return ""
	}
	return is.Roads[is.index(x, y)]
}

// NewIsland creates an empty island from row-major tiles.
func NewIsland(id string, width, height int, tiles []Tile) *Island {
	return &Island{ID: id, Width: width, Height: height, Tiles: tiles}
}

// NewWorld creates an empty world evaluated at the given time.
func NewWorld(at time.Time) *World {
	return &World{LastEvaluatedAt: truncMs(at), NextBuildingID: 1}
}

func truncMs(t time.Time) time.Time { return t.UTC().Truncate(time.Millisecond) }

// fine converts a milli-unit amount and its sub-milli remainder to sub-milli.
func fine(milli Qty, sub int64) int64 { return milli*SubPerMilli + sub }

// splitFine converts sub-milli units to milli-units and remainder.
func splitFine(f int64) (Qty, int64) {
	m := f / SubPerMilli
	s := f % SubPerMilli
	if s < 0 {
		m--
		s += SubPerMilli
	}
	return m, s
}

// roundFine converts sub-milli units to milli-units, rounding half up. It is
// used for display values only.
func roundFine(f int64) Qty {
	m, s := splitFine(f)
	if s*2 >= SubPerMilli {
		m++
	}
	return m
}

func (inv *Inventory) fine(good string) int64 {
	return fine(inv.Stock[good], inv.StockSub[good])
}

func (inv *Inventory) setFine(good string, f int64) {
	m, s := splitFine(f)
	if m == 0 {
		delete(inv.Stock, good)
	} else {
		if inv.Stock == nil {
			inv.Stock = map[string]Qty{}
		}
		inv.Stock[good] = m
	}
	if s == 0 {
		delete(inv.StockSub, good)
	} else {
		if inv.StockSub == nil {
			inv.StockSub = map[string]int64{}
		}
		inv.StockSub[good] = s
	}
	if len(inv.Stock) == 0 {
		inv.Stock = nil
	}
	if len(inv.StockSub) == 0 {
		inv.StockSub = nil
	}
}

// goldFine returns the world's gold in sub-units.
func (w *World) goldFine() int64 { return w.Gold*GoldSubPerMilli + w.GoldSub }

// setGoldFine stores gold given in sub-units (must be >= 0).
func (w *World) setGoldFine(f int64) {
	w.Gold, w.GoldSub = f/GoldSubPerMilli, f%GoldSubPerMilli
}

func (b *Building) bufferFine(good string) int64 {
	return fine(b.Buffer[good], b.BufferSub[good])
}

func (b *Building) setBufferFine(good string, f int64) {
	m, s := splitFine(f)
	if m == 0 {
		delete(b.Buffer, good)
	} else {
		if b.Buffer == nil {
			b.Buffer = map[string]Qty{}
		}
		b.Buffer[good] = m
	}
	if s == 0 {
		delete(b.BufferSub, good)
	} else {
		if b.BufferSub == nil {
			b.BufferSub = map[string]int64{}
		}
		b.BufferSub[good] = s
	}
	if len(b.Buffer) == 0 {
		b.Buffer = nil
	}
	if len(b.BufferSub) == 0 {
		b.BufferSub = nil
	}
}

// Clone returns a deep copy of the world.
func (w *World) Clone() *World {
	c := *w
	if w.UnlockedTiers != nil {
		c.UnlockedTiers = append([]string(nil), w.UnlockedTiers...)
	}
	c.Islands = make([]*Island, len(w.Islands))
	for i, is := range w.Islands {
		c.Islands[i] = is.clone()
	}
	return &c
}

func (is *Island) clone() *Island {
	c := *is
	c.Tiles = make([]Tile, len(is.Tiles))
	for i, t := range is.Tiles {
		c.Tiles[i] = t
		if t.Fertility != nil {
			c.Tiles[i].Fertility = append([]string(nil), t.Fertility...)
		}
		if t.Deposit != nil {
			d := *t.Deposit
			c.Tiles[i].Deposit = &d
		}
	}
	c.Roads = maps.Clone(is.Roads)
	if is.Buildings != nil {
		c.Buildings = make([]*Building, len(is.Buildings))
		for i, b := range is.Buildings {
			c.Buildings[i] = b.clone()
		}
	}
	c.Inventory = Inventory{
		Stock:    maps.Clone(is.Inventory.Stock),
		StockSub: maps.Clone(is.Inventory.StockSub),
		Starved:  maps.Clone(is.Inventory.Starved),
		Full:     maps.Clone(is.Inventory.Full),
	}
	return &c
}

func (b *Building) clone() *Building {
	c := *b
	c.Buffer = maps.Clone(b.Buffer)
	c.BufferSub = maps.Clone(b.BufferSub)
	if b.Transit != nil {
		c.Transit = append([]TransitSegment(nil), b.Transit...)
	}
	if b.House != nil {
		h := *b.House
		c.House = &h
	}
	return &c
}
