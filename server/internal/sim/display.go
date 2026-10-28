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
// low_efficiency > ok. A field is ok or StatusNotAdjacent (fields.go).
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
	// NextChangeAt is the earliest boundary (including ship arrivals and
	// completed orders) or ship departure after EvaluatedAt, or nil when
	// nothing changes without a command.
	NextChangeAt *string `json:"next_change_at"`
	// Gold in milli-gold; rates in milli-gold per minute (signed balance).
	Gold              Qty `json:"gold"`
	BalanceRatePerMin Qty `json:"balance_rate_per_min"`
	TaxRatePerMin     Qty `json:"tax_rate_per_min"`
	UpkeepRatePerMin  Qty `json:"upkeep_rate_per_min"`
	// Tiers in progression order with their unlock progress.
	Tiers []TierDisplay `json:"tiers"`
	// Archipelago identifies the generated archipelago and its extent.
	Archipelago ArchipelagoDisplay `json:"archipelago"`
	Islands     []IslandDisplay    `json:"islands"`
	// Ships sorted by ID.
	Ships []ShipDisplay `json:"ships"`
	// Routes sorted by ID.
	Routes []RouteDisplay `json:"routes"`
	// Insolvency summarises the buildings and ships paused for
	// insolvency (MECHANICS §7) for the HUD banner.
	Insolvency InsolvencyDisplay `json:"insolvency"`
	// Quests is the state of the content quests.
	Quests QuestsDisplay `json:"quests"`
	// AwaySummary is the pending "while you were away" summary or nil.
	AwaySummary *AwaySummary `json:"away_summary"`
	// LastSeenAt is the world time of the player's last successful command.
	LastSeenAt string `json:"last_seen_at"`
}

// QuestsDisplay is the quest state: the active quests with their
// objectives, the claimable quest IDs (content order) and every completed
// quest (by completion time, then content order).
type QuestsDisplay struct {
	Active    []ActiveQuestDisplay    `json:"active"`
	Claimable []string                `json:"claimable"`
	Completed []CompletedQuestDisplay `json:"completed"`
}

// ActiveQuestDisplay is an active quest with the progress of its
// objectives (content order).
type ActiveQuestDisplay struct {
	ID         string             `json:"id"`
	Objectives []ObjectiveDisplay `json:"objectives"`
}

// ObjectiveDisplay is the progress of one objective. Current and Target
// are in the predicate's natural unit: counts for building_count,
// island_settled and ship_count, 0/1 for connected, route_exists and
// tier_unlocked, milli-residents for population, milli-units for stock and
// per-mille for satisfaction (current -1 without a house of the tier).
type ObjectiveDisplay struct {
	Kind string `json:"kind"`
	// Type is the building type (building_count, connected) or the ship
	// type (ship_count; empty = every ship).
	Type    string `json:"type,omitempty"`
	Good    string `json:"good,omitempty"`
	Tier    string `json:"tier,omitempty"`
	Island  string `json:"island,omitempty"`
	Current int64  `json:"current"`
	Target  int64  `json:"target"`
	Met     bool   `json:"met"`
}

// CompletedQuestDisplay is a completed quest (RFC 3339 with ms).
type CompletedQuestDisplay struct {
	ID          string `json:"id"`
	CompletedAt string `json:"completed_at"`
	Claimed     bool   `json:"claimed"`
}

// InsolvencyDisplay is the insolvency state of the world (MECHANICS §7).
// Gold rates are milli-gold per minute.
type InsolvencyDisplay struct {
	// UnpaidBuildings and UnpaidShips count the buildings and ships paused
	// for insolvency (paused_reason unpaid).
	UnpaidBuildings int `json:"unpaid_buildings"`
	UnpaidShips     int `json:"unpaid_ships"`
	// UnpaidUpkeepPerMin is the summed upkeep of everything paused for
	// insolvency.
	UnpaidUpkeepPerMin Qty `json:"unpaid_upkeep_per_min"`
	// BalanceIfResumedPerMin is the full balance (signed) with every
	// unpaid building and ship running and all rates recomputed as for an
	// auto-resume (MECHANICS §7 (b)); the current balance when nothing is
	// unpaid.
	BalanceIfResumedPerMin Qty `json:"balance_if_resumed_per_min"`
}

