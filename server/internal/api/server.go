// Package api implements the HTTP API under /api/v1 (docs/ARCHITECTURE.md
// §4.4). The contract is server/api/openapi.yaml; tests validate requests
// and responses against it.
//
// Every world request advances the world to the current world time before
// reading or applying anything (MECHANICS §1.1). Handlers reach the world
// only through store.Store and a request-scoped WorldResolver.
package api

import (
	"bufio"
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/netip"
	"slices"
	"strconv"
	"strings"
	"time"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/trace"

	"github.com/ricoberger/new-shores/server/internal/auth"
	"github.com/ricoberger/new-shores/server/internal/content"
	"github.com/ricoberger/new-shores/server/internal/sim"
	"github.com/ricoberger/new-shores/server/internal/sim/archipelago"
	"github.com/ricoberger/new-shores/server/internal/store"
	"github.com/ricoberger/new-shores/server/internal/telemetry"
	"github.com/ricoberger/new-shores/server/internal/ws"
)

// WorldResolver returns the world a request acts on in dev mode (no
// accounts): the dev server resolves every request to its single world.
type WorldResolver func(r *http.Request) (store.WorldID, error)

// Accounts are the account operations of default mode (auth.Service).
type Accounts interface {
	Authenticate(ctx context.Context, token string) (*auth.Session, error)
	Guest(ctx context.Context, deviceToken string) (*auth.Issued, error)
	Register(ctx context.Context, cur *auth.Session, email, password string, displayName *string) (*auth.Issued, error)
	Login(ctx context.Context, cur *auth.Session, email, password string) (*auth.Issued, error)
	Logout(ctx context.Context, cur *auth.Session) error
	Me(ctx context.Context, cur *auth.Session) (auth.Player, error)
	SetLanguage(ctx context.Context, cur *auth.Session, language string) (auth.Player, error)
	VerifyEmail(ctx context.Context, token string) error
	RequestPasswordReset(ctx context.Context, email string) error
	ConfirmPasswordReset(ctx context.Context, token, password string) error
}

// Publisher announces a committed world change (Redis pub/sub in default
// mode, the in-process hub in dev mode). It logs and counts its own
// errors: a failed publish never fails a request.
type Publisher interface {
	Publish(ctx context.Context, id store.WorldID)
}

// HealthReport is the readiness state of default mode.
type HealthReport struct {
	// Postgres is false when the database does not answer (503).
	Postgres bool
	// Redis is "ok" or "unavailable" (reported, not fatal).
	Redis string
}

// Config configures the API handler.
type Config struct {
	Store     store.Store
	Catalogue *content.Catalogue
	// Clock is the wall clock (WallClock in production). It is only used
	// for request durations; world time comes from the store.
	Clock Clock
	// ResolveWorld resolves the world in dev mode (Accounts == nil).
	ResolveWorld WorldResolver
	// Accounts enables sessions and the auth endpoints (default mode).
	// Nil is dev mode: /world* need no session and /auth/* is the dev
	// facade (a fixed logged-in player).
	Accounts Accounts
	// Limiter rate-limits the auth endpoints (default mode; nil disables).
	Limiter auth.Limiter
	// Publisher announces committed world changes (may be nil).
	Publisher Publisher
	// Hub serves /api/v1/ws (nil: the endpoint answers 404).
	Hub *ws.Hub
	// Health reports the dependencies for /healthz (default mode).
	Health func(ctx context.Context) HealthReport
	// CORSOrigins are the browser origins allowed to call /api/ (exact
	// match, e.g. "http://localhost:5173"). A request whose Origin header is
	// in the list gets it echoed in Access-Control-Allow-Origin; other
	// origins get no CORS headers. Empty disables CORS. The same list is
	// the CSRF and WebSocket origin allowlist.
	CORSOrigins []string
	// CookieSecure sets the Secure attribute of the session cookie.
	CookieSecure bool
	// SessionTTL is the Max-Age of the session cookie.
	SessionTTL time.Duration
	// TrustedProxies are the peers whose X-Forwarded-For is trusted.
	TrustedProxies []netip.Prefix
	// DevReset replaces the world with a fresh dev fixture (DevFixtures;
	// "" is the default) and returns the new version. It mounts POST
	// /api/v1/dev/reset in dev mode only (Accounts == nil): the E2E specs
	// start from a known world instead of each other's leftovers. Nil (and
	// default mode) leaves the endpoint absent (404). A DevFixtureError
	// (a fixture the world's seed cannot build) answers 400 with its
	// message; other errors are internal.
	DevReset    func(ctx context.Context, fixture string) (int64, error)
	DevFixtures []string
	// Version and Instance identify the server in /healthz and the
	// X-Instance header (optional).
	Version  string
	Instance string
	Logger   *slog.Logger
}

