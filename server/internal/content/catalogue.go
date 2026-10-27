// Package content loads, validates and exposes the game content of a region
// (content/<region>/*.json) as a typed, read-only Catalogue.
//
// All numeric values that enter the simulation are converted to fixed-point
// integers at load time (docs/ARCHITECTURE.md §6, MECHANICS §1.1):
//
//   - goods quantities, gold and residents: milli-units (1 unit = 1000),
//   - rates per minute (upkeep, taxes, needs, warehouse throughput): milli-units
//     per minute,
//   - durations (cycles, transfer delays, coarse step): milliseconds,
//   - need weights, satisfaction-like ratios (growth threshold): parts per
//     million,
//   - need shares (coverage per alternative): parts per million,
//   - growth and decline rates: milli-residents per minute,
//   - ship speed: per-mille of the reference speed; the reference speed
//     (region rule) in milli-tiles per minute.
package content

// Qty is a fixed-point quantity in milli-units (1 unit = 1000).
type Qty = int64

// Scale factors used by the fixed-point conversion.
const (
	// MilliPerUnit is the number of milli-units in one unit.
	MilliPerUnit = 1000
	// WeightScale is the fixed-point scale of need weights (parts per million).
	WeightScale = 1_000_000
)

// Terrain types of island tiles (MECHANICS §2).
const (
	TerrainWater    = "water"
	TerrainCoast    = "coast"
	TerrainGrass    = "grass"
	TerrainForest   = "forest"
	TerrainMountain = "mountain"
)

// Catalogue is the validated content of one region. It must be treated as
// read-only after Load returns; the simulation shares one Catalogue between
// all worlds.
type Catalogue struct {
	Region Region

	// Tiers in progression order (array order of tiers.json).
	Tiers     []*Tier
	TierByID  map[string]*Tier
	Goods     []*Good
	GoodByID  map[string]*Good
	Buildings []*Building
	// BuildingByID maps a building content ID to its definition.
	BuildingByID map[string]*Building
	// FieldByType maps a field type (Field.Type) to the field building that
	// declares it (D-049); every field type has exactly one building.
	FieldByType map[string]*Building
	// NeedsByTier maps a tier ID to its needs in file order.
	NeedsByTier map[string][]*Need
	// NeedCategories are the goods-need categories in file order
	// (need_categories.json): display data only.
	NeedCategories   []*NeedCategory
	NeedCategoryByID map[string]*NeedCategory
	// Ships are the ship types in file order (ships.json).
	Ships    []*Ship
	ShipByID map[string]*Ship
	// Quests in content order (quests.json); prerequisites always refer to
	// earlier quests.
	Quests    []*Quest
	QuestByID map[string]*Quest
	// Start is the starting stock of a new world (start.json).
	Start Start
	// Islands are the archipelago generator rules (islands.json, D-053).
	Islands IslandRules
	// IslandNames is the generator's name list (island_names.json).
	IslandNames []string
}

// Objective kinds (quests.json): a closed vocabulary of generic predicates
// over the world state, evaluated by the simulation.
const (
	ObjectiveBuildingCount = "building_count"
	ObjectiveConnected     = "connected"
	ObjectivePopulation    = "population"
	ObjectiveStock         = "stock"
	ObjectiveRouteExists   = "route_exists"
	ObjectiveIslandSettled = "island_settled"
	ObjectiveTierUnlocked  = "tier_unlocked"
	ObjectiveShipCount     = "ship_count"
	ObjectiveSatisfaction  = "satisfaction"
)

// Quest is a guidance quest (quests.json).
type Quest struct {
	ID    string
	Title string
	// Text is advisor prose shown to the player.
	Text string
	// Index is the position in content order.
	Index      int
	Objectives []Objective
	Rewards    Rewards
	// Prerequisites are IDs of earlier quests that must be completed.
	Prerequisites []string
}

// Objective is one quest predicate. Which fields are set depends on Kind;
// Min is in the predicate's natural unit: a count for building_count,
// island_settled and ship_count, milli-residents for population,
// milli-units for stock, parts per million for satisfaction.
type Objective struct {
	Kind string
	// Building is the content building type (building_count, connected).
	Building string
	// Good (stock) and Tier (population, tier_unlocked, satisfaction).
	Good string
	Tier string
	// Island restricts the predicate to one island ("" = archipelago).
	Island string
	Min    int64
}

// Rewards are credited once when the player claims a completed quest.
type Rewards struct {
	// Gold in milli-gold.
	Gold Qty
	// Goods sorted by good ID, in milli-units.
	Goods []GoodAmount
}