// ShipDisplay is the display state of a ship. The client interpolates its
// position and countdowns from the leg timestamps.
type ShipDisplay struct {
	ID   int64  `json:"id"`
	Type string `json:"type"`
	// Name is the ship's name (Ship.Name).
	Name  string `json:"name"`
	State string `json:"state"`
	// IslandID is where the ship is; empty while travelling.
	IslandID string `json:"island_id"`
	// RouteID is the assigned route (0 when none); StopIndex the index of
	// the stop the ship is heading to.
	RouteID   int64       `json:"route_id"`
	StopIndex int         `json:"stop_index"`
	Leg       *LegDisplay `json:"leg"`
	// Cargo lists the occupied slots (milli-units), at most Slots entries
	// except for the founding cargo of the start ship (D-056); a good may
	// occupy several slots.
	Cargo    []CargoDisplay `json:"cargo"`
	Slots    int            `json:"slots"`
	SlotSize Qty            `json:"slot_size"`
	// UpkeepPerMin is the current upkeep in milli-gold per minute (0 while
	// paused).
	UpkeepPerMin Qty    `json:"upkeep_per_min"`
	Paused       bool   `json:"paused"`
	PausedReason string `json:"paused_reason"`
	// Position is the archipelago position (tiles) of an idle or anchored
	// ship at sea (the start ship, D-051); null at an island or on a leg.
	Position *PositionDisplay `json:"position"`
	// QueuedAt is when a ship waiting for a berth (state
	// waiting_for_berth) joined its island's queue; null otherwise.
	QueuedAt *string `json:"queued_at"`
	// BerthUntil is the end of the ship's handling at a berth of its island
	// (a route ship's departure, the end of unloading after a manual leg);
	// null when it holds no berth.
	BerthUntil *string `json:"berth_until"`
}

// LegDisplay is a ship's current voyage (RFC 3339 timestamps with ms): the
// ship handles cargo at the origin until DepartAt and arrives at ArriveAt.
type LegDisplay struct {
	// FromIslandID is empty for a leg from a sea position (FromPosition).
	FromIslandID string `json:"from_island_id"`
	// FromPosition is the archipelago origin (tiles) of a leg from the sea;
	// null for a leg from an island.
	FromPosition *PositionDisplay `json:"from_position"`
	ToIslandID   string           `json:"to_island_id"`
	DepartAt     string           `json:"depart_at"`
	ArriveAt     string           `json:"arrive_at"`
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
	// Effects is the estimated net change per island and good of one loop
	// and per minute (MECHANICS §9.2 estimate; stock availability ignored).
	Effects []RouteEffectDisplay `json:"effects"`
}

// RouteEffectDisplay is the estimated net effect of a route on one good of
// one island (signed milli-units, positive when the island gains).
type RouteEffectDisplay struct {
	IslandID string `json:"island_id"`
	Good     string `json:"good"`
	// PerLoop is per loop of the route; PerMin per minute with all
	// assigned ships (0 when none is assigned).
	PerLoop Qty `json:"per_loop"`
	PerMin  Qty `json:"per_min"`
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
	ID         string                       `json:"id"`
	Unlocked   bool                         `json:"unlocked"`
	Population map[string]PopulationDisplay `json:"population"`
	Buildings  map[string]bool              `json:"buildings"`
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
	ID       string `json:"id"`
	Kind     string `json:"kind"`
	Category string `json:"category,omitempty"`
	// Building is the public building of a building need with a single
	// alternative ("" for goods needs and services categories).
	Building           string `json:"building,omitempty"`
	FulfilmentPermille int64  `json:"fulfilment_permille"`
	// Reason is one of ok, short_supply, no_supply (goods needs) or ok,
	// out_of_range, not_connected, paused (building needs).
	Reason string `json:"reason"`
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
	// SizeClass is the content size class of a generated island ("" for a
	// hand-made one); Rock is true for a size class marked rock (a resource
	// rock: mines only, D-053).
	SizeClass string `json:"size_class"`
	Rock      bool   `json:"rock"`
	// Settled is true when the island has a Trading Post; unsettled
	// islands have capacity 0 and accept only FoundIsland.
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
	// CapacitySource is the island's Trading Post; null when the island is
	// not settled (capacity 0).
	CapacitySource *CapacitySourceDisplay `json:"capacity_source"`
	// Fertilities are the island-wide fertility tags (MECHANICS §2).
	Fertilities []string `json:"fertilities"`
	// Deposits are the tiles carrying a deposit, sorted by tile index.
	Deposits []DepositDisplay `json:"deposits"`
	// TerrainMask is the terrain downsampled 1:4 (TerrainMask) for the far
	// view and the minimap; the full rows are served per island.
	TerrainMask string `json:"terrain_mask"`
}

