package sim

import (
	"encoding/json"
	"fmt"
	"maps"
	"math"
	"slices"
	"time"

	"github.com/ricoberger/new-shores/server/internal/content"
)

// Building statuses (MECHANICS §14). A building has one primary status; the
// precedence is the order of the constants: paused > not_connected >
// warehouse_full > input_starved > throttled > short_of_workers >
// low_efficiency > ok.
const (
	StatusPaused         = "paused"
	StatusNotConnected   = "not_connected"
	StatusWarehouseFull  = "warehouse_full"
	StatusInputStarved   = "input_starved"
	StatusThrottled      = "throttled"
	StatusShortOfWorkers = "short_of_workers"
	StatusLowEfficiency  = "low_efficiency"
	StatusOK             = "ok"
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
	NextChangeAt *string `json:"next_change_at"`
	// Gold in milli-gold; rates in milli-gold per minute (signed balance).
	Gold              Qty `json:"gold"`
	BalanceRatePerMin Qty `json:"balance_rate_per_min"`
	TaxRatePerMin     Qty `json:"tax_rate_per_min"`
	UpkeepRatePerMin  Qty `json:"upkeep_rate_per_min"`
	// Tiers in progression order with their unlock progress.
	Tiers   []TierDisplay   `json:"tiers"`
	Islands []IslandDisplay `json:"islands"`
	// Ships sorted by ID.
	Ships []ShipDisplay `json:"ships"`
	// Routes sorted by ID.
	Routes []RouteDisplay `json:"routes"`
}

// ShipDisplay is the display state of a ship. The client interpolates its
// position and countdowns from the leg timestamps.
type ShipDisplay struct {
	ID    int64  `json:"id"`
	Type  string `json:"type"`
	State string `json:"state"`
	// IslandID is where the ship is; empty while travelling.
	IslandID string `json:"island_id"`
	// RouteID is the assigned route (0 when none); StopIndex the index of
	// the stop the ship is heading to.
	RouteID   int64       `json:"route_id"`
	StopIndex int         `json:"stop_index"`
	Leg       *LegDisplay `json:"leg"`
	// Cargo lists the occupied slots (milli-units), at most Slots entries;
	// a good may occupy several slots.
	Cargo    []CargoDisplay `json:"cargo"`
	Slots    int            `json:"slots"`
	SlotSize Qty            `json:"slot_size"`
	// UpkeepPerMin is the current upkeep in milli-gold per minute (0 while
	// paused).
	UpkeepPerMin Qty    `json:"upkeep_per_min"`
	Paused       bool   `json:"paused"`
	PausedReason string `json:"paused_reason"`
}

// LegDisplay is a ship's current voyage (RFC 3339 timestamps with ms): the
// ship handles cargo at the origin until DepartAt and arrives at ArriveAt.
type LegDisplay struct {
	FromIslandID string `json:"from_island_id"`
	ToIslandID   string `json:"to_island_id"`
	DepartAt     string `json:"depart_at"`
	ArriveAt     string `json:"arrive_at"`
}

// CargoDisplay is one occupied cargo slot (milli-units).
type CargoDisplay struct {
	Good   string `json:"good"`
	Amount Qty    `json:"amount"`
}

// RouteDisplay is a route with its assigned ships.
type RouteDisplay struct {
	ID      int64              `json:"id"`
	Name    string             `json:"name"`
	Stops   []RouteStopDisplay `json:"stops"`
	ShipIDs []int64            `json:"ship_ids"`
	// LoopMs is the duration of one loop at reference speed 1.0: the
	// handling time of every stop plus the travel time of every leg.
	LoopMs int64 `json:"loop_ms"`
}

// RouteStopDisplay is one stop of a route.
type RouteStopDisplay struct {
	IslandID string            `json:"island_id"`
	Load     []LoadRuleDisplay `json:"load"`
	Unload   []string          `json:"unload"`
}