// Server is the API handler.
type Server struct {
	cfg Config
	// content holds the encoded content payload per shipped language.
	content map[string][]byte
	routes  map[string]map[string]route
}

// access is the session requirement of a route.
type access int

const (
	// public routes need no session.
	public access = iota
	// optionalSession routes use a valid session when there is one.
	optionalSession
	// requireSession routes answer 401 without a valid session.
	requireSession
)

type route struct {
	handler http.HandlerFunc
	access  access
}

// New returns the API handler.
func New(cfg Config) (*Server, error) {
	if cfg.Store == nil || cfg.Catalogue == nil || cfg.Clock == nil {
		return nil, errors.New("api: store, catalogue and clock are required")
	}
	if cfg.Accounts == nil && cfg.ResolveWorld == nil {
		return nil, errors.New("api: a world resolver is required without accounts (dev mode)")
	}
	if cfg.SessionTTL <= 0 {
		cfg.SessionTTL = 30 * 24 * time.Hour
	}
	if cfg.Logger == nil {
		cfg.Logger = slog.New(slog.NewTextHandler(io.Discard, nil))
	}
	bodies := map[string][]byte{}
	for _, lang := range cfg.Catalogue.Languages() {
		body, err := json.Marshal(newContentPayload(cfg.Catalogue, lang))
		if err != nil {
			return nil, fmt.Errorf("api: encode content: %w", err)
		}
		bodies[lang] = append(body, '\n')
	}
	s := &Server{cfg: cfg, content: bodies}
	s.routes = map[string]map[string]route{
		"/api/v1/world":                       {http.MethodGet: {s.getWorld, requireSession}},
		"/api/v1/world/commands":              {http.MethodPost: {s.postCommand, requireSession}},
		"/api/v1/content":                     {http.MethodGet: {s.getContent, public}},
		tilesRoute:                            {http.MethodGet: {s.getIslandTiles, requireSession}},
		"/api/v1/ws":                          {http.MethodGet: {s.getWS, requireSession}},
		"/api/v1/auth/guest":                  {http.MethodPost: {s.postGuest, optionalSession}},
		"/api/v1/auth/register":               {http.MethodPost: {s.postRegister, optionalSession}},
		"/api/v1/auth/login":                  {http.MethodPost: {s.postLogin, optionalSession}},
		"/api/v1/auth/logout":                 {http.MethodPost: {s.postLogout, requireSession}},
		"/api/v1/auth/me":                     {http.MethodGet: {s.getMe, requireSession}, http.MethodPatch: {s.patchMe, requireSession}},
		"/api/v1/auth/verify-email":           {http.MethodPost: {s.postVerifyEmail, public}},
		"/api/v1/auth/password-reset/request": {http.MethodPost: {s.postResetRequest, public}},
		"/api/v1/auth/password-reset/confirm": {http.MethodPost: {s.postResetConfirm, public}},
		"/healthz":                            {http.MethodGet: {s.getHealth, public}},
	}
	if cfg.DevReset != nil && cfg.Accounts == nil {
		s.routes["/api/v1/dev/reset"] = map[string]route{http.MethodPost: {s.postDevReset, requireSession}}
	}
	return s, nil
}

// requestInfo collects per-request details for the access log.
type requestInfo struct {
	command   string
	errorCode string
	route     string
	session   *auth.Session
	// cookie: the session came from the cookie (CSRF applies).
	cookie bool
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

// Unwrap lets http.ResponseController reach the underlying writer.
func (r *statusRecorder) Unwrap() http.ResponseWriter { return r.ResponseWriter }

// Hijack supports the WebSocket upgrade.
func (r *statusRecorder) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	h, ok := r.ResponseWriter.(http.Hijacker)
	if !ok {
		return nil, nil, errors.New("hijacking not supported")
	}
	r.status = http.StatusSwitchingProtocols
	return h.Hijack()
}

