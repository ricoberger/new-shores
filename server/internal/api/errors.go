package api

import (
	"errors"
	"net"
	"net/http"

	"github.com/jackc/pgx/v5/pgconn"

	"github.com/ricoberger/new-shores/server/internal/auth"
	"github.com/ricoberger/new-shores/server/internal/sim"
)

// Error codes that do not come from a simulation sentinel.
const (
	CodeBadRequest       = "bad_request"
	CodeNotFound         = "not_found"
	CodeMethodNotAllowed = "method_not_allowed"
	CodeInternal         = "internal"
)

// Error codes of accounts, sessions and infrastructure (M2).
const (
	CodeUnauthorized       = "unauthorized"
	CodeInvalidCredentials = "invalid_credentials" // #nosec G101 -- an error code, not a credential.
	CodeCSRFRejected       = "csrf_rejected"
	CodeRateLimited        = "rate_limited"
	CodeEmailTaken         = "email_taken"
	CodeAlreadyRegistered  = "already_registered"
	CodeInvalidToken       = "invalid_token"
	CodeWeakPassword       = "weak_password"
	CodeServiceUnavailable = "service_unavailable"
)

// accountCodes are the M2 codes in the order of ErrorCodes.
var accountCodes = []string{
	CodeUnauthorized, CodeInvalidCredentials, CodeCSRFRejected, CodeRateLimited, CodeEmailTaken,
	CodeAlreadyRegistered, CodeInvalidToken, CodeWeakPassword, CodeServiceUnavailable,
}

var errUnauthorized = &apiError{code: CodeUnauthorized, status: http.StatusUnauthorized, message: "no valid session"}

// authErrors maps account errors to codes. ErrInvalidEmail and
// ErrInvalidDisplayName are malformed input (bad_request).
var authErrors = []struct {
	err    error
	code   string
	status int
}{
	{auth.ErrUnauthorized, CodeUnauthorized, http.StatusUnauthorized},
	{auth.ErrInvalidCredentials, CodeInvalidCredentials, http.StatusUnauthorized},
	{auth.ErrEmailTaken, CodeEmailTaken, http.StatusConflict},
	{auth.ErrAlreadyRegistered, CodeAlreadyRegistered, http.StatusConflict},
	{auth.ErrInvalidToken, CodeInvalidToken, http.StatusBadRequest},
	{auth.ErrWeakPassword, CodeWeakPassword, http.StatusBadRequest},
	{auth.ErrInvalidEmail, CodeBadRequest, http.StatusBadRequest},
	{auth.ErrInvalidDisplayName, CodeBadRequest, http.StatusBadRequest},
}

// authCode returns the API error of an account error, or nil.
func authCode(err error) *apiError {
	for _, e := range authErrors {
		if errors.Is(err, e.err) {
			return &apiError{code: e.code, status: e.status, message: e.err.Error()}
		}
	}
	return nil
}

// unavailable reports errors of an unreachable database (503).
func unavailable(err error) bool {
	var (
		ce  *pgconn.ConnectError
		ope *net.OpError
	)
	return errors.As(err, &ce) || errors.As(err, &ope)
}

// simError maps a simulation sentinel to its public error code and HTTP
// status. Codes are a stable public contract (enumerated in
// server/api/openapi.yaml): the snake_case name of the sentinel without the
// Err prefix. TestErrorCodesCoverSentinels fails when a sentinel is added to
// internal/sim without an entry here.
type simError struct {
	err    error
	code   string
	status int
}