// LoadRuleDisplay loads a good until MaxAmount milli-units are aboard.
type LoadRuleDisplay struct {
	Good      string `json:"good"`
	MaxAmount Qty    `json:"max_amount"`
}

// PositionDisplay is an archipelago position in tiles.
type PositionDisplay struct {
	X int `json:"x"`
	Y int `json:"y"`
}

// ShipOrderDisplay is the pending order of a shipyard (RFC 3339 with ms).
type ShipOrderDisplay struct {
	Type      string `json:"type"`
	OrderedAt string `json:"ordered_at"`
	DueAt     string `json:"due_at"`
}

// OptionalShipOrder is the ship_order field of a building: omitted for
// buildings without a shipyard block, null for an idle shipyard.
type OptionalShipOrder struct {
	// Present is set for shipyards.
	Present bool
	Order   *ShipOrderDisplay
}

// IsZero omits the field for buildings that are not shipyards (omitzero).
func (o OptionalShipOrder) IsZero() bool { return !o.Present }

// MarshalJSON encodes the order or null.
func (o OptionalShipOrder) MarshalJSON() ([]byte, error) { return json.Marshal(o.Order) }

// UnmarshalJSON decodes the order or null; a present field marks a
// shipyard.
func (o *OptionalShipOrder) UnmarshalJSON(data []byte) error {
	o.Present = true
	return json.Unmarshal(data, &o.Order)
}

// TierDisplay is the unlock state of a tier (MECHANICS §12). Population
// values are milli-residents over the whole archipelago.
type TierDisplay struct {
	ID             string                       `json:"id"`
	Unlocked       bool                         `json:"unlocked"`
	Population     map[string]PopulationDisplay `json:"population"`
	Buildings      map[string]bool              `json:"buildings"`
	GoodsDelivered map[string]bool              `json:"goods_delivered"`
}

// PopulationDisplay is a population unlock condition (milli-residents).
type PopulationDisplay struct {
	Have Qty `json:"have"`
	Need Qty `json:"need"`
}

// WorkforceDisplay is the workforce of one tier on an island
// (milli-residents).
type WorkforceDisplay struct {
	Available      Qty   `json:"available"`
	Required       Qty   `json:"required"`
	FactorPermille int64 `json:"factor_permille"`
}

// NeedDisplay is the state of one need of a house.
type NeedDisplay struct {
	ID                 string `json:"id"`
	Kind               string `json:"kind"`
	Category           string `json:"category,omitempty"`
	Building           string `json:"building,omitempty"`
	FulfilmentPermille int64  `json:"fulfilment_permille"`
	// Reason is one of ok, short_supply, no_supply (goods needs) or ok,
	// out_of_range, not_connected, paused (building needs).
	Reason string `json:"reason"`
	// Variety is the number of extra goods supplied (goods needs).
	Variety *int `json:"variety,omitempty"`
	// Goods maps each acceptable good to the island-wide consumption rate of
	// the tier's houses (milli-units per minute).
	Goods map[string]Qty `json:"goods,omitempty"`
}

// BuildingWorkforce is the workforce requirement of a producer.
type BuildingWorkforce struct {
	Tier     string `json:"tier"`
	Required Qty    `json:"required"`
}

