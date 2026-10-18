package sim

import (
	"fmt"
	"maps"
	"math"
	"slices"
	"time"

	"github.com/ricoberger/new-shores/server/internal/content"
)

// Building statuses (MECHANICS §14). A building has one primary status; the
// precedence is the order of the constants: paused > not_connected >
// warehouse_full > input_starved > throttled > low_efficiency > ok.
const (
	StatusPaused        = "paused"
	StatusNotConnected  = "not_connected"
	StatusWarehouseFull = "warehouse_full"
	StatusInputStarved  = "input_starved"
	StatusThrottled     = "throttled"
	StatusLowEfficiency = "low_efficiency"
	StatusOK            = "ok"
)

// timeLayout formats timestamps as RFC 3339 in UTC with millisecond
// precision.
const timeLayout = "2006-01-02T15:04:05.000Z07:00"

// DisplayState is the client payload (ARCHITECTURE §4.1, D-027): the
// authoritative state plus everything the client needs to extrapolate
// linearly until NextChangeAt. All quantities are milli-units (rounded to the
// nearest milli-unit), all rates milli-units per minute.
type DisplayState struct {
	EvaluatedAt string `json:"evaluated_at"`
	// NextChangeAt is the earliest boundary after EvaluatedAt or nil when the
	// rates never change without a command.
	NextChangeAt *string         `json:"next_change_at"`
	Gold         Qty             `json:"gold"`
	Islands      []IslandDisplay `json:"islands"`
}

// IslandDisplay is the display state of one island.
type IslandDisplay struct {
	ID        string                 `json:"id"`
	Width     int                    `json:"width"`
	Height    int                    `json:"height"`
	Inventory map[string]GoodDisplay `json:"inventory"`
	Roads     []RoadDisplay          `json:"roads"`
	Buildings []BuildingDisplay      `json:"buildings"`
}

// GoodDisplay is the inventory line of one good.
type GoodDisplay struct {
	Stock     Qty `json:"stock"`
	Capacity  Qty `json:"capacity"`
	InTransit Qty `json:"in_transit"`
	// RatePerMin is the net rate of the stock (arrivals - consumption).
	RatePerMin Qty `json:"rate_per_min"`
}

// RoadDisplay is one road tile.
type RoadDisplay struct {
	X    int    `json:"x"`
	Y    int    `json:"y"`
	Type string `json:"type"`
}

// RatesDisplay lists the current rates of a producer per good.
type RatesDisplay struct {
	Inputs  map[string]Qty `json:"inputs"`
	Outputs map[string]Qty `json:"outputs"`
}

// BufferDisplay is the output buffer of an unconnected producer.
type BufferDisplay struct {
	Stock    map[string]Qty `json:"stock"`
	Capacity Qty            `json:"capacity"`
}

// BuildingDisplay is the display state of one building. Producer, warehouse
// and house fields are present only for buildings with the respective
// capability.
type BuildingDisplay struct {
	ID                       int64  `json:"id"`
	Type                     string `json:"type"`
	X                        int    `json:"x"`
	Y                        int    `json:"y"`
	Rotation                 int    `json:"rotation"`
	Entrance                 Pos    `json:"entrance"`
	Paused                   bool   `json:"paused"`
	PausedReason             string `json:"paused_reason"`
	Status                   string `json:"status"`
	EfficiencyPermille       int64  `json:"efficiency_permille"`
	ThroughputFactorPermille int64  `json:"throughput_factor_permille"`

	// Producers.
	Rates                 *RatesDisplay  `json:"rates,omitempty"`
	CycleSeconds          *float64       `json:"cycle_seconds,omitempty"`
	CycleProgressPermille *int64         `json:"cycle_progress_permille,omitempty"`
	TransferDelayMs       *int64         `json:"transfer_delay_ms,omitempty"`
	AssignedWarehouseID   *int64         `json:"assigned_warehouse_id,omitempty"`
	RoadDistance          *int           `json:"road_distance,omitempty"`
	Buffer                *BufferDisplay `json:"buffer,omitempty"`

	// Warehouses.
	Level            *int   `json:"level,omitempty"`
	Capacity         *Qty   `json:"capacity,omitempty"`
	ThroughputPerMin *Qty   `json:"throughput_per_min,omitempty"`
	LoadPermille     *int64 `json:"load_permille,omitempty"`

	// Houses.
	Residents *Qty `json:"residents,omitempty"`
}

// perMin converts a sub-milli rate per millisecond to milli-units per minute.
func perMin(rateSub int64) Qty { return rateSub * msPerMinute / SubPerMilli }