// ServeHTTP logs, traces and measures the request, applies CORS and
// dispatches to the routes.
func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	begin := s.cfg.Clock.Now()
	ri := &requestInfo{route: "other"}
	rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
	reqID := newRequestID()
	rec.Header().Set("X-Request-ID", reqID)
	if s.cfg.Instance != "" {
		rec.Header().Set("X-Instance", s.cfg.Instance)
	}
	ctx := otel.GetTextMapPropagator().Extract(r.Context(), propagation.HeaderCarrier(r.Header))
	ctx, span := telemetry.Tracer().Start(ctx, "HTTP "+r.Method, trace.WithSpanKind(trace.SpanKindServer))
	s.serve(rec, r.WithContext(context.WithValue(ctx, infoKey{}, ri)))
	elapsed := s.cfg.Clock.Now().Sub(begin)
	span.SetName("HTTP " + r.Method + " " + ri.route)
	span.SetAttributes(attribute.String("http.request.method", r.Method), attribute.String("http.route", ri.route),
		attribute.Int("http.response.status_code", rec.status))
	attrs := []any{
		"request_id", reqID, "method", r.Method, "path", r.URL.Path, "status", rec.status,
		"duration_ms", float64(elapsed.Microseconds()) / 1000,
	}
	if ri.session != nil {
		attrs = append(attrs, "player_id", ri.session.PlayerID)
		span.SetAttributes(attribute.String("player.id", ri.session.PlayerID), attribute.String("world.id", string(ri.session.WorldID)))
	}
	if ri.command != "" {
		attrs = append(attrs, "command", ri.command)
	}
	if ri.errorCode != "" {
		attrs = append(attrs, "error_code", ri.errorCode)
	}
	if rec.status >= http.StatusInternalServerError {
		span.SetStatus(codes.Error, ri.errorCode)
	}
	span.End()
	telemetry.HTTPRequestDuration.WithLabelValues(r.Method, ri.route, strconv.Itoa(rec.status)).Observe(elapsed.Seconds())
	s.cfg.Logger.Info("request", attrs...)
}

