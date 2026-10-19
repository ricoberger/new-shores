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
	ErrNoRoadAtEntrance      = errors.New("no road at entrance")
	ErrNoWorkArea            = errors.New("no usable tiles in work area")
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

// Sentinel errors of the population and economy rules.
var (
	ErrTierLocked         = errors.New("tier locked")
	ErrNotAHouse          = errors.New("building is not a house")
	ErrUpgradeUnavailable = errors.New("upgrade unavailable")
	ErrHouseNotFull       = errors.New("house not at maximum residents")
	ErrNeedsUnmet         = errors.New("needs of the current tier not met")
)