// Start is the starting stock of a new world (start.json): granted after the
// first warehouse stands (MECHANICS §8).
type Start struct {
	// Gold in milli-gold.
	Gold Qty
	// Goods sorted by good ID, in milli-units.
	Goods []GoodAmount
}

// Region holds the region identity, its content version and the
// region-wide rule constants.
type Region struct {
	ID      string
	Name    string
	Version string
	Rules   Rules
	Camera  Camera
}

// Camera holds the client view constants of a region. Render data only:
// no rule reads them; they reach the client with the content payload.
type Camera struct {
	// MaxHalfExtent is the largest camera half-extent in tiles (the
	// zoom-out cap).
	MaxHalfExtent int
}

// Rules are region-wide simulation constants (MECHANICS §1.1, §3).
type Rules struct {
	// TransferBaseMs is the base latency of a delivery to the warehouse.
	TransferBaseMs int64
	// UnconnectedBuffer is the per-good output buffer of an unconnected
	// producer, in milli-units.
	UnconnectedBuffer Qty
	// IterationCap is the number of boundaries per Advance after which the
	// simulation switches to coarse steps.
	IterationCap int
	// CoarseStepMs is the length of one coarse step.
	CoarseStepMs int64
	// GrowthPerMin is the growth of a house at satisfaction 1 in
	// milli-residents per minute (MECHANICS §6.1).
	GrowthPerMin Qty
	// DeclinePerMin is the decline rate factor in milli-residents per minute:
	// decline = DeclinePerMin x (threshold - satisfaction).
	DeclinePerMin Qty
	// GrowthThreshold is the satisfaction (ppm) from which houses grow.
	GrowthThreshold int64
	// AutoResumeMs is the gold reserve, in milliseconds of a building's
	// upkeep, required before an unpaid building is auto-resumed.
	AutoResumeMs int64
	// ShipHandlingBaseMs is the fixed part of the time a ship occupies a
	// berth to unload and load (MECHANICS §9.2, §9.3).
	ShipHandlingBaseMs int64
	// ShipHandlingMsPerUnit is the additional handling time per unit
	// (1000 milli-units) of goods moved at a stop.
	ShipHandlingMsPerUnit int64
	// ShipSpeedMilliTilesPerMin is the archipelago distance a ship of speed
	// 1.0 covers per minute, in milli-tiles.
	ShipSpeedMilliTilesPerMin int64
	// TrialResumeMs is the gold reserve, in milliseconds of a building's
	// upkeep, after which an unpaid building is trial-resumed although the
	// recomputed balance with it running is negative (future D-047);
	// strictly greater than AutoResumeMs.
	TrialResumeMs int64
	// AwaySummaryMs is the minimum time since the player's last command
	// after which a request produces a "while you were away" summary.
	AwaySummaryMs int64
}

// Tier is a population tier.
type Tier struct {
	ID   string
	Name string
	// Index is the position in progression order (0 = first tier).
	Index int
	// ResidentsFloor and ResidentsMax are in milli-residents.
	ResidentsFloor Qty
	ResidentsMax   Qty
	// TaxPerResidentPerMin is in milli-gold per resident per minute.
	TaxPerResidentPerMin Qty
	// House is the house building of the tier; "" for a declared-only tier
	// (no house and no needs yet).
	House  string
	Unlock Unlock
}

// Unlock lists the conditions to unlock a tier (MECHANICS §12).
type Unlock struct {
	Population     map[string]int64
	Buildings      []string
	GoodsDelivered []string
}

// Good is a tradeable good.
type Good struct {
	ID   string
	Name string
	Type string
}

// GoodAmount is an amount of a good in milli-units.
type GoodAmount struct {
	Good   string
	Amount Qty
}