func newRequestID() string {
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func (s *Server) serve(w http.ResponseWriter, r *http.Request) {
	if strings.HasPrefix(r.URL.Path, "/api/") && len(s.cfg.CORSOrigins) > 0 {
		h := w.Header()
		h.Add("Vary", "Origin")
		if origin := r.Header.Get("Origin"); origin != "" && slices.Contains(s.cfg.CORSOrigins, origin) {
			h.Set("Access-Control-Allow-Origin", origin)
			h.Set("Access-Control-Allow-Credentials", "true")
		}
		if r.Method == http.MethodOptions {
			h.Set("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS")
			allow := "Content-Type"
			if s.cfg.Accounts != nil {
				allow = "Content-Type, Authorization"
			}
			h.Set("Access-Control-Allow-Headers", allow)
			h.Set("Access-Control-Max-Age", "600")
			w.WriteHeader(http.StatusNoContent)
			return
		}
	}
	path := r.URL.Path
	if rest, ok := strings.CutPrefix(path, islandPathPrefix); ok {
		if id, ok := strings.CutSuffix(rest, tilesPathSuffix); ok && id != "" && !strings.Contains(id, "/") {
			path = tilesRoute
		}
	}
	methods, ok := s.routes[path]
	if !ok {
		s.writeError(w, r, &apiError{code: CodeNotFound, status: http.StatusNotFound, message: "no such endpoint: " + r.URL.Path})
		return
	}
	ri := info(r.Context())
	ri.route = path
	rt, ok := methods[r.Method]
	if !ok {
		for m := range methods {
			w.Header().Set("Allow", m)
		}
		s.writeError(w, r, &apiError{code: CodeMethodNotAllowed, status: http.StatusMethodNotAllowed, message: "method " + r.Method + " not allowed"})
		return
	}
	if s.cfg.Accounts != nil && rt.access != public {
		sess, fromCookie, err := s.authenticate(w, r)
		ri.session, ri.cookie = sess, fromCookie
		if err != nil && (rt.access == requireSession || !errors.Is(err, errUnauthorized)) {
			s.writeError(w, r, err)
			return
		}
	}
	// CSRF: state-changing requests that carry the session cookie (and no
	// bearer token) must come from an allowed origin. The WebSocket
	// upgrade applies the same check for cookie sessions.
	if s.cfg.Accounts != nil && carriesSessionCookie(r) && (!isSafeMethod(r.Method) || path == "/api/v1/ws") {
		if err := s.checkOrigin(r); err != nil {
			s.writeError(w, r, err)
			return
		}
	}
	rt.handler(w, r)
}

// worldID returns the world of the request: the session's world in
// default mode, the dev world otherwise. World IDs never come from the
// client.
func (s *Server) worldID(r *http.Request) (store.WorldID, error) {
	if s.cfg.Accounts == nil {
		return s.cfg.ResolveWorld(r)
	}
	sess := info(r.Context()).session
	if sess == nil {
		return "", errUnauthorized
	}
	if sess.WorldID == "" {
		return "", store.ErrWorldNotFound
	}
	return sess.WorldID, nil
}

// published announces a committed world change after commit.
func (s *Server) published(r *http.Request, id store.WorldID) {
	if s.cfg.Publisher != nil {
		s.cfg.Publisher.Publish(r.Context(), id)
	}
}

// worldResponse is the envelope of world responses.
type worldResponse struct {
	Version int64            `json:"version"`
	Display sim.DisplayState `json:"display"`
	// TileResults is the per-tile outcome of a batch command
	// (place_fields, demolish_fields), in request order; absent for
	// every other command.
	TileResults []tileResultJSON `json:"tile_results,omitempty"`
}

// tileResultJSON is one tile of a batch command: applied (ok) or rejected
// with the error code the tile alone would have failed with.
type tileResultJSON struct {
	X      int    `json:"x"`
	Y      int    `json:"y"`
	OK     bool   `json:"ok"`
	Reason string `json:"reason,omitempty"`
}

// tileResults converts the sim's per-tile results (nil for none).
func tileResults(rs []sim.TileResult) []tileResultJSON {
	if rs == nil {
		return nil
	}
	out := make([]tileResultJSON, len(rs))
	for i, r := range rs {
		out[i] = tileResultJSON{X: r.X, Y: r.Y, OK: r.Err == nil}
		if r.Err != nil {
			out[i].Reason, _ = classify(r.Err)
		}
	}
	return out
}

// advance moves the world to the world time delivered by the store. A time
// before the last evaluation is sim.ErrTimeBackwards (500 time_backwards);
// only the dev store clamps a wall clock that stepped backwards.
func (s *Server) advance(w *sim.World, now time.Time) error {
	_, err := sim.Advance(w, s.cfg.Catalogue, now)
	return err
}

func (s *Server) getWorld(w http.ResponseWriter, r *http.Request) {
	id, err := s.worldID(r)
	if err != nil {
		s.writeError(w, r, err)
		return
	}
	var (
		ds       sim.DisplayState
		produced bool
	)
	version, err := s.cfg.Store.Update(r.Context(), id, func(world *sim.World, _ int64, now time.Time) (bool, error) {
		if err := s.advance(world, now); err != nil {
			return false, err
		}
		// A read commits only when it produces a "while you were away"
		// summary, so that the summary survives reloads and reaches the
		// player's other devices.
		produced = sim.MaybeProduceSummary(world, s.cfg.Catalogue)
		var err error
		ds, err = s.display(world, now)
		return produced && err == nil, err
	})
	if err != nil {
		s.writeError(w, r, err)
		return
	}
	if produced {
		s.published(r, id)
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
	id, err := s.worldID(r)
	if err != nil {
		s.writeError(w, r, err)
		return
	}
	var (
		ds        sim.DisplayState
		results   []tileResultJSON
		unchanged bool
	)
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
		if err := checkClaimIsland(s.cfg.Catalogue, cmd); err != nil {
			return false, err
		}
		resolved, err := resolveReroll(world, s.cfg.Catalogue, cmd)
		if err != nil {
			return false, err
		}
		res, err := sim.ApplyWithResult(world, s.cfg.Catalogue, resolved, nil)
		if err != nil {
			return false, err
		}
		results = tileResults(res.Tiles)
		if res.Unchanged {
			// A place_fields without a valid tile: the per-tile reasons
			// and the current state, no commit (same version) and no
			// event.
			unchanged = true
			ds, err = s.display(world, now)
			return false, err
		}
		// The summary over the gap before this command (rule of GET); an
		// acknowledgement never produces one, it would re-open the summary
		// it just closed. Every successful command then marks the player
		// as seen.
		if _, ack := cmd.(sim.AckSummary); !ack {
			sim.MaybeProduceSummary(world, s.cfg.Catalogue)
		}
		sim.MarkSeen(world)
		ds, err = s.display(world, now)
		return err == nil, err
	})
	if err != nil {
		s.writeError(w, r, err)
		return
	}
	if !unchanged {
		s.published(r, id)
	}
	s.writeJSON(w, http.StatusOK, worldResponse{Version: version, Display: ds, TileResults: results})
}