var simErrors = []simError{
	// 400: the command itself is invalid.
	{sim.ErrInvalidCommand, "invalid_command", http.StatusBadRequest},
	{sim.ErrUnknownBuilding, "unknown_building", http.StatusBadRequest},
	{sim.ErrOutOfBounds, "out_of_bounds", http.StatusBadRequest},
	{sim.ErrRouteInvalid, "route_invalid", http.StatusBadRequest},
	// 404: a referenced entity does not exist.
	{sim.ErrUnknownIsland, "unknown_island", http.StatusNotFound},
	{sim.ErrBuildingNotFound, "building_not_found", http.StatusNotFound},
	{sim.ErrShipNotFound, "ship_not_found", http.StatusNotFound},
	{sim.ErrRouteNotFound, "route_not_found", http.StatusNotFound},
	{sim.ErrQuestNotFound, "quest_not_found", http.StatusNotFound},
	// 409: the command conflicts with the current state.
	{sim.ErrOccupied, "occupied", http.StatusConflict},
	{sim.ErrTerrain, "terrain", http.StatusConflict},
	{sim.ErrNotCoastal, "not_coastal", http.StatusConflict},
	{sim.ErrNotOnWater, "not_on_water", http.StatusConflict},
	{sim.ErrNoWorkArea, "no_work_area", http.StatusConflict},
	{sim.ErrNoFertility, "no_fertility", http.StatusConflict},
	{sim.ErrNoDeposit, "no_deposit", http.StatusConflict},
	{sim.ErrInsufficientGold, "insufficient_gold", http.StatusConflict},
	{sim.ErrInsufficientMaterials, "insufficient_materials", http.StatusConflict},
	{sim.ErrSurplusLoss, "surplus_loss", http.StatusConflict},
	{sim.ErrNotPausable, "not_pausable", http.StatusConflict},
	{sim.ErrNoRoad, "no_road", http.StatusConflict},
	{sim.ErrTierLocked, "tier_locked", http.StatusConflict},
	{sim.ErrNotAHouse, "not_a_house", http.StatusConflict},
	{sim.ErrUpgradeUnavailable, "upgrade_unavailable", http.StatusConflict},
	{sim.ErrHouseNotFull, "house_not_full", http.StatusConflict},
	{sim.ErrNeedsUnmet, "needs_unmet", http.StatusConflict},
	{sim.ErrUpgradeOnly, "upgrade_only", http.StatusConflict},
	{sim.ErrShipyardBusy, "shipyard_busy", http.StatusConflict},
	{sim.ErrNotAShipyard, "not_a_shipyard", http.StatusConflict},
	{sim.ErrUnknownShipType, "unknown_ship_type", http.StatusConflict},
	{sim.ErrNoShipOrder, "no_ship_order", http.StatusConflict},
	{sim.ErrShipNotIdle, "ship_not_idle", http.StatusConflict},
	{sim.ErrShipNotOnRoute, "ship_not_on_route", http.StatusConflict},
	{sim.ErrRouteInUse, "route_in_use", http.StatusConflict},
	{sim.ErrIslandAlreadySettled, "island_already_settled", http.StatusConflict},
	{sim.ErrIslandNotSettled, "island_not_settled", http.StatusConflict},
	{sim.ErrCargoInsufficient, "cargo_insufficient", http.StatusConflict},
	{sim.ErrCargoExceedsSlots, "cargo_exceeds_slots", http.StatusConflict},
	{sim.ErrLastWarehouse, "last_warehouse", http.StatusConflict},
	{sim.ErrNotConnected, "not_connected", http.StatusConflict},
	{sim.ErrQuestNotCompleted, "quest_not_completed", http.StatusConflict},
	{sim.ErrQuestAlreadyClaimed, "quest_already_claimed", http.StatusConflict},
	{sim.ErrNoFarmInRange, "no_farm_in_range", http.StatusConflict},
	{sim.ErrFieldTypeMismatch, "field_type_mismatch", http.StatusConflict},
	{sim.ErrNotAField, "not_a_field", http.StatusConflict},
	// 500: never caused by a command (seeding, persistence and time
	// errors); a response with one of these codes is a server bug.
	{sim.ErrOverCapacity, "over_capacity", http.StatusInternalServerError},
	{sim.ErrTimeBackwards, "time_backwards", http.StatusInternalServerError},
	{sim.ErrSchemaVersion, "schema_version", http.StatusInternalServerError},
	{sim.ErrDisplayTime, "display_time", http.StatusInternalServerError},
}

// classify returns the error code and HTTP status of err. Errors that are
// not simulation sentinels are internal.
func classify(err error) (string, int) {
	for _, e := range simErrors {
		if errors.Is(err, e.err) {
			return e.code, e.status
		}
	}
	return CodeInternal, http.StatusInternalServerError
}

// ErrorCodes returns every error code the API can return.
func ErrorCodes() []string {
	codes := []string{CodeBadRequest, CodeNotFound, CodeMethodNotAllowed, CodeInternal}
	for _, e := range simErrors {
		codes = append(codes, e.code)
	}
	return append(codes, accountCodes...)
}

// apiError is a client error detected by the handlers before the
// simulation (malformed JSON, missing fields).
type apiError struct {
	code    string
	status  int
	message string
}

func (e *apiError) Error() string { return e.message }

func badRequest(msg string) *apiError {
	return &apiError{code: CodeBadRequest, status: http.StatusBadRequest, message: msg}
}

// errorBody is the error envelope of every non-2xx response.
type errorBody struct {
	Error errorDetail `json:"error"`
}

type errorDetail struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}