// IslandDisplay is the display state of one island.
type IslandDisplay struct {
	ID string `json:"id"`
	// Name is the display name (may be empty).
	Name string `json:"name"`
	// Settled is true when the island has a warehouse; unsettled islands
	// have capacity 0 and accept only FoundIsland.
	Settled bool `json:"settled"`
	// Position in the archipelago (tiles).
	Position  PositionDisplay        `json:"position"`
	Width     int                    `json:"width"`
	Height    int                    `json:"height"`
	Inventory map[string]GoodDisplay `json:"inventory"`
	Roads     []RoadDisplay          `json:"roads"`
	Buildings []BuildingDisplay      `json:"buildings"`
	// Workforce per tier with houses or demand on the island.
	Workforce map[string]WorkforceDisplay `json:"workforce"`
	// Population per tier (milli-residents).
	Population map[string]Qty `json:"population"`
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
	Paused                   bool   `json:"paused"`
	PausedReason             string `json:"paused_reason"`
	Status                   string `json:"status"`
	EfficiencyPermille       int64  `json:"efficiency_permille"`
	ThroughputFactorPermille int64  `json:"throughput_factor_permille"`
	// StatusGoods names the goods behind a producer's status, sorted by ID:
	// the starve-limited inputs for input_starved and the outputs in the
	// full regime for warehouse_full; empty for every other status.
	StatusGoods []string `json:"status_goods,omitempty"`

	// Producers.
	Rates                 *RatesDisplay  `json:"rates,omitempty"`
	CycleSeconds          *float64       `json:"cycle_seconds,omitempty"`
	CycleProgressPermille *int64         `json:"cycle_progress_permille,omitempty"`
	TransferDelayMs       *int64         `json:"transfer_delay_ms,omitempty"`
	AssignedWarehouseID   *int64         `json:"assigned_warehouse_id,omitempty"`
	RoadDistance          *int           `json:"road_distance,omitempty"`
	Buffer                *BufferDisplay `json:"buffer,omitempty"`

	// CycleRatePermillePerMin is the progress of the production cycle per
	// minute at the current rate (0 when the producer does not run), so that
	// the client can extrapolate the cycle bar without recipe amounts.
	CycleRatePermillePerMin int64 `json:"cycle_rate_permille_per_min,omitempty"`

	// WorkforceFactorPermille and Workforce are set for producers with a
	// workforce block.
	WorkforceFactorPermille *int64             `json:"workforce_factor_permille,omitempty"`
	Workforce               *BuildingWorkforce `json:"workforce,omitempty"`

	// Warehouses.
	Level            *int   `json:"level,omitempty"`
	Capacity         *Qty   `json:"capacity,omitempty"`
	ThroughputPerMin *Qty   `json:"throughput_per_min,omitempty"`
	LoadPermille     *int64 `json:"load_permille,omitempty"`

	// Houses (residents in milli-residents, rates per minute).
	Residents                 *Qty          `json:"residents,omitempty"`
	ResidentsFloor            *Qty          `json:"residents_floor,omitempty"`
	ResidentsMax              *Qty          `json:"residents_max,omitempty"`
	GrowthProgressPermille    *int64        `json:"growth_progress_permille,omitempty"`
	GrowthRatePerMin          *Qty          `json:"growth_rate_per_min,omitempty"`
	SatisfactionPermille      *int64        `json:"satisfaction_permille,omitempty"`
	VarietyMultiplierPermille *int64        `json:"variety_multiplier_permille,omitempty"`
	TaxRatePerMin             *Qty          `json:"tax_rate_per_min,omitempty"`
	Needs                     []NeedDisplay `json:"needs,omitempty"`

	// ShipOrder is set for shipyards: the pending order or null.
	ShipOrder OptionalShipOrder `json:"ship_order,omitzero"`
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
	wr, _ := settleWorld(cw, c, nowMs)

	ds := DisplayState{
		EvaluatedAt: cw.LastEvaluatedAt.Format(timeLayout), Gold: cw.Gold,
		BalanceRatePerMin: wr.balance, TaxRatePerMin: wr.tax, UpkeepRatePerMin: wr.upkeep,
		Tiers: []TierDisplay{}, Islands: []IslandDisplay{}, Ships: []ShipDisplay{}, Routes: []RouteDisplay{},
	}
	if at, _ := nextBoundary(cw, c, wr, nowMs); at != math.MaxInt64 {
		s := time.UnixMilli(at).UTC().Format(timeLayout)
		ds.NextChangeAt = &s
	}
	pop := worldPopulation(cw, c)
	for _, t := range c.Tiers {
		st := evaluateTier(cw, c, t, pop)
		td := TierDisplay{
			ID: t.ID, Unlocked: TierUnlocked(cw, c, t.ID),
			Population: map[string]PopulationDisplay{}, Buildings: st.buildings, GoodsDelivered: st.goods,
		}
		for tier, v := range st.population {
			td.Population[tier] = PopulationDisplay{Have: v[0], Need: v[1]}
		}
		ds.Tiers = append(ds.Tiers, td)
	}
	for i, is := range cw.Islands {
		ds.Islands = append(ds.Islands, displayIsland(is, c, wr.islands[i], nowMs))
	}
	for _, s := range cw.Ships {
		ds.Ships = append(ds.Ships, displayShip(s, c))
	}
	for _, r := range cw.Routes {
		ds.Routes = append(ds.Routes, displayRoute(cw, c, r))
	}
	return ds, nil
}

