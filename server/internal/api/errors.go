package api

import (
	"errors"
	"net/http"

	"github.com/ricoberger/new-shores/server/internal/sim"
)

// Error codes that do not come from a simulation sentinel.
const (
	CodeBadRequest       = "bad_request"
	CodeNotFound         = "not_found"
	CodeMethodNotAllowed = "method_not_allowed"
	CodeInternal         = "internal"
)

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
	// 404: a referenced entity does not exist.
	{sim.ErrUnknownIsland, "unknown_island", http.StatusNotFound},
	{sim.ErrBuildingNotFound, "building_not_found", http.StatusNotFound},
	// 409: the command conflicts with the current state.
	{sim.ErrOccupied, "occupied", http.StatusConflict},
	{sim.ErrTerrain, "terrain", http.StatusConflict},
	{sim.ErrNotCoastal, "not_coastal", http.StatusConflict},
	{sim.ErrNoWorkArea, "no_work_area", http.StatusConflict},
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
	return codes
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
