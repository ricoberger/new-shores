package api

import (
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"time"

	"github.com/ricoberger/new-shores/server/internal/content"
	"github.com/ricoberger/new-shores/server/internal/sim"
)

// Error codes of POST /api/v1/dev/snapshot (D-066). They are dev tooling
// codes and not part of ErrorCodes.
const (
	CodeSnapshotSchemaMismatch  = "snapshot_schema_mismatch"
	CodeSnapshotContentMismatch = "snapshot_content_mismatch"
)

// maxSnapshotBytes bounds a snapshot upload (a played world with its
// terrain is a few MiB).
const maxSnapshotBytes = 256 << 20

// devSnapshotResponse answers POST /api/v1/dev/snapshot.
type devSnapshotResponse struct {
	WorldVersion    int64     `json:"world_version"`
	Seed            uint64    `json:"seed"`
	LastEvaluatedAt time.Time `json:"last_evaluated_at"`
}

// getDevSnapshot returns the current dev world as the envelope JSON
// (sim.Encode), advanced to the world time first. Dev mode only and
// without a session: local tooling (make snapshot), like /dev/reset.
func (s *Server) getDevSnapshot(w http.ResponseWriter, r *http.Request) {
	id, err := s.worldID(r)
	if err != nil {
		s.writeError(w, r, err)
		return
	}
	var (
		data []byte
		seed uint64
	)
	if _, err := s.cfg.Store.Update(r.Context(), id, func(world *sim.World, _ int64, now time.Time) (bool, error) {
		if err := s.advance(world, now); err != nil {
			return false, err
		}
		seed = world.Seed
		var err error
		data, err = sim.Encode(world, s.cfg.Catalogue.Region.Version)
		// Like a read: the advance is not a version change.
		return false, err
	}); err != nil {
		s.writeError(w, r, err)
		return
	}
	h := w.Header()
	h.Set("Content-Type", "application/json")
	h.Set("Content-Disposition", fmt.Sprintf("attachment; filename=\"snapshot-%d-%d.json\"", seed, time.Now().Unix()))
	h.Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(data)
}

// postDevSnapshot replaces the dev world with the snapshot in the body
// (an envelope). With ?resume=now the world's times move to the present.
// Dev mode only and without a session (local tooling).
func (s *Server) postDevSnapshot(w http.ResponseWriter, r *http.Request) {
	resume := false
	switch v := r.URL.Query().Get("resume"); v {
	case "":
	case "now":
		resume = true
	default:
		s.writeError(w, r, badRequest(fmt.Sprintf("resume must be \"now\", got %q", v)))
		return
	}
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxSnapshotBytes))
	if err != nil {
		s.writeError(w, r, badRequest(fmt.Sprintf("request body: %v", err)))
		return
	}
	world, err := DecodeSnapshot(body, s.cfg.Catalogue)
	if err != nil {
		s.writeError(w, r, err)
		return
	}
	id, err := s.worldID(r)
	if err != nil {
		s.writeError(w, r, err)
		return
	}
	version, err := s.cfg.DevSnapshotLoad(r.Context(), world, resume)
	if err != nil {
		s.writeError(w, r, err)
		return
	}
	s.published(r, id)
	s.cfg.Logger.Info("dev world snapshot loaded", "seed", world.Seed, "version", version, "resume_now", resume,
		"last_evaluated_at", world.LastEvaluatedAt.Format(time.RFC3339))
	s.writeJSON(w, http.StatusOK, devSnapshotResponse{WorldVersion: version, Seed: world.Seed, LastEvaluatedAt: world.LastEvaluatedAt})
}

// DecodeSnapshot decodes a snapshot envelope like a world load: older
// schema versions are migrated (sim.SchemaMigrations); a schema version
// the migrations cannot bridge, or a content version other than the
// catalogue's, is a 409 error (snapshot_schema_mismatch,
// snapshot_content_mismatch), anything malformed a 400.
func DecodeSnapshot(data []byte, c *content.Catalogue) (*sim.World, error) {
	world, cv, _, err := sim.DecodeWith(data, sim.SchemaMigrations(c))
	switch {
	case errors.Is(err, sim.ErrSchemaVersion):
		return nil, &apiError{code: CodeSnapshotSchemaMismatch, status: http.StatusConflict, message: err.Error()}
	case err != nil:
		return nil, badRequest("snapshot: " + err.Error())
	case cv != c.Region.Version:
		return nil, &apiError{code: CodeSnapshotContentMismatch, status: http.StatusConflict,
			message: "snapshot content version " + strconv.Quote(cv) + " does not match the server's " + strconv.Quote(c.Region.Version)}
	}
	return world, nil
}