// islandRevision identifies the static data of the world's islands for
// client caching: the content version and, for a generated archipelago,
// its seed and roll (a reroll replaces islands under the same IDs).
func islandRevision(c *content.Catalogue, w *sim.World) string {
	if w.Seed == 0 {
		return c.Region.Version
	}
	return fmt.Sprintf("%s-%d-%d", c.Region.Version, w.Seed, w.ArchipelagoRoll)
}

// islandPathPrefix and tilesPathSuffix frame GET
// /api/v1/world/islands/{island_id}/tiles.
const (
	islandPathPrefix = "/api/v1/world/islands/"
	tilesPathSuffix  = "/tiles"
	tilesRoute       = islandPathPrefix + "{island_id}" + tilesPathSuffix
)

// tilesCacheControl lets the browser keep an island's rows for good: the
// terrain only changes on a reroll, which changes the ETag and — through
// the client's `v` cache key — the URL.
const tilesCacheControl = "private, max-age=31536000, immutable"

// tilesResponse is the full terrain of an island, row-major (index
// y*width + x), as terrain IDs. Revision identifies the data for client
// decoration seeds (islandRevision). Fertilities and deposits are part of
// the island's display payload.
type tilesResponse struct {
	ID       string   `json:"id"`
	Width    int      `json:"width"`
	Height   int      `json:"height"`
	Revision string   `json:"revision"`
	Terrain  []string `json:"terrain"`
	// Levels and Heights hold one digit per tile (D-058, visual only).
	Levels  string `json:"levels"`
	Heights string `json:"heights"`
}

// tileDigit is a level or height as one digit (clamped to 0-9).
func tileDigit(v int) byte { return '0' + byte(min(max(v, 0), 9)) } // #nosec G115 -- clamped

// display is sim.Display plus the generator version, which the sim
// cannot know (package archipelago imports it).
func (s *Server) display(w *sim.World, now time.Time) (sim.DisplayState, error) {
	ds, err := sim.Display(w, s.cfg.Catalogue, now)
	ds.Archipelago.GeneratorVersion = archipelago.GeneratorVersion
	return ds, err
}

// tilesETag is the strong validator of an island's rows: terrain changes
// with the archipelago's seed and roll (D-053) and with the island
// generator (D-058, archipelago.GeneratorVersion), so these and the island
// ID identify it.
func tilesETag(seed uint64, roll, generator int, island string) string {
	sum := sha256.Sum256(fmt.Appendf(nil, "%d|%d|%d|%s", seed, roll, generator, island))
	return `"` + hex.EncodeToString(sum[:12]) + `"`
}

// tilesKey is the client's cache key of an archipelago (`?v=`): seed, roll
// and generator version.
func tilesKey(seed uint64, roll, generator int) string {
	return fmt.Sprintf("%d-%d-g%d", seed, roll, generator)
}

// etagMatches reports whether an If-None-Match header lists the ETag (or
// is "*"); weak comparison as RFC 9110 prescribes for If-None-Match.
func etagMatches(header, etag string) bool {
	for part := range strings.SplitSeq(header, ",") {
		p := strings.TrimPrefix(strings.TrimSpace(part), "W/")
		if p == "*" || p == etag {
			return true
		}
	}
	return false
}