// Building is a building definition. Behaviour is attached through the
// optional capability blocks (Recipe, House, TradingPost, Warehouse, Road,
// Service, WorkArea, Fields, Field); the simulation never switches on
// building IDs.
type Building struct {
	ID     string
	Name   string
	Region string
	Tier   string
	// Width and Height of the footprint at rotation 0.
	Width   int
	Height  int
	Coastal bool
	// WaterTiles is the number of front rows of a water-edge building
	// (D-051) that must lie on water (0 for every other building). At
	// rotation 0 the front rows are the top rows (smallest y).
	WaterTiles   int
	RequiresRoad bool
	Cost         Cost
	// UpkeepPerMin is in milli-gold per minute.
	UpkeepPerMin  Qty
	PauseCategory string

	Recipe *Recipe
	House  *House
	// TradingPost marks the Trading Post (D-051): the island's capacity,
	// a collector and the pier for ships.
	TradingPost *TradingPost
	// Warehouse marks an inland collector (D-051): throughput only.
	Warehouse *Warehouse
	Road      *Road
	Service   *Service
	WorkArea  *WorkArea
	Workforce *Workforce
	Shipyard  *Shipyard
	// Fields marks a farm whose efficiency comes from explicit fields
	// (D-049, D-051 part 4); such a farm has at most a WorkArea with a
	// Fertility.
	Fields *FarmFields
	// Field marks a field placeable (1x1 crop tile or 2x2 animal field).
	Field *Field

	// RequiresDeposit is the deposit kind at least one footprint tile must
	// carry ("" for none). Such a building may also stand on mountain tiles.
	RequiresDeposit string
}

// Shipyard marks a building that orders ships (one at a time) of the listed
// types (MECHANICS §9.1).
type Shipyard struct {
	Ships []string
}

// Ship is a ship type (ships.json, CONTENT §8).
type Ship struct {
	ID     string
	Name   string
	Region string
	Tier   string
	// Slots is the number of cargo slots; a slot holds one good.
	Slots int
	// SlotSize is the capacity of one slot in milli-units.
	SlotSize Qty
	// SpeedPermille is the speed factor in per-mille (1000 = reference).
	SpeedPermille int64
	// BuildMs is the shipyard build time.
	BuildMs int64
	// Cost is deducted at order time (gold from the world, materials from
	// the shipyard's island).
	Cost Cost
	// UpkeepPerMin is in milli-gold per minute.
	UpkeepPerMin Qty
}

// Workforce is the number of residents of a tier a producer needs on its
// island (D-035).
type Workforce struct {
	Tier string
	// Amount in milli-residents (whole residents).
	Amount Qty
}

// Cost is a construction cost.
type Cost struct {
	// Gold in milli-gold.
	Gold Qty
	// Materials sorted by good ID.
	Materials []GoodAmount
}

// Recipe is a production recipe (MECHANICS §4).
type Recipe struct {
	Inputs  []GoodAmount
	Outputs []GoodAmount
	CycleMs int64
}

// House marks a residential building of a tier.
type House struct {
	Tier string
}

// TradingPost describes the Trading Post levels (MECHANICS §5, §9.3).
type TradingPost struct {
	Levels []TradingPostLevel
}

// TradingPostLevel is one Trading Post level.
type TradingPostLevel struct {
	// Capacity per good in milli-units.
	Capacity Qty
	// ThroughputPerMin in milli-units per minute (as a collector).
	ThroughputPerMin Qty
	// Berths is the number of ships that can handle cargo at once.
	Berths int
	// Cost is the upgrade cost into this level; nil for the first level
	// (placed with the building cost), set for every later level.
	Cost *Cost
}

// Warehouse describes the levels of an inland collector (MECHANICS §5).
type Warehouse struct {
	Levels []WarehouseLevel
}

// WarehouseLevel is one Warehouse level.
type WarehouseLevel struct {
	// ThroughputPerMin in milli-units per minute.
	ThroughputPerMin Qty
	// Cost is the upgrade cost into this level; nil for the first level
	// (placed with the building cost), set for every later level.
	Cost *Cost
}

// Collector reports whether the building collects producer output (a
// Trading Post or a Warehouse, MECHANICS §5).
func (b *Building) Collector() bool { return b.TradingPost != nil || b.Warehouse != nil }

// LevelCount is the number of levels of a Trading Post or Warehouse (0
// for every other building).
func (b *Building) LevelCount() int {
	switch {
	case b.TradingPost != nil:
		return len(b.TradingPost.Levels)
	case b.Warehouse != nil:
		return len(b.Warehouse.Levels)
	}
	return 0
}

// clampLevel maps a stored level to a valid 0-based level index.
func clampLevel(level, n int) int { return min(max(level, 1), n) - 1 }

// ThroughputAt is the collector throughput (milli-units per minute) of a
// Trading Post or Warehouse at a 1-based level (clamped to the levels);
// 0 for every other building.
func (b *Building) ThroughputAt(level int) Qty {
	switch {
	case b.TradingPost != nil:
		return b.TradingPost.Levels[clampLevel(level, len(b.TradingPost.Levels))].ThroughputPerMin
	case b.Warehouse != nil:
		return b.Warehouse.Levels[clampLevel(level, len(b.Warehouse.Levels))].ThroughputPerMin
	}
	return 0
}