// DepositDisplay is a tile with a deposit (infinite, D-036).
type DepositDisplay struct {
	X    int    `json:"x"`
	Y    int    `json:"y"`
	Kind string `json:"kind"`
}

// IslandDeposits lists the island's deposit tiles sorted by tile index.
func IslandDeposits(is *Island) []DepositDisplay {
	out := []DepositDisplay{}
	for i, t := range is.Tiles {
		if t.Deposit != nil {
			out = append(out, DepositDisplay{X: i % is.Width, Y: i / is.Width, Kind: t.Deposit.Kind})
		}
	}
	return out
}

// ArchipelagoDisplay is the generated archipelago (D-053): the world
// seed and the number of rerolls that produced it (seed 0: hand-made),
// whether it can still be rerolled (no island settled, no ship under way)
// and the bounding box of its islands in archipelago tiles.
type ArchipelagoDisplay struct {
	Seed       uint64        `json:"seed"`
	Roll       int           `json:"roll"`
	Rerollable bool          `json:"rerollable"`
	Bounds     BoundsDisplay `json:"bounds"`
}

// BoundsDisplay is a rectangle in archipelago tiles.
type BoundsDisplay struct {
	X      int `json:"x"`
	Y      int `json:"y"`
	Width  int `json:"width"`
	Height int `json:"height"`
}

func displayArchipelago(w *World, c *content.Catalogue) ArchipelagoDisplay {
	d := ArchipelagoDisplay{Seed: w.Seed, Roll: w.ArchipelagoRoll, Rerollable: CanReroll(w, c) == nil}
	for i, is := range w.Islands {
		if i == 0 {
			d.Bounds = BoundsDisplay{X: is.X, Y: is.Y, Width: is.Width, Height: is.Height}
			continue
		}
		x0, y0 := min(d.Bounds.X, is.X), min(d.Bounds.Y, is.Y)
		x1, y1 := max(d.Bounds.X+d.Bounds.Width, is.X+is.Width), max(d.Bounds.Y+d.Bounds.Height, is.Y+is.Height)
		d.Bounds = BoundsDisplay{X: x0, Y: y0, Width: x1 - x0, Height: y1 - y0}
	}
	return d
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

	// Collectors; Level also for public buildings with levels (D-056).
	Level            *int   `json:"level,omitempty"`
	Capacity         *Qty   `json:"capacity,omitempty"`
	ThroughputPerMin *Qty   `json:"throughput_per_min,omitempty"`
	LoadPermille     *int64 `json:"load_permille,omitempty"`

	// Houses (residents in milli-residents, rates per minute).
	Residents              *Qty          `json:"residents,omitempty"`
	ResidentsFloor         *Qty          `json:"residents_floor,omitempty"`
	ResidentsMax           *Qty          `json:"residents_max,omitempty"`
	GrowthProgressPermille *int64        `json:"growth_progress_permille,omitempty"`
	GrowthRatePerMin       *Qty          `json:"growth_rate_per_min,omitempty"`
	SatisfactionPermille   *int64        `json:"satisfaction_permille,omitempty"`
	TaxRatePerMin          *Qty          `json:"tax_rate_per_min,omitempty"`
	Needs                  []NeedDisplay `json:"needs,omitempty"`
	// ServedBy lists the IDs of the buildings that currently fulfil one of the
	// house's building needs (ascending, omitted when none).
	ServedBy []int64 `json:"served_by,omitempty"`

	// ShipOrder is set for shipyards: the pending order or null.
	ShipOrder OptionalShipOrder `json:"ship_order,omitzero"`

	// Berths is set for the Trading Post (MECHANICS §9.3).
	Berths *BerthsDisplay `json:"berths,omitempty"`

	// Fields is set for farms with a fields block (D-049).
	Fields *FieldsDisplay `json:"fields,omitempty"`
	// FarmID and Active are set for a field: the ID of its farm and
	// whether its chain to the farm is intact (an inactive field has
	// status not_adjacent).
	FarmID *int64 `json:"farm_id,omitempty"`
	Active *bool  `json:"active,omitempty"`
}