// getIslandTiles serves the full terrain rows of an island of the
// session's world. Like every world request it advances the world to the
// current world time first. The response is cacheable for good (ETag from
// seed, roll, generator version and island ID; 304 on a matching If-None-Match) unless the
// client's cache key `v` names another archipelago than the world's: then it is
// answered no-store, so a race with a reroll never caches the new rows
// under the old key.
func (s *Server) getIslandTiles(w http.ResponseWriter, r *http.Request) {
	islandID := strings.TrimSuffix(strings.TrimPrefix(r.URL.Path, islandPathPrefix), tilesPathSuffix)
	id, err := s.worldID(r)
	if err != nil {
		s.writeError(w, r, err)
		return
	}
	var (
		resp tilesResponse
		etag string
		key  string
	)
	_, err = s.cfg.Store.Update(r.Context(), id, func(world *sim.World, _ int64, now time.Time) (bool, error) {
		// Every world request advances first (read-only: no new version).
		if err := s.advance(world, now); err != nil {
			return false, err
		}
		is := world.Island(islandID)
		if is == nil {
			return false, fmt.Errorf("%w: %q", sim.ErrUnknownIsland, islandID)
		}
		gen := archipelago.GeneratorVersion
		etag, key = tilesETag(world.Seed, world.ArchipelagoRoll, gen, is.ID), tilesKey(world.Seed, world.ArchipelagoRoll, gen)
		resp = tilesResponse{
			ID: is.ID, Width: is.Width, Height: is.Height,
			Revision: islandRevision(s.cfg.Catalogue, world), Terrain: make([]string, len(is.Tiles)),
		}
		levels, heights := make([]byte, len(is.Tiles)), make([]byte, len(is.Tiles))
		for i, t := range is.Tiles {
			resp.Terrain[i] = t.Terrain
			levels[i], heights[i] = tileDigit(t.Level), tileDigit(t.Height)
		}
		resp.Levels, resp.Heights = string(levels), string(heights)
		return false, nil
	})
	if err != nil {
		s.writeError(w, r, err)
		return
	}
	cacheControl := tilesCacheControl
	if v := r.URL.Query().Get("v"); v != "" && v != key {
		cacheControl = "no-store"
	}
	w.Header().Set("ETag", etag)
	if inm := r.Header.Get("If-None-Match"); inm != "" && etagMatches(inm, etag) {
		w.Header().Set("Cache-Control", cacheControl)
		w.WriteHeader(http.StatusNotModified)
		return
	}
	body, err := json.Marshal(resp)
	if err != nil {
		s.writeError(w, r, err)
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", cacheControl)
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(append(body, '\n'))
}

// getContent serves the catalogue in the language of the "lang" query
// parameter (an unknown language is a bad request) or, without it, the
// best match of Accept-Language (English when nothing matches).
func (s *Server) getContent(w http.ResponseWriter, r *http.Request) {
	var lang string
	if q, ok := r.URL.Query()["lang"]; ok {
		if len(q) != 1 || !s.cfg.Catalogue.HasLanguage(q[0]) {
			s.writeError(w, r, &apiError{code: CodeBadRequest, status: http.StatusBadRequest, message: "unknown language"})
			return
		}
		lang = q[0]
	} else {
		lang = negotiateLanguage(s.cfg.Catalogue, r.Header.Get("Accept-Language"))
	}
	setJSONHeaders(w)
	w.Header().Set("Content-Language", lang)
	w.Header().Add("Vary", "Accept-Language")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(s.content[lang])
}

// negotiateLanguage picks the shipped language an Accept-Language header
// prefers: highest q first, header order among equals; a region subtag
// ("de-AT") matches its language; English when nothing matches.
func negotiateLanguage(c *content.Catalogue, header string) string {
	type cand struct {
		lang string
		q    float64
	}
	var cands []cand
	for part := range strings.SplitSeq(header, ",") {
		tag, params, _ := strings.Cut(strings.TrimSpace(part), ";")
		q := 1.0
		if k, v, ok := strings.Cut(strings.TrimSpace(params), "="); ok && strings.TrimSpace(k) == "q" {
			f, err := strconv.ParseFloat(strings.TrimSpace(v), 64)
			if err != nil {
				continue
			}
			q = f
		}
		primary, _, _ := strings.Cut(strings.ToLower(strings.TrimSpace(tag)), "-")
		if q > 0 && c.HasLanguage(primary) {
			cands = append(cands, cand{primary, q})
		}
	}
	if len(cands) == 0 {
		return content.SourceLanguage
	}
	best := cands[0]
	for _, x := range cands[1:] {
		if x.q > best.q {
			best = x
		}
	}
	return best.lang
}

// healthResponse is the body of /healthz. Version and instance identify the
// server (multi-instance tests); postgres and redis are reported in
// default mode.
type healthResponse struct {
	Status   string `json:"status"`
	Version  string `json:"version,omitempty"`
	Instance string `json:"instance,omitempty"`
	Postgres string `json:"postgres,omitempty"`
	Redis    string `json:"redis,omitempty"`
}

// getHealth is the readiness probe. In default mode it pings Postgres
// (503 service_unavailable when down); Redis is reported but does not fail
// readiness.
func (s *Server) getHealth(w http.ResponseWriter, r *http.Request) {
	resp := healthResponse{Status: "ok", Version: s.cfg.Version, Instance: s.cfg.Instance}
	if s.cfg.Health != nil {
		h := s.cfg.Health(r.Context())
		if !h.Postgres {
			s.writeError(w, r, &apiError{code: CodeServiceUnavailable, status: http.StatusServiceUnavailable, message: "database unavailable"})
			return
		}
		resp.Postgres, resp.Redis = "ok", h.Redis
	}
	s.writeJSON(w, http.StatusOK, resp)
}

// getWS upgrades to the WebSocket push of the session's world.
func (s *Server) getWS(w http.ResponseWriter, r *http.Request) {
	id, err := s.worldID(r)
	if err != nil {
		s.writeError(w, r, err)
		return
	}
	if s.cfg.Hub == nil {
		s.writeError(w, r, &apiError{code: CodeNotFound, status: http.StatusNotFound, message: "push is not available"})
		return
	}
	s.cfg.Hub.Serve(w, r, id)
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
		code, status, msg = CodeNotFound, http.StatusNotFound, "world not found"
	case authCode(err) != nil:
		e := authCode(err)
		code, status, msg = e.code, e.status, e.message
	case unavailable(err):
		code, status, msg = CodeServiceUnavailable, http.StatusServiceUnavailable, "service unavailable"
	default:
		code, status = classify(err)
		msg = err.Error()
		if code == CodeInternal {
			msg = "internal error"
		}
	}
	ri := info(r.Context())
	if status >= http.StatusInternalServerError {
		attrs := []any{"method", r.Method, "path", r.URL.Path, "error_code", code, "error", err}
		if ri.session != nil {
			attrs = append(attrs, "player_id", ri.session.PlayerID, "world_id", string(ri.session.WorldID))
		}
		s.cfg.Logger.Error("request failed", attrs...)
	}
	if status == http.StatusUnauthorized && ri.cookie {
		s.clearCookie(w)
	}
	ri.errorCode = code
	s.writeJSON(w, status, errorBody{Error: errorDetail{Code: code, Message: msg}})
}

