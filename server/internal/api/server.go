// Package api implements the HTTP API under /api/v1 (docs/ARCHITECTURE.md
// §4.4). The contract is server/api/openapi.yaml; tests validate requests
// and responses against it.
//
// Every world request advances the world to the current world time before
// reading or applying anything (MECHANICS §1.1). Handlers reach the world
// only through store.Store and a request-scoped WorldResolver.
package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"slices"
	"strings"
	"time"

	"github.com/ricoberger/new-shores/server/internal/content"
	"github.com/ricoberger/new-shores/server/internal/sim"
	"github.com/ricoberger/new-shores/server/internal/store"
)

// WorldResolver returns the world a request acts on. The dev server
// resolves every request to its single world; M2 resolves the world of the
// session's player.
type WorldResolver func(r *http.Request) (store.WorldID, error)

// Config configures the API handler.
type Config struct {
	Store     store.Store
	Catalogue *content.Catalogue
	// Clock is the wall clock (WallClock in production). It is only used
	// for request durations; world time comes from the store.
	Clock        Clock
	ResolveWorld WorldResolver
	// CORSOrigins are the browser origins allowed to call /api/ (exact
	// match, e.g. "http://localhost:5173"). A request whose Origin header is
	// in the list gets it echoed in Access-Control-Allow-Origin; other
	// origins get no CORS headers. Empty disables CORS.
	CORSOrigins []string
	Logger      *slog.Logger
}

// Server is the API handler.
type Server struct {
	cfg     Config
	content []byte
	routes  map[string]map[string]http.HandlerFunc
}

// New returns the API handler.
func New(cfg Config) (*Server, error) {
	if cfg.Store == nil || cfg.Catalogue == nil || cfg.Clock == nil || cfg.ResolveWorld == nil {
		return nil, errors.New("api: store, catalogue, clock and world resolver are required")
	}
	if cfg.Logger == nil {
		cfg.Logger = slog.New(slog.NewTextHandler(io.Discard, nil))
	}
	body, err := json.Marshal(newContentPayload(cfg.Catalogue))
	if err != nil {
		return nil, fmt.Errorf("api: encode content: %w", err)
	}
	s := &Server{cfg: cfg, content: append(body, '\n')}
	s.routes = map[string]map[string]http.HandlerFunc{
		"/api/v1/world":                  {http.MethodGet: s.getWorld},
		"/api/v1/world/commands":         {http.MethodPost: s.postCommand},
		"/api/v1/content":                {http.MethodGet: s.getContent},
		islandPathPrefix + "{island_id}": {http.MethodGet: s.getIsland},
		"/healthz":                       {http.MethodGet: s.getHealth},
	}
	return s, nil
}

// requestInfo collects per-request details for the access log.
type requestInfo struct {
	command   string
	errorCode string
}

type infoKey struct{}

func info(ctx context.Context) *requestInfo {
	if ri, ok := ctx.Value(infoKey{}).(*requestInfo); ok {
		return ri
	}
	return &requestInfo{}
}

type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (r *statusRecorder) WriteHeader(status int) {
	r.status = status
	r.ResponseWriter.WriteHeader(status)
}

// ServeHTTP logs the request, applies CORS and dispatches to the routes.
func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	begin := s.cfg.Clock.Now()
	ri := &requestInfo{}
	rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
	s.serve(rec, r.WithContext(context.WithValue(r.Context(), infoKey{}, ri)))
	attrs := []any{
		"method", r.Method, "path", r.URL.Path, "status", rec.status,
		"duration_ms", float64(s.cfg.Clock.Now().Sub(begin).Microseconds()) / 1000,
	}
	if ri.command != "" {
		attrs = append(attrs, "command", ri.command)
	}
	if ri.errorCode != "" {
		attrs = append(attrs, "error_code", ri.errorCode)
	}
	s.cfg.Logger.Info("request", attrs...)
}

