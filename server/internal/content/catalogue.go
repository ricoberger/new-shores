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
//   - variety and optional tax bonuses: parts per million,
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
	// NeedsByTier maps a tier ID to its needs in file order.
	NeedsByTier map[string][]*Need
	// Ships are the ship types in file order (ships.json).
	Ships    []*Ship
	ShipByID map[string]*Ship
	// Start is the starting stock granted after the first warehouse.
	Start Start
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
	// OptionalTaxBonus is the tax bonus of fully met optional needs (ppm).
	OptionalTaxBonus int64
	// AutoResumeMs is the gold reserve, in milliseconds of a building's
	// upkeep, required before an unpaid building is auto-resumed.
	AutoResumeMs int64
	// ShipHandlingMs is the time a ship spends at a stop (unload, load)
	// before it departs (MECHANICS §9.2).
	ShipHandlingMs int64
	// ShipSpeedMilliTilesPerMin is the archipelago distance a ship of speed
	// 1.0 covers per minute, in milli-tiles.
	ShipSpeedMilliTilesPerMin int64
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
// optional capability blocks (Recipe, House, Warehouse, Road, Service,
// WorkArea); the simulation never switches on building IDs.
type Building struct {
	ID     string
	Name   string
	Region string
	Tier   string
	// Width and Height of the footprint at rotation 0.
	Width        int
	Height       int
	Coastal      bool
	RequiresRoad bool
	Cost         Cost
	// UpkeepPerMin is in milli-gold per minute.
	UpkeepPerMin  Qty
	PauseCategory string

	Recipe    *Recipe
	House     *House
	Warehouse *Warehouse
	Road      *Road
	Service   *Service
	WorkArea  *WorkArea
	Workforce *Workforce
	Shipyard  *Shipyard
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

// Warehouse describes the warehouse levels (MECHANICS §5).
type Warehouse struct {
	Levels []WarehouseLevel
}

// WarehouseLevel is one warehouse level.
type WarehouseLevel struct {
	// Capacity per good in milli-units.
	Capacity Qty
	// ThroughputPerMin in milli-units per minute.
	ThroughputPerMin Qty
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

// WorkArea is the data-driven work-area rule (MECHANICS §2):
// efficiency = min(1, matching tiles within Radius / RequiredTiles).
type WorkArea struct {
	Radius        int
	Terrain       []string
	RequiredTiles int
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
	ID   string
	Tier string
	// Kind is NeedRequired or NeedOptional.
	Kind string
	// Weight in parts per million.
	Weight int64

	// Category, Goods, VarietyBonus (ppm per extra good) and MaxExtraGoods
	// are set for goods needs. Goods keep the file order.
	Category      string
	Goods         []NeedGood
	VarietyBonus  int64
	MaxExtraGoods int

	// Building and Radius are set for building needs.
	Building string
	Radius   int
}

// NeedGood is an acceptable good of a goods need.
type NeedGood struct {
	Good string
	// PerResidentPerMin in milli-units per resident per minute.
	PerResidentPerMin Qty
}

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