// Display derives the client payload. It does not mutate w. now must equal
// w.LastEvaluatedAt (the caller advances first); otherwise ErrDisplayTime is
// returned.
func Display(w *World, c *content.Catalogue, now time.Time) (DisplayState, error) {
	if !truncMs(now).Equal(w.LastEvaluatedAt) {
		return DisplayState{}, fmt.Errorf("%w: %s != %s", ErrDisplayTime, now.Format(timeLayout), w.LastEvaluatedAt.Format(timeLayout))
	}
	cw := w.Clone()
	nowMs := cw.LastEvaluatedAt.UnixMilli()
	rs := make([]*rates, len(cw.Islands))
	for i, is := range cw.Islands {
		rs[i] = settle(is, c, nowMs)
	}

	ds := DisplayState{EvaluatedAt: cw.LastEvaluatedAt.Format(timeLayout), Gold: cw.Gold, Islands: []IslandDisplay{}}
	if at, _ := nextBoundary(cw, c, rs, nowMs); at != math.MaxInt64 {
		s := time.UnixMilli(at).UTC().Format(timeLayout)
		ds.NextChangeAt = &s
	}
	for i, is := range cw.Islands {
		ds.Islands = append(ds.Islands, displayIsland(is, c, rs[i], nowMs))
	}
	return ds, nil
}

func displayIsland(is *Island, c *content.Catalogue, r *rates, now int64) IslandDisplay {
	d := IslandDisplay{
		ID: is.ID, Width: is.Width, Height: is.Height,
		Inventory: map[string]GoodDisplay{}, Roads: []RoadDisplay{}, Buildings: []BuildingDisplay{},
	}
	capMilli := capacityMilli(is, c)
	for _, g := range c.Goods {
		d.Inventory[g.ID] = GoodDisplay{
			Stock:      roundFine(is.Inventory.fine(g.ID)),
			Capacity:   capMilli,
			InTransit:  roundFine(transitFine(is, g.ID, now)),
			RatePerMin: perMin(r.inflow[g.ID] - r.cons[g.ID]),
		}
	}
	for _, i := range slices.Sorted(maps.Keys(is.Roads)) {
		d.Roads = append(d.Roads, RoadDisplay{X: i % is.Width, Y: i / is.Width, Type: is.Roads[i]})
	}

	prods := map[int64]*producer{}
	for _, p := range r.producers {
		prods[p.b.ID] = p
	}
	for _, b := range is.Buildings {
		def := c.BuildingByID[b.Type]
		if def == nil {
			continue
		}
		bd := BuildingDisplay{
			ID: b.ID, Type: b.Type, X: b.X, Y: b.Y, Rotation: b.Rotation,
			Entrance: entrance(def, b.X, b.Y, b.Rotation),
			Paused:   b.Paused, PausedReason: b.PausedReason,
			Status: StatusOK, EfficiencyPermille: b.Efficiency, ThroughputFactorPermille: 1000,
		}
		if p := prods[b.ID]; p != nil {
			displayProducer(&bd, is, c, p)
		}
		if def.Warehouse != nil {
			lvl := warehouseLevel(def, b)
			level := max(b.Level, 1)
			load := r.loads[b.ID]
			var permille int64
			if load.t > 0 {
				permille = load.r * 1000 / load.t
			}
			bd.Level, bd.Capacity, bd.ThroughputPerMin, bd.LoadPermille = &level, ptr(lvl.Capacity), ptr(lvl.ThroughputPerMin), &permille
		}
		if b.House != nil {
			bd.Residents = ptr(b.House.Residents)
		}
		d.Buildings = append(d.Buildings, bd)
	}
	return d
}

func displayProducer(bd *BuildingDisplay, is *Island, c *content.Catalogue, p *producer) {
	b, rec := p.b, p.def.Recipe
	bd.ThroughputFactorPermille = p.throughput
	bd.Rates = &RatesDisplay{Inputs: map[string]Qty{}, Outputs: map[string]Qty{}}
	for _, in := range rec.Inputs {
		rate := int64(0)
		if p.connected {
			rate = p.rate
		}
		bd.Rates.Inputs[in.Good] = perMin(rate * in.Amount)
	}
	for _, out := range rec.Outputs {
		bd.Rates.Outputs[out.Good] = perMin(p.rate * out.Amount)
	}
	bd.CycleSeconds = ptr(float64(rec.CycleMs) / 1000)
	bd.CycleProgressPermille = ptr(b.Progress * 1000 / SubPerMilli)
	bd.TransferDelayMs = ptr(b.TransferDelayMs)
	bd.AssignedWarehouseID = ptr(b.AssignedWarehouseID)
	bd.RoadDistance = ptr(b.RoadDistance)
	if !p.connected || len(b.Buffer) > 0 || len(b.BufferSub) > 0 {
		buf := &BufferDisplay{Stock: map[string]Qty{}, Capacity: c.Region.Rules.UnconnectedBuffer}
		for _, out := range rec.Outputs {
			buf.Stock[out.Good] = roundFine(b.bufferFine(out.Good))
		}
		bd.Buffer = buf
	}
	bd.Status = producerStatus(is, p)
}

func producerStatus(is *Island, p *producer) string {
	switch {
	case p.b.Paused:
		return StatusPaused
	case !p.connected:
		return StatusNotConnected
	}
	for _, out := range p.def.Recipe.Outputs {
		if is.Inventory.Full[out.Good] {
			return StatusWarehouseFull
		}
	}
	switch {
	case p.starveLimited():
		return StatusInputStarved
	case p.throughput < 1000:
		return StatusThrottled
	case p.b.Efficiency < 1000:
		return StatusLowEfficiency
	}
	return StatusOK
}

func ptr[T any](v T) *T { return &v }