// LevelCost is the upgrade cost into a 1-based level of a Trading Post or
// Warehouse; nil for the first level, out-of-range levels and other
// buildings.
func (b *Building) LevelCost(level int) *Cost {
	if level < 2 || level > b.LevelCount() {
		return nil
	}
	if b.TradingPost != nil {
		return b.TradingPost.Levels[level-1].Cost
	}
	return b.Warehouse.Levels[level-1].Cost
}

// TradingPostLevelAt is the Trading Post level for a 1-based level
// (clamped); the zero level for every other building.
func (b *Building) TradingPostLevelAt(level int) TradingPostLevel {
	if b.TradingPost == nil {
		return TradingPostLevel{}
	}
	return b.TradingPost.Levels[clampLevel(level, len(b.TradingPost.Levels))]
}

// Road marks a road type.
type Road struct {
	// MsPerTile is the transfer time per road tile.
	MsPerTile int64
}

// Service marks a public building with a service radius (building needs).
type Service struct {
	Radius int
}

// FarmFields is the fields block of a farm (D-049, D-051 part 4):
// efficiency = min(1, active fields of Type / Required).
type FarmFields struct {
	// Type is the field type (Field.Type) of the farm; exactly one field
	// building declares it and names this farm.
	Type string
	// Required is the number of active fields for full efficiency.
	Required int
	// Max is the most fields (active or not) the farm may own.
	Max int
}

// Field is the field block of a field placeable (D-049, D-051 part 4): a
// 1x1 crop tile or a 2x2 animal field, placed from its farm's panel next
// to the farm or to one of its active fields.
type Field struct {
	// Type is the field type, unique per field building.
	Type string
	// Farm is the building type of the one farm the field belongs to;
	// its fields.type equals Type.
	Farm    string
	Terrain []string
	// Fertility is the island-wide fertility tag the field needs ("" for
	// none).
	Fertility string
}

// MatchesTerrain reports whether a field may stand on the terrain.
func (f *Field) MatchesTerrain(terrain string) bool {
	for _, t := range f.Terrain {
		if t == terrain {
			return true
		}
	}
	return false
}

// WorkArea is the data-driven work-area rule (MECHANICS §2):
// efficiency = min(1, matching tiles within Radius / RequiredTiles). A farm
// with a Fields block has no radius: only Fertility is set (D-051 part 4).
type WorkArea struct {
	Radius        int
	Terrain       []string
	RequiredTiles int
	// Fertility is the island-wide fertility tag the building needs ("" for
	// none, MECHANICS §2).
	Fertility string
}

// Need kinds (MECHANICS §6.2).
const (
	NeedRequired = "required"
	NeedOptional = "optional"
)

// Need is a goods or building need of a tier (MECHANICS §6.2). A goods need
// has a Category and a non-empty Goods list; a building need has Building and
// Radius.
type Need struct {
	ID string
	// Name is the player-facing name (display data only).
	Name string
	Tier string
	// Kind is NeedRequired or NeedOptional.
	Kind string
	// Weight in parts per million.
	Weight int64

	// Category and Goods are set for goods needs. Goods keep the file
	// order.
	Category string
	Goods    []NeedGood

	// Building, Radius and Share (ppm, the coverage when served) are set
	// for building needs.
	Building string
	Radius   int
	Share    int64
}

// NeedCategory is a goods-need category (need_categories.json): display
// data only, the simulation matches categories by ID.
type NeedCategory struct {
	ID   string
	Name string
	// Icon is a key of the HUD icon set (assets/icons/icons.json).
	Icon string
}

// NeedGood is an acceptable good of a goods need.
type NeedGood struct {
	Good string
	// PerResidentPerMin in milli-units per resident per minute.
	PerResidentPerMin Qty
	// Share is the coverage (ppm) the good contributes to its category at
	// full supply (D-056).
	Share int64
}

// Default need shares (D-056 as amended): an alternative without an
// authored share covers its category alone (ShareLone) when it is the
// category's only alternative, else ShareAlternative each.
const (
	ShareLone        int64 = WeightScale
	ShareAlternative int64 = 600_000
)

// IsGoods reports whether the need is a goods need.
func (n *Need) IsGoods() bool { return len(n.Goods) > 0 }

// MatchesTerrain reports whether terrain counts for the work area.
func (wa *WorkArea) MatchesTerrain(terrain string) bool {
	for _, t := range wa.Terrain {
		if t == terrain {
			return true
		}
	}
	return false
}
