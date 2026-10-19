// Package store holds worlds and serialises access to them.
//
// Store is the boundary between the HTTP handlers and persistence: the dev
// server uses the in-memory implementation (memory.go), M2 implements the
// same interface on PostgreSQL with one row-locked transaction per call
// (docs/ARCHITECTURE.md §4.2).
package store

import (
	"context"
	"errors"

	"github.com/ricoberger/new-shores/server/internal/sim"
)

// ErrWorldNotFound is returned for an unknown world ID.
var ErrWorldNotFound = errors.New("world not found")

// WorldID is an opaque world identifier. Handlers obtain it from a
// request-scoped resolver (dev: a constant; M2: the world of the session's
// player) and never construct it themselves.
type WorldID string

// Store gives exclusive, versioned access to worlds.
//
// Every world carries a version: a counter that starts at 0 and increases by
// one with every committed mutation (a successful command). Clients send the
// version they last saw; a mismatch is not an error (ARCHITECTURE §4.4).
//
// Time: callers advance the world inside Update with sim.Advance before they
// read or apply anything. The time they advance to comes from the caller's
// clock, not from the store. The dev server derives it from the wall clock
// and clamps it to the world's LastEvaluatedAt when the wall clock steps
// backwards. M2 must take "now" from the database's clock (or another
// monotonic source shared by all instances) inside the transaction; advancing
// to a time before LastEvaluatedAt remains sim.ErrTimeBackwards in the
// simulation and must not be papered over there.
type Store interface {
	// Update runs fn with exclusive access to the world: no other Update of
	// the same world runs concurrently. fn receives the world and its
	// current version.
	//
	//   - fn returns (true, nil): the world is committed and the version
	//     incremented; Update returns the new version.
	//   - fn returns (false, nil): read-only access; the version is
	//     unchanged. Pure time advancement done by fn may be kept or
	//     discarded (Advance is composable, so both are equivalent).
	//   - fn returns an error: nothing fn did is kept and Update returns
	//     the error unchanged with the current version.
	Update(ctx context.Context, id WorldID, fn func(w *sim.World, version int64) (mutated bool, err error)) (int64, error)
	// Version returns the current version of the world.
	Version(ctx context.Context, id WorldID) (int64, error)
}