// BerthsDisplay is the pier of a Trading Post: its berths (count), the
// berths in use, the ships holding them (by ID) and the ships waiting for
// one in FIFO order (arrival, then ship ID).
type BerthsDisplay struct {
	Total int     `json:"total"`
	Busy  int     `json:"busy"`
	Ships []int64 `json:"ships"`
	Queue []int64 `json:"queue"`
}

// CapacitySourceDisplay names the building that sets an island's capacity
// per good (the Trading Post, D-051) with its level and capacity
// (milli-units).
type CapacitySourceDisplay struct {
	BuildingID int64  `json:"building_id"`
	Type       string `json:"type"`
	Level      int    `json:"level"`
	Capacity   Qty    `json:"capacity"`
}

// FieldsDisplay is the field count of a farm (D-051 part 4): its active
// fields, the number it needs for full efficiency, the most it may own and
// the IDs of all its fields (active or not) in ascending order.
type FieldsDisplay struct {
	Active   int     `json:"active"`
	Required int     `json:"required"`
	Max      int     `json:"max"`
	IDs      []int64 `json:"ids"`
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
		Archipelago: displayArchipelago(cw, c),
	}
	at, _ := nextBoundary(cw, c, wr, nowMs)
	// A departure changes no rate but the ship's displayed location, so the
	// client re-fetches then as well.
	for _, s := range cw.Ships {
		if s.Leg != nil && s.Leg.DepartAtMs > nowMs {
			at = min(at, s.Leg.DepartAtMs)
		}
		// The end of unloading after a manual leg: the ship becomes idle.
		if s.BerthUntilMs > nowMs {
			at = min(at, s.BerthUntilMs)
		}
	}
	if at != math.MaxInt64 {
		s := time.UnixMilli(at).UTC().Format(timeLayout)
		ds.NextChangeAt = &s
	}
	pop := worldPopulation(cw, c)
	for _, t := range c.Tiers {
		st := evaluateTier(cw, c, t, pop)
		td := TierDisplay{
			ID: t.ID, Unlocked: TierUnlocked(cw, c, t.ID),
			Population: map[string]PopulationDisplay{}, Buildings: st.buildings,
		}
		for tier, v := range st.population {
			td.Population[tier] = PopulationDisplay{Have: v[0], Need: v[1]}
		}
		ds.Tiers = append(ds.Tiers, td)
	}
	for i, is := range cw.Islands {
		ds.Islands = append(ds.Islands, displayIsland(cw, is, c, wr.islands[i], nowMs))
	}
	for _, s := range cw.Ships {
		ds.Ships = append(ds.Ships, displayShip(s, c))
	}
	for _, r := range cw.Routes {
		ds.Routes = append(ds.Routes, displayRoute(cw, c, r))
	}
	ds.Insolvency = displayInsolvency(cw, c, wr, nowMs)
	ds.Quests = displayQuests(cw, c, wr, nowMs)
	ds.AwaySummary = cw.PendingSummary
	ds.LastSeenAt = cw.LastSeenAt.UTC().Format(timeLayout)
	return ds, nil
}