func formatMs(ms int64) string { return time.UnixMilli(ms).UTC().Format(timeLayout) }

func displayShip(s *Ship, c *content.Catalogue) ShipDisplay {
	d := ShipDisplay{
		ID: s.ID, Type: s.Type, State: s.State, IslandID: s.IslandID, RouteID: s.RouteID, StopIndex: s.StopIndex,
		Cargo: []CargoDisplay{}, Paused: s.Paused, PausedReason: s.PausedReason,
	}
	if def := c.ShipByID[s.Type]; def != nil {
		d.Slots, d.SlotSize = def.Slots, def.SlotSize
		if !s.Paused {
			d.UpkeepPerMin = def.UpkeepPerMin
		}
	}
	if l := s.Leg; l != nil {
		d.Leg = &LegDisplay{FromIslandID: l.FromIsland, ToIslandID: l.ToIsland, DepartAt: formatMs(l.DepartAtMs), ArriveAt: formatMs(l.ArriveAtMs)}
	}
	for _, sl := range s.Cargo {
		d.Cargo = append(d.Cargo, CargoDisplay(sl))
	}
	return d
}

func displayRoute(w *World, c *content.Catalogue, r *Route) RouteDisplay {
	d := RouteDisplay{ID: r.ID, Name: r.Name, Stops: []RouteStopDisplay{}, ShipIDs: []int64{}, LoopMs: routeLoopMs(w, c, r)}
	for _, st := range r.Stops {
		sd := RouteStopDisplay{IslandID: st.IslandID, Load: []LoadRuleDisplay{}, Unload: append([]string{}, st.Unload...)}
		for _, lr := range st.Load {
			sd.Load = append(sd.Load, LoadRuleDisplay(lr))
		}
		d.Stops = append(d.Stops, sd)
	}
	for _, s := range w.Ships {
		if s.RouteID == r.ID {
			d.ShipIDs = append(d.ShipIDs, s.ID)
		}
	}
	return d
}