// devResetRequest is the optional body of POST /api/v1/dev/reset.
type devResetRequest struct {
	Fixture string `json:"fixture"`
}

// devResetResponse answers POST /api/v1/dev/reset.
type devResetResponse struct {
	Version int64  `json:"version"`
	Fixture string `json:"fixture"`
}

// postDevReset replaces the dev world with a fresh fixture (dev mode only,
// for the E2E specs): pending events, the last-seen time and the away
// summary start over, the version increases and world_changed is
// published.
func (s *Server) postDevReset(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxBodyBytes))
	if err != nil {
		s.writeError(w, r, badRequest(fmt.Sprintf("request body: %v", err)))
		return
	}
	var req devResetRequest
	if len(bytes.TrimSpace(body)) > 0 {
		if err := decodeStrict(body, &req); err != nil {
			s.writeError(w, r, err)
			return
		}
	}
	if req.Fixture != "" && !slices.Contains(s.cfg.DevFixtures, req.Fixture) {
		s.writeError(w, r, badRequest(fmt.Sprintf("unknown fixture %q (known: %s)", req.Fixture, strings.Join(s.cfg.DevFixtures, ", "))))
		return
	}
	id, err := s.worldID(r)
	if err != nil {
		s.writeError(w, r, err)
		return
	}
	version, err := s.cfg.DevReset(r.Context(), req.Fixture)
	var fe DevFixtureError
	if errors.As(err, &fe) {
		s.writeError(w, r, badRequest(fe.Error()))
		return
	}
	if err != nil {
		s.writeError(w, r, err)
		return
	}
	s.published(r, id)
	s.cfg.Logger.Info("dev world reset", "fixture", req.Fixture, "version", version)
	s.writeJSON(w, http.StatusOK, devResetResponse{Version: version, Fixture: req.Fixture})
}