// displayQuests derives the quest block of a settled world.
func displayQuests(w *World, c *content.Catalogue, wr *worldRates, now int64) QuestsDisplay {
	d := QuestsDisplay{Active: []ActiveQuestDisplay{}, Claimable: claimableQuests(w, c), Completed: []CompletedQuestDisplay{}}
	env := &questEnv{w: w, c: c, now: now, wr: wr}
	for _, q := range c.Quests {
		if !questActive(w, q) {
			continue
		}
		aq := ActiveQuestDisplay{ID: q.ID, Objectives: []ObjectiveDisplay{}}
		for _, o := range q.Objectives {
			cur, _ := env.objectiveValue(o)
			if o.Kind == content.ObjectiveSatisfaction && cur > 0 {
				cur /= 1000 // ppm -> per-mille (-1 without a house stays -1)
			}
			target := ObjectiveTarget(o)
			aq.Objectives = append(aq.Objectives, ObjectiveDisplay{
				Kind: o.Kind, Type: o.Building + o.Ship, Good: o.Good, Tier: o.Tier, Island: o.Island,
				Current: cur, Target: target, Met: env.met(o),
			})
		}
		d.Active = append(d.Active, aq)
	}
	for _, id := range sortedCompletions(w, c) {
		st := w.Quests[id]
		d.Completed = append(d.Completed, CompletedQuestDisplay{ID: id, CompletedAt: formatMs(st.CompletedAtMs), Claimed: st.Claimed})
	}
	return d
}

// displayInsolvency counts the unpaid buildings and ships of a settled
// world and computes the balance with all of them running.
func displayInsolvency(w *World, c *content.Catalogue, wr *worldRates, now int64) InsolvencyDisplay {
	d := InsolvencyDisplay{BalanceIfResumedPerMin: wr.balance}
	for _, is := range w.Islands {
		for _, b := range is.Buildings {
			if b.Paused && b.PausedReason == PausedReasonUnpaid {
				d.UnpaidBuildings++
				d.UnpaidUpkeepPerMin += pauseTarget{is: is, b: b}.upkeep(c)
			}
		}
	}
	for _, s := range w.Ships {
		if s.Paused && s.PausedReason == PausedReasonUnpaid {
			d.UnpaidShips++
			d.UnpaidUpkeepPerMin += pauseTarget{s: s}.upkeep(c)
		}
	}
	if d.UnpaidBuildings+d.UnpaidShips > 0 {
		d.BalanceIfResumedPerMin = balanceAllResumed(w, c, now)
	}
	return d
}

func formatMs(ms int64) string { return time.UnixMilli(ms).UTC().Format(timeLayout) }