func displayIsland(is *Island, c *content.Catalogue, r *rates, now int64) IslandDisplay {
	d := IslandDisplay{
		ID: is.ID, Name: is.Name, Settled: settled(is, c), Position: PositionDisplay{X: is.X, Y: is.Y},
		Width: is.Width, Height: is.Height,
		Inventory: map[string]GoodDisplay{}, Roads: []RoadDisplay{}, Buildings: []BuildingDisplay{},
		Workforce: map[string]WorkforceDisplay{}, Population: islandPopulation(is, c),
	}
	for tier, p := range r.workforce {
		d.Workforce[tier] = WorkforceDisplay{Available: p.available, Required: p.required, FactorPermille: p.factorPermille()}
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
	houses := map[int64]*houseCalc{}
	for _, h := range r.houses {
		houses[h.b.ID] = h
	}
	for _, b := range is.Buildings {
		def := c.BuildingByID[b.Type]
		if def == nil {
			continue
		}
		bd := BuildingDisplay{
			ID: b.ID, Type: b.Type, X: b.X, Y: b.Y, Rotation: b.Rotation,
			Paused: b.Paused, PausedReason: b.PausedReason,
			Status: StatusOK, EfficiencyPermille: b.Efficiency, ThroughputFactorPermille: 1000,
		}
		switch {
		case prods[b.ID] != nil:
			displayProducer(&bd, is, c, prods[b.ID])
		case b.Paused:
			bd.Status = StatusPaused
		case (def.Service != nil || def.Shipyard != nil || houses[b.ID] != nil) && b.AssignedWarehouseID == 0:
			bd.Status = StatusNotConnected
		}
		if def.Shipyard != nil {
			bd.ShipOrder.Present = true
			if o := b.Order; o != nil {
				bd.ShipOrder.Order = &ShipOrderDisplay{Type: o.Type, OrderedAt: formatMs(o.OrderedAtMs), DueAt: formatMs(o.DueAtMs)}
			}
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
		if h := houses[b.ID]; h != nil {
			displayHouse(&bd, h)
		}
		d.Buildings = append(d.Buildings, bd)
	}
	return d
}

func displayHouse(bd *BuildingDisplay, h *houseCalc) {
	hs := h.b.House
	bd.Residents = ptr(hs.Residents)
	bd.ResidentsFloor = ptr(h.tier.ResidentsFloor)
	bd.ResidentsMax = ptr(h.tier.ResidentsMax)
	bd.GrowthProgressPermille = ptr(hs.Growth * 1000 / ResidentSub)
	// 1 milli-resident per minute = 1000 accumulator units per ms.
	bd.GrowthRatePerMin = ptr(h.growth / 1000)
	bd.SatisfactionPermille = ptr(h.satisfaction / 1000)
	bd.VarietyMultiplierPermille = ptr(h.variety / 1000)
	bd.TaxRatePerMin = ptr(h.tax)
	bd.Needs = []NeedDisplay{}
	for _, n := range h.needs {
		nd := NeedDisplay{
			ID: n.need.ID, Kind: n.need.Kind, Category: n.need.Category, Building: n.need.Building,
			FulfilmentPermille: n.fulfilment / 1000, Reason: n.reason,
		}
		if gs := n.goods; gs != nil {
			nd.Variety = ptr(gs.variety)
			nd.Goods = map[string]Qty{}
			for i, g := range n.need.Goods {
				nd.Goods[g.Good] = perMin(gs.cons[i])
			}
		}
		bd.Needs = append(bd.Needs, nd)
	}
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
	bd.CycleRatePermillePerMin = p.rate * msPerMinute * 1000 / SubPerMilli
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
	if wf := p.def.Workforce; wf != nil {
		bd.WorkforceFactorPermille = ptr(p.workforce)
		bd.Workforce = &BuildingWorkforce{Tier: wf.Tier, Required: wf.Amount}
	}
	bd.Status = producerStatus(is, p)
	bd.StatusGoods = statusGoods(is, p, bd.Status)
}

// statusGoods returns the goods behind an input_starved or warehouse_full
// status, sorted by good ID; nil for every other status.
func statusGoods(is *Island, p *producer, status string) []string {
	var goods []string
	switch status {
	case StatusInputStarved:
		for i, in := range p.def.Recipe.Inputs {
			if c := p.starveCap[i]; c >= 0 && c < p.tp {
				goods = append(goods, in.Good)
			}
		}
	case StatusWarehouseFull:
		for _, out := range p.def.Recipe.Outputs {
			if is.Inventory.Full[out.Good] {
				goods = append(goods, out.Good)
			}
		}
	}
	slices.Sort(goods)
	return goods
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
	case p.workforce < 1000:
		return StatusShortOfWorkers
	case p.b.Efficiency < 1000:
		return StatusLowEfficiency
	}
	return StatusOK
}

func ptr[T any](v T) *T { return &v }