func (s *Server) serve(w http.ResponseWriter, r *http.Request) {
	if strings.HasPrefix(r.URL.Path, "/api/") && len(s.cfg.CORSOrigins) > 0 {
		h := w.Header()
		h.Add("Vary", "Origin")
		if origin := r.Header.Get("Origin"); origin != "" && slices.Contains(s.cfg.CORSOrigins, origin) {
			h.Set("Access-Control-Allow-Origin", origin)
		}
		if r.Method == http.MethodOptions {
			h.Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
			h.Set("Access-Control-Allow-Headers", "Content-Type")
			h.Set("Access-Control-Max-Age", "600")
			w.WriteHeader(http.StatusNoContent)
			return
		}
	}
	path := r.URL.Path
	if strings.HasPrefix(path, islandPathPrefix) && len(path) > len(islandPathPrefix) {
		path = islandPathPrefix + "{island_id}"
	}
	methods, ok := s.routes[path]
	if !ok {
		s.writeError(w, r, &apiError{code: CodeNotFound, status: http.StatusNotFound, message: "no such endpoint: " + r.URL.Path})
		return
	}
	h, ok := methods[r.Method]
	if !ok {
		for m := range methods {
			w.Header().Set("Allow", m)
		}
		s.writeError(w, r, &apiError{code: CodeMethodNotAllowed, status: http.StatusMethodNotAllowed, message: "method " + r.Method + " not allowed"})
		return
	}
	h(w, r)
}

// worldResponse is the envelope of world responses.
type worldResponse struct {
	Version int64            `json:"version"`
	Display sim.DisplayState `json:"display"`
}

// advance moves the world to the world time delivered by the store. A time
// before the last evaluation is sim.ErrTimeBackwards (500 time_backwards);
// only the dev store clamps a wall clock that stepped backwards.
func (s *Server) advance(w *sim.World, now time.Time) error {
	_, err := sim.Advance(w, s.cfg.Catalogue, now)
	return err
}

func (s *Server) getWorld(w http.ResponseWriter, r *http.Request) {
	id, err := s.cfg.ResolveWorld(r)
	if err != nil {
		s.writeError(w, r, err)
		return
	}
	var ds sim.DisplayState
	version, err := s.cfg.Store.Update(r.Context(), id, func(world *sim.World, _ int64, now time.Time) (bool, error) {
		if err := s.advance(world, now); err != nil {
			return false, err
		}
		var err error
		ds, err = sim.Display(world, s.cfg.Catalogue, now)
		return false, err
	})
	if err != nil {
		s.writeError(w, r, err)
		return
	}
	s.writeJSON(w, http.StatusOK, worldResponse{Version: version, Display: ds})
}

func (s *Server) postCommand(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxBodyBytes))
	if err != nil {
		s.writeError(w, r, badRequest(fmt.Sprintf("request body: %v", err)))
		return
	}
	var req commandRequest
	if err := decodeStrict(body, &req); err != nil {
		s.writeError(w, r, err)
		return
	}
	typ, cmd, err := decodeCommand(req.Command)
	info(r.Context()).command = typ
	if err != nil {
		s.writeError(w, r, err)
		return
	}
	id, err := s.cfg.ResolveWorld(r)
	if err != nil {
		s.writeError(w, r, err)
		return
	}
	var ds sim.DisplayState
	version, err := s.cfg.Store.Update(r.Context(), id, func(world *sim.World, version int64, now time.Time) (bool, error) {
		if req.Version != nil && *req.Version != version {
			s.cfg.Logger.Info("stale client version", "command", typ, "client_version", *req.Version, "version", version)
		}
		if err := s.advance(world, now); err != nil {
			return false, err
		}
		if err := checkTileCount(world, cmd); err != nil {
			return false, err
		}
		if err := sim.Apply(world, s.cfg.Catalogue, cmd); err != nil {
			return false, err
		}
		var err error
		ds, err = sim.Display(world, s.cfg.Catalogue, now)
		return err == nil, err
	})
	if err != nil {
		s.writeError(w, r, err)
		return
	}
	s.writeJSON(w, http.StatusOK, worldResponse{Version: version, Display: ds})
}