func displayShip(s *Ship, c *content.Catalogue) ShipDisplay {
	d := ShipDisplay{
		ID: s.ID, Type: s.Type, Name: s.Name, State: s.State, IslandID: s.IslandID, RouteID: s.RouteID, StopIndex: s.StopIndex,
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
		if l.From != nil {
			d.Leg.FromPosition = &PositionDisplay{X: l.From.X, Y: l.From.Y}
		}
	}
	if p := s.AtSea; p != nil {
		d.Position = &PositionDisplay{X: p.X, Y: p.Y}
	}
	if s.State == ShipWaitingForBerth {
		d.QueuedAt = ptr(formatMs(s.QueuedAtMs))
	}
	if s.BerthUntilMs > 0 {
		d.BerthUntil = ptr(formatMs(s.BerthUntilMs))
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
	hold, ships := routeHold(w, c, r)
	d.Effects = []RouteEffectDisplay{}
	for _, e := range routeEffects(r, hold) {
		d.Effects = append(d.Effects, RouteEffectDisplay{
			IslandID: e.IslandID, Good: e.Good, PerLoop: e.PerLoop, PerMin: routePerMin(e.PerLoop, ships, d.LoopMs),
		})
	}
	return d
}

func displayIsland(w *World, is *Island, c *content.Catalogue, r *rates, now int64) IslandDisplay {
	d := IslandDisplay{
		ID: is.ID, Name: is.Name, SizeClass: is.SizeClass, Settled: settled(is, c), Position: PositionDisplay{X: is.X, Y: is.Y},
		Width: is.Width, Height: is.Height,
		Inventory: map[string]GoodDisplay{}, Roads: []RoadDisplay{}, Buildings: []BuildingDisplay{},
		Workforce: map[string]WorkforceDisplay{}, Population: islandPopulation(is, c),
		Fertilities: append([]string{}, is.Fertilities...), Deposits: IslandDeposits(is), TerrainMask: TerrainMask(is),
	}
	if sc := c.Islands.SizeClassByID[is.SizeClass]; sc != nil {
		d.Rock = sc.Rock
	}
	for tier, p := range r.workforce {
		d.Workforce[tier] = WorkforceDisplay{Available: p.available, Required: p.required, FactorPermille: p.factorPermille()}
	}
	if tp, def := tradingPost(is, c); tp != nil {
		level := min(max(tp.Level, 1), def.LevelCount())
		d.CapacitySource = &CapacitySourceDisplay{BuildingID: tp.ID, Type: tp.Type, Level: level, Capacity: def.TradingPostLevelAt(level).Capacity}
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
	summaries := farmFieldSummaries(is, c)
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
		if def.Fields != nil {
			fd := &FieldsDisplay{Required: def.Fields.Required, Max: def.Fields.Max, IDs: []int64{}}
			if s := summaries[b.ID]; s != nil {
				fd.Active, fd.IDs = s.Active, s.IDs
			}
			bd.Fields = fd
		}
		if def.Field != nil {
			bd.FarmID = ptr(b.FarmID)
			bd.Active = ptr(!b.Inactive)
			if b.Inactive {
				bd.Status = StatusNotAdjacent
			}
		}
		if def.Shipyard != nil {
			bd.ShipOrder.Present = true
			if o := b.Order; o != nil {
				bd.ShipOrder.Order = &ShipOrderDisplay{Type: o.Type, OrderedAt: formatMs(o.OrderedAtMs), DueAt: formatMs(o.DueAtMs)}
			}
		}
		if def.Service != nil && def.Upgradable() {
			bd.Level = ptr(min(max(b.Level, 1), def.LevelCount()))
		}
		if def.Collector() {
			level := min(max(b.Level, 1), def.LevelCount())
			load := r.loads[b.ID]
			var permille int64
			if load.t > 0 {
				permille = load.r * 1000 / load.t
			}
			bd.Level, bd.ThroughputPerMin, bd.LoadPermille = &level, ptr(def.ThroughputAt(level)), &permille
			if def.TradingPost != nil {
				bd.Capacity = ptr(def.TradingPostLevelAt(level).Capacity)
				bd.Berths = &BerthsDisplay{Total: berthTotal(is), Ships: []int64{}, Queue: []int64{}}
				for _, s := range berthHolders(w, is.ID, now) {
					bd.Berths.Ships = append(bd.Berths.Ships, s.ID)
				}
				bd.Berths.Busy = len(bd.Berths.Ships)
				for _, s := range berthQueue(w, is.ID) {
					bd.Berths.Queue = append(bd.Berths.Queue, s.ID)
				}
			}
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
	bd.TaxRatePerMin = ptr(h.tax)
	bd.Needs = []NeedDisplay{}
	for _, n := range h.needs {
		nd := NeedDisplay{
			ID: n.need.ID, Kind: n.need.Kind, Category: n.need.Category,
			FulfilmentPermille: n.fulfilment / 1000, Reason: n.reason,
		}
		if len(n.need.Buildings) == 1 {
			// A lone public building names the need; a services category
			// with alternatives is named by its category.
			nd.Building = n.need.Buildings[0].Building
		}
		if gs := n.goods; gs != nil {
			nd.Goods = map[string]Qty{}
			for i, g := range n.need.Goods {
				nd.Goods[g.Good] = perMin(gs.cons[i])
			}
		}
		bd.Needs = append(bd.Needs, nd)
		bd.ServedBy = append(bd.ServedBy, n.servedBy...)
	}
	slices.Sort(bd.ServedBy)
	bd.ServedBy = slices.Compact(bd.ServedBy)
}

func displayProducer(bd *BuildingDisplay, is *Island, c *content.Catalogue, p *producer) {
	b, rec := p.b, p.def.Recipe
	bd.ThroughputFactorPermille = p.throughput
	bd.Rates = &RatesDisplay{Inputs: map[string]Qty{}, Outputs: map[string]Qty{}}
	for _, in := range p.in {
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
		for i, in := range p.in {
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
