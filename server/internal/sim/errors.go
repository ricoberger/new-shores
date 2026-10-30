package sim

import "errors"

// Sentinel errors returned (wrapped) by Apply, Advance and Decode. Callers
// match them with errors.Is.
var (
	ErrUnknownIsland         = errors.New("unknown island")
	ErrUnknownBuilding       = errors.New("unknown building")
	ErrBuildingNotFound      = errors.New("building not found")
	ErrInvalidCommand        = errors.New("invalid command")
	ErrOutOfBounds           = errors.New("out of bounds")
	ErrOccupied              = errors.New("tile occupied")
	ErrTerrain               = errors.New("terrain not buildable")
	ErrNotCoastal            = errors.New("building must touch the coast")
	ErrNotOnWater            = errors.New("front rows of a water-edge building must be on water")
	ErrHarbourBlocked        = errors.New("harbour closed off from the open sea")
	ErrNoWorkArea            = errors.New("no usable tiles in work area")
	ErrNoFertility           = errors.New("island lacks fertility")
	ErrNoDeposit             = errors.New("no deposit under the footprint")
	ErrInsufficientGold      = errors.New("insufficient gold")
	ErrInsufficientMaterials = errors.New("insufficient materials")
	ErrSurplusLoss           = errors.New("demolition would exceed capacity")
	ErrNotPausable           = errors.New("building cannot be paused")
	ErrNoRoad                = errors.New("no road on tile")
	ErrOverCapacity          = errors.New("exceeds capacity")
	ErrTimeBackwards         = errors.New("time before last evaluation")
	ErrSchemaVersion         = errors.New("unsupported schema version")
	ErrDisplayTime           = errors.New("display time differs from last evaluation")
)

// Sentinel errors of fields (D-049, D-051 part 4).
var (
	ErrFieldTypeMismatch = errors.New("building type is not a field")
	ErrFieldNotAdjacent  = errors.New("field is not adjacent to its farm or an active field")
	ErrFieldMaxReached   = errors.New("farm has the maximum number of fields")
	ErrFieldWrongFarm    = errors.New("field belongs to another farm type")
	ErrFieldNeedsFarm    = errors.New("fields are placed from their farm")
)

// Sentinel errors of the population and economy rules.
var (
	ErrTierLocked         = errors.New("tier locked")
	ErrNotAHouse          = errors.New("building is not a house")
	ErrUpgradeUnavailable = errors.New("upgrade unavailable")
	ErrHouseNotFull       = errors.New("house not at maximum residents")
	ErrNeedsUnmet         = errors.New("needs of the current tier not met")
	ErrUpgradeOnly        = errors.New("house can only be reached by upgrade")
)

// Sentinel errors of ships, routes and settling (MECHANICS §8, §9).
var (
	ErrShipyardBusy         = errors.New("shipyard already has a pending order")
	ErrNotAShipyard         = errors.New("building is not a shipyard")
	ErrUnknownShipType      = errors.New("unknown ship type")
	ErrNoShipOrder          = errors.New("shipyard has no pending order")
	ErrShipNotFound         = errors.New("ship not found")
	ErrShipNotIdle          = errors.New("ship is not idle")
	ErrShipNotOnRoute       = errors.New("ship is not assigned to a route")
	ErrRouteNotFound        = errors.New("route not found")
	ErrRouteInvalid         = errors.New("route invalid")
	ErrRouteInUse           = errors.New("route has assigned ships")
	ErrIslandAlreadySettled = errors.New("island already settled")
	ErrIslandNotSettled     = errors.New("island not settled")
	ErrCargoInsufficient    = errors.New("cargo does not cover the cost")
	ErrCargoExceedsSlots    = errors.New("cargo exceeds the ship's slots")
	ErrLastTradingPost      = errors.New("trading post of an island with other buildings")
	ErrNotConnected         = errors.New("building has no road to a trading post or warehouse")
)

// Sentinel errors of quests and the away summary.
var (
	ErrQuestNotFound       = errors.New("quest not found")
	ErrQuestNotCompleted   = errors.New("quest not completed")
	ErrQuestAlreadyClaimed = errors.New("quest already claimed")
)