// islandPathPrefix is the prefix of GET /api/v1/world/islands/{island_id}.
const islandPathPrefix = "/api/v1/world/islands/"

// islandResponse is the static data of an island: its terrain, row-major
// (index y*width + x), as terrain IDs. Revision identifies the data for
// client caching; it is the content version until island generation (M4)
// gives islands their own identity. Fertilities and deposit slots will be
// added as sibling arrays.
type islandResponse struct {
	ID       string   `json:"id"`
	Width    int      `json:"width"`
	Height   int      `json:"height"`
	Revision string   `json:"revision"`
	Terrain  []string `json:"terrain"`
}

// getIsland serves the static data of an island. Like every world request it
// advances the world to the current world time first.
func (s *Server) getIsland(w http.ResponseWriter, r *http.Request) {
	islandID := strings.TrimPrefix(r.URL.Path, islandPathPrefix)
	id, err := s.cfg.ResolveWorld(r)
	if err != nil {
		s.writeError(w, r, err)
		return
	}
	var resp islandResponse
	_, err = s.cfg.Store.Update(r.Context(), id, func(world *sim.World, _ int64, now time.Time) (bool, error) {
		// Every world request advances first (read-only: no new version).
		if err := s.advance(world, now); err != nil {
			return false, err
		}
		is := world.Island(islandID)
		if is == nil {
			return false, fmt.Errorf("%w: %q", sim.ErrUnknownIsland, islandID)
		}
		resp = islandResponse{
			ID: is.ID, Width: is.Width, Height: is.Height,
			Revision: s.cfg.Catalogue.Region.Version, Terrain: make([]string, len(is.Tiles)),
		}
		for i, t := range is.Tiles {
			resp.Terrain[i] = t.Terrain
		}
		return false, nil
	})
	if err != nil {
		s.writeError(w, r, err)
		return
	}
	s.writeJSON(w, http.StatusOK, resp)
}

func (s *Server) getContent(w http.ResponseWriter, _ *http.Request) {
	setJSONHeaders(w)
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(s.content)
}

func (s *Server) getHealth(w http.ResponseWriter, _ *http.Request) {
	s.writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func setJSONHeaders(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
}

func (s *Server) writeJSON(w http.ResponseWriter, status int, v any) {
	body, err := json.Marshal(v)
	if err != nil {
		s.cfg.Logger.Error("encode response", "error", err)
		status, body = http.StatusInternalServerError, []byte(`{"error":{"code":"internal","message":"internal error"}}`)
	}
	setJSONHeaders(w)
	w.WriteHeader(status)
	_, _ = w.Write(append(body, '\n'))
}

// writeError writes the error envelope. Simulation sentinels keep their
// message (it carries the rule detail, e.g. the missing good); other
// internal errors are logged and answered with a generic message.
func (s *Server) writeError(w http.ResponseWriter, r *http.Request, err error) {
	var (
		code, msg string
		status    int
		ae        *apiError
	)
	switch {
	case errors.As(err, &ae):
		code, status, msg = ae.code, ae.status, ae.message
	case errors.Is(err, store.ErrWorldNotFound):
		code, status, msg = CodeNotFound, http.StatusNotFound, err.Error()
	default:
		code, status = classify(err)
		msg = err.Error()
		if code == CodeInternal {
			msg = "internal error"
		}
	}
	if status >= http.StatusInternalServerError {
		s.cfg.Logger.Error("request failed", "method", r.Method, "path", r.URL.Path, "error_code", code, "error", err)
	}
	info(r.Context()).errorCode = code
	s.writeJSON(w, status, errorBody{Error: errorDetail{Code: code, Message: msg}})
}
