//go:build integration

package api

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/ricoberger/new-shores/server/internal/auth"
	"github.com/ricoberger/new-shores/server/internal/sim"
	"github.com/ricoberger/new-shores/server/internal/store/postgres"
	"github.com/ricoberger/new-shores/server/internal/testenv"
	"github.com/ricoberger/new-shores/server/internal/testworld"
)

// mailbox records mails (the test reads tokens from it).
type mailbox struct {
	mu    sync.Mutex
	mails []string
}

func (m *mailbox) Send(_ context.Context, to, subject, body string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.mails = append(m.mails, to+"\n"+subject+"\n"+body)
	return nil
}

var tokenRe = regexp.MustCompile(`token=([A-Za-z0-9_-]+)`)

func (m *mailbox) lastToken(t *testing.T, action string) string {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		m.mu.Lock()
		for i := len(m.mails) - 1; i >= 0; i-- {
			if strings.Contains(m.mails[i], action+"=1") {
				tok := tokenRe.FindStringSubmatch(m.mails[i])[1]
				m.mu.Unlock()
				return tok
			}
		}
		m.mu.Unlock()
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("no %s mail", action)
	return ""
}

type pgEnv struct {
	t     *testing.T
	srv   *Server
	st    *postgres.Store
	mail  *mailbox
	logs  *testenv.SyncBuffer
	spec  *specValidator
	accts *auth.Service
}

func newPGEnv(t *testing.T, limiter auth.Limiter) *pgEnv {
	t.Helper()
	c := catalogue(t)
	// The account flows build on a founded start island (the default
	// dev fixture); a new player's world at sea is TestGetWorldInitialState's.
	return newPGEnvWith(t, limiter, func(now time.Time) (*sim.World, error) { return testworld.Founded(c, now) })
}

// newPGEnvWith is newPGEnv with the worlds of new players from newWorld.
func newPGEnvWith(t *testing.T, limiter auth.Limiter, newWorld func(time.Time) (*sim.World, error)) *pgEnv {
	t.Helper()
	_, pool := testenv.Database(t)
	c := catalogue(t)
	logs := &testenv.SyncBuffer{}
	logger := slog.New(slog.NewTextHandler(logs, &slog.HandlerOptions{Level: slog.LevelDebug}))
	st := postgres.New(pool, c, logger)
	mail := &mailbox{}
	// Tee: the log mailer writes to the captured logs, the mailbox keeps
	// the tokens for the test.
	accts2, err := auth.NewService(auth.Config{
		Store: st, NewWorld: newWorld,
		Region: c.Region.ID, Freshness: time.Hour, SessionTTL: 30 * 24 * time.Hour, Argon2: auth.DefaultArgon2,
		Mailer: teeMailer{mail, auth.LogMailer{Logger: logger}}, PublicURL: "http://localhost:8000", Logger: logger,
	})
	if err != nil {
		t.Fatal(err)
	}
	srv, err := New(Config{
		Store: st, Catalogue: c, Clock: WallClock{}, Accounts: accts2, Limiter: limiter,
		CORSOrigins: []string{testOrigin}, Logger: logger,
	})
	if err != nil {
		t.Fatal(err)
	}
	return &pgEnv{t: t, srv: srv, st: st, mail: mail, logs: logs, spec: loadSpec(t), accts: accts2}
}

type teeMailer struct {
	a, b auth.Mailer
}

func (m teeMailer) Send(ctx context.Context, to, subject, body string) error {
	_ = m.a.Send(ctx, to, subject, body)
	return m.b.Send(ctx, to, subject, body)
}

// client is a browser-like client: it keeps the session cookie and sends
// the allowed Origin.
type client struct {
	env    *pgEnv
	cookie string
	bearer string
}

func (c *client) do(method, path, body string) (*httptest.ResponseRecorder, map[string]any) {
	c.env.t.Helper()
	req := httptest.NewRequestWithContext(context.Background(), method, path, strings.NewReader(body))
	req.Header.Set("Origin", testOrigin)
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	if c.cookie != "" {
		req.Header.Set("Cookie", SessionCookie+"="+c.cookie)
	}
	if c.bearer != "" {
		req.Header.Set("Authorization", "Bearer "+c.bearer)
	}
	rec := httptest.NewRecorder()
	c.env.srv.ServeHTTP(rec, req)
	for _, ck := range rec.Result().Cookies() {
		if ck.Name == SessionCookie {
			c.cookie = ck.Value
			if ck.MaxAge < 0 {
				c.cookie = ""
			}
		}
	}
	if method != http.MethodOptions && !strings.HasSuffix(path, "/ws") {
		c.env.spec.validate(c.env.t, method, path, body, response{status: rec.Code, header: rec.Header(), body: rec.Body.Bytes()})
	}
	var out map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	return rec, out
}

func (c *client) must(method, path, body string, status int) map[string]any {
	c.env.t.Helper()
	rec, out := c.do(method, path, body)
	if rec.Code != status {
		c.env.t.Fatalf("%s %s: %d %s, want %d", method, path, rec.Code, rec.Body, status)
	}
	return out
}

func (c *client) world() (string, int64, json.RawMessage) {
	c.env.t.Helper()
	rec, _ := c.do(http.MethodGet, "/api/v1/world", "")
	if rec.Code != 200 {
		c.env.t.Fatalf("GET /world: %d %s", rec.Code, rec.Body)
	}
	var w worldJSON
	_ = json.Unmarshal(rec.Body.Bytes(), &w)
	return rec.Header().Get("X-Request-ID"), w.Version, w.Display
}

func playerOf(out map[string]any) map[string]any { return out["player"].(map[string]any) }

func (e *pgEnv) worldIDOf(playerID string) string {
	e.t.Helper()
	id, err := postgres.WorldOfPlayer(context.Background(), e.st.Pool(), playerID, "old_coast")
	if err != nil {
		e.t.Fatal(err)
	}
	return string(id)
}

const (
	testEmail    = "Captain.Test@Example.org"
	testPassword = "very secret password 42"
)

// TestGuestRegisterLoginFlow covers 8.4: guest -> register keeps the world,
// the device token is revoked, logout invalidates the session, login
// returns the same world, password reset revokes sessions, and no email,
// password or token reaches the logs.
func TestGuestRegisterLoginFlow(t *testing.T) {
	env := newPGEnv(t, nil)
	guest := &client{env: env}
	out := guest.must(http.MethodPost, "/api/v1/auth/guest", `{}`, 200)
	device := out["device_token"].(string)
	p := playerOf(out)
	if p["guest"] != true || !strings.HasPrefix(p["display_name"].(string), "Settler ") || guest.cookie == "" {
		t.Fatalf("guest %v cookie %q", out, guest.cookie)
	}
	playerID := p["id"].(string)
	worldID := env.worldIDOf(playerID)
	guest.must(http.MethodPost, "/api/v1/world/commands", `{"command":`+cmdRoad+`}`, 200)
	_, v1, d1 := guest.world()
	if v1 != 1 {
		t.Fatalf("version %d", v1)
	}

	// Device token re-auth (a second device of the guest).
	other := &client{env: env}
	out = other.must(http.MethodPost, "/api/v1/auth/guest", `{"device_token":"`+device+`"}`, 200)
	if playerOf(out)["id"] != playerID || out["device_token"] != nil {
		t.Fatalf("device re-auth %v", out)
	}
	// An unknown device token is invalid_credentials.
	rec, _ := (&client{env: env}).do(http.MethodPost, "/api/v1/auth/guest", `{"device_token":"nope"}`)
	if rec.Code != 401 || code(t, rec) != CodeInvalidCredentials {
		t.Fatalf("unknown device token: %d %s", rec.Code, rec.Body)
	}

	// Register keeps the world and its state.
	out = guest.must(http.MethodPost, "/api/v1/auth/register", `{"email":"`+testEmail+`","password":"`+testPassword+`","display_name":"Captain Test"}`, 200)
	p = playerOf(out)
	if p["guest"] != false || p["email"] != strings.ToLower(testEmail) || p["display_name"] != "Captain Test" || p["id"] != playerID {
		t.Fatalf("registered %v", out)
	}
	if got := env.worldIDOf(playerID); got != worldID {
		t.Fatalf("world changed: %s -> %s", worldID, got)
	}
	_, v2, d2 := guest.world()
	if v2 != v1 || len(d2) == 0 || len(d1) == 0 {
		t.Fatalf("version after register %d, want %d", v2, v1)
	}
	if bs := buildingIDs(t, d2, "trading_post"); len(bs) != 1 {
		t.Fatalf("warehouses %v", bs)
	}
	// Registering again is already_registered; the email is taken for others.
	rec, _ = guest.do(http.MethodPost, "/api/v1/auth/register", `{"email":"x@example.org","password":"`+testPassword+`"}`)
	if rec.Code != 409 || code(t, rec) != CodeAlreadyRegistered {
		t.Fatalf("register twice: %d %s", rec.Code, rec.Body)
	}
	rec, _ = (&client{env: env}).do(http.MethodPost, "/api/v1/auth/register", `{"email":"captain.test@example.ORG","password":"`+testPassword+`"}`)
	if rec.Code != 409 || code(t, rec) != CodeEmailTaken {
		t.Fatalf("email taken: %d %s", rec.Code, rec.Body)
	}
	// The device token is revoked by registration.
	rec, _ = (&client{env: env}).do(http.MethodPost, "/api/v1/auth/guest", `{"device_token":"`+device+`"}`)
	if rec.Code != 401 || code(t, rec) != CodeInvalidCredentials {
		t.Fatalf("revoked device token: %d %s", rec.Code, rec.Body)
	}

	// Email verification: single use.
	verify := env.mail.lastToken(t, "verify_email")
	(&client{env: env}).must(http.MethodPost, "/api/v1/auth/verify-email", `{"token":"`+verify+`"}`, 204)
	rec, _ = (&client{env: env}).do(http.MethodPost, "/api/v1/auth/verify-email", `{"token":"`+verify+`"}`)
	if rec.Code != 400 || code(t, rec) != CodeInvalidToken {
		t.Fatalf("verify twice: %d", rec.Code)
	}
	if me := guest.must(http.MethodGet, "/api/v1/auth/me", "", 200); playerOf(me)["email_verified"] != true {
		t.Fatalf("me %v", me)
	}

	// Logout invalidates the session.
	old := guest.cookie
	guest.must(http.MethodPost, "/api/v1/auth/logout", "", 204)
	if guest.cookie != "" {
		t.Fatal("cookie not cleared")
	}
	guest.cookie = old
	if rec, _ := guest.do(http.MethodGet, "/api/v1/world", ""); rec.Code != 401 {
		t.Fatalf("session after logout: %d", rec.Code)
	}
	guest.cookie = ""

	// Wrong password and unknown email are the same error.
	for _, body := range []string{
		`{"email":"` + testEmail + `","password":"wrong password"}`,
		`{"email":"nobody@example.org","password":"` + testPassword + `"}`,
	} {
		rec, _ := guest.do(http.MethodPost, "/api/v1/auth/login", body)
		if rec.Code != 401 || code(t, rec) != CodeInvalidCredentials || !strings.Contains(rec.Body.String(), "invalid credentials") {
			t.Fatalf("login %s: %d %s", body, rec.Code, rec.Body)
		}
	}
	// Login (bearer) returns the same world.
	out = guest.must(http.MethodPost, "/api/v1/auth/login", `{"email":"`+testEmail+`","password":"`+testPassword+`","transport":"bearer"}`, 200)
	bearer := &client{env: env, bearer: out["session_token"].(string)}
	if _, v, _ := bearer.world(); v != v1 {
		t.Fatalf("world after login: version %d", v)
	}
	cookieClient := &client{env: env}
	cookieClient.must(http.MethodPost, "/api/v1/auth/login", `{"email":"`+testEmail+`","password":"`+testPassword+`"}`, 200)

	// Password reset revokes every session.
	(&client{env: env}).must(http.MethodPost, "/api/v1/auth/password-reset/request", `{"email":"`+testEmail+`"}`, 204)
	(&client{env: env}).must(http.MethodPost, "/api/v1/auth/password-reset/request", `{"email":"unknown@example.org"}`, 204)
	reset := env.mail.lastToken(t, "password_reset")
	rec, _ = (&client{env: env}).do(http.MethodPost, "/api/v1/auth/password-reset/confirm", `{"token":"`+reset+`","password":"short"}`)
	if rec.Code != 400 || code(t, rec) != CodeWeakPassword {
		t.Fatalf("weak password: %d", rec.Code)
	}
	newPassword := "another secret password"
	(&client{env: env}).must(http.MethodPost, "/api/v1/auth/password-reset/confirm", `{"token":"`+reset+`","password":"`+newPassword+`"}`, 204)
	for _, c := range []*client{bearer, cookieClient} {
		if rec, _ := c.do(http.MethodGet, "/api/v1/auth/me", ""); rec.Code != 401 {
			t.Fatalf("session survived the reset: %d", rec.Code)
		}
	}
	rec, _ = (&client{env: env}).do(http.MethodPost, "/api/v1/auth/password-reset/confirm", `{"token":"`+reset+`","password":"`+newPassword+`"}`)
	if rec.Code != 400 || code(t, rec) != CodeInvalidToken {
		t.Fatalf("reset token reused: %d", rec.Code)
	}
	(&client{env: env}).must(http.MethodPost, "/api/v1/auth/login", `{"email":"`+testEmail+`","password":"`+newPassword+`"}`, 200)

	// No email, password or token in the logs (the log mailer logs only
	// the token hash).
	logs := env.logs.String()
	secrets := []string{testEmail, strings.ToLower(testEmail), testPassword, newPassword, device, verify, reset, old, out["session_token"].(string)}
	for _, s := range secrets {
		if strings.Contains(logs, s) {
			t.Errorf("secret %q found in logs", s)
		}
	}
	if !strings.Contains(logs, "token_sha256="+auth.TokenFingerprint(verify)) || !strings.Contains(logs, "player_id="+playerID) {
		t.Errorf("logs lack the token hash or the player ID:\n%s", logs)
	}
}

// TestRegisterWithoutSessionAndOwnership: registering without a session
// creates a player with its own world; each player only ever sees its own
// world (world IDs never come from the client).
func TestRegisterWithoutSessionAndOwnership(t *testing.T) {
	env := newPGEnv(t, nil)
	a := &client{env: env}
	outA := a.must(http.MethodPost, "/api/v1/auth/register", `{"email":"a@example.org","password":"`+testPassword+`"}`, 200)
	b := &client{env: env}
	outB := b.must(http.MethodPost, "/api/v1/auth/guest", `{}`, 200)
	worldA := env.worldIDOf(playerOf(outA)["id"].(string))
	worldB := env.worldIDOf(playerOf(outB)["id"].(string))
	if worldA == worldB || playerOf(outA)["guest"] != false {
		t.Fatalf("worlds %s %s", worldA, worldB)
	}
	a.must(http.MethodPost, "/api/v1/world/commands", `{"command":`+cmdRoad+`}`, 200)
	if _, v, _ := b.world(); v != 0 {
		t.Fatalf("B sees version %d (A's world)", v)
	}
	if _, v, _ := a.world(); v != 1 {
		t.Fatalf("A sees version %d", v)
	}
	// There is no way to address A's world: unknown paths are 404.
	for _, p := range []string{"/api/v1/world/" + worldA, "/api/v1/worlds/" + worldA} {
		if rec := serveReq(env.srv, http.MethodGet, p, "", map[string]string{"Cookie": SessionCookie + "=" + b.cookie}); rec.Code != 404 {
			t.Fatalf("%s: %d", p, rec.Code)
		}
	}
	// A session whose player has no world gets 404 on /world.
	ctx := context.Background()
	if _, err := env.st.Pool().Exec(ctx, "UPDATE worlds SET region = 'elsewhere' WHERE id = $1", worldB); err != nil {
		t.Fatal(err)
	}
	if rec, _ := b.do(http.MethodGet, "/api/v1/world", ""); rec.Code != 404 || code(t, rec) != CodeNotFound {
		t.Fatalf("world of another region: %d %s", rec.Code, rec.Body)
	}
}

// TestSessionExpiry: an expired session is 401 and its cookie is cleared.
func TestSessionExpiry(t *testing.T) {
	env := newPGEnv(t, nil)
	c := &client{env: env}
	c.must(http.MethodPost, "/api/v1/auth/guest", `{}`, 200)
	c.must(http.MethodGet, "/api/v1/auth/me", "", 200)
	if _, err := env.st.Pool().Exec(context.Background(), "UPDATE sessions SET expires_at = now() - interval '1 second'"); err != nil {
		t.Fatal(err)
	}
	rec, _ := c.do(http.MethodGet, "/api/v1/auth/me", "")
	if rec.Code != 401 || code(t, rec) != CodeUnauthorized || c.cookie != "" {
		t.Fatalf("expired: %d %s cookie %q", rec.Code, rec.Body, c.cookie)
	}
	// Sliding expiry: a session last seen over an hour ago is extended.
	c.must(http.MethodPost, "/api/v1/auth/guest", `{}`, 200)
	if _, err := env.st.Pool().Exec(context.Background(), "UPDATE sessions SET last_seen_at = now() - interval '2 hours', expires_at = now() + interval '1 day'"); err != nil {
		t.Fatal(err)
	}
	before := c.cookie
	rec, _ = c.do(http.MethodGet, "/api/v1/auth/me", "")
	if rec.Code != 200 || !strings.Contains(rec.Header().Get("Set-Cookie"), "Max-Age=2592000") || c.cookie != before {
		t.Fatalf("refreshed session: %d, cookie not re-issued: %v", rec.Code, rec.Header())
	}
	var days float64
	_ = env.st.Pool().QueryRow(context.Background(), "SELECT max(extract(epoch FROM expires_at - now()) / 86400) FROM sessions").Scan(&days)
	if days < 29.9 {
		t.Fatalf("expiry not refreshed: %.2f days", days)
	}
}

// TestRateLimitWithRedis: the 11th guest request per IP within a minute is
// 429 with Retry-After.
func TestRateLimitWithRedis(t *testing.T) {
	rdb := testenv.Redis(t)
	lim := &auth.RedisLimiter{Client: rdb, Prefix: fmt.Sprintf("test:%d:", time.Now().UnixNano()), Burst: 10, Rate: 10, Per: time.Minute,
		Logger: slog.New(slog.DiscardHandler)}
	env := newPGEnv(t, lim)
	c := &client{env: env}
	for i := range 11 {
		rec, _ := c.do(http.MethodPost, "/api/v1/auth/guest", `{"device_token":"unknown"}`)
		if i < 10 && rec.Code != 401 {
			t.Fatalf("request %d: %d", i, rec.Code)
		}
		if i == 10 && (rec.Code != 429 || code(t, rec) != CodeRateLimited || rec.Header().Get("Retry-After") == "") {
			t.Fatalf("11th request: %d %s %v", rec.Code, rec.Body, rec.Header())
		}
	}
}

// TestConcurrentCommandsOnPostgres: N concurrent commands on one world are
// all applied and the version grows by exactly N.
func TestConcurrentCommandsOnPostgres(t *testing.T) {
	env := newPGEnv(t, nil)
	c := &client{env: env}
	out := c.must(http.MethodPost, "/api/v1/auth/guest", `{"transport":"bearer"}`, 200)
	c.bearer = out["session_token"].(string)
	const n = 20
	var wg sync.WaitGroup
	codes := make([]int, n)
	for i := range n {
		wg.Add(1)
		go func() {
			defer wg.Done()
			cmd := fmt.Sprintf(`{"type":"place_road","island_id":"start","road_type":"road_dirt","tiles":[{"x":%d,"y":4}]}`, 3+i)
			req := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/api/v1/world/commands", strings.NewReader(`{"command":`+cmd+`}`))
			req.Header.Set("Authorization", "Bearer "+c.bearer)
			rec := httptest.NewRecorder()
			env.srv.ServeHTTP(rec, req)
			codes[i] = rec.Code
		}()
	}
	wg.Wait()
	for i, s := range codes {
		if s != 200 {
			t.Fatalf("command %d: %d", i, s)
		}
	}
	_, v, d := c.world()
	var disp struct {
		Islands []struct {
			Roads []json.RawMessage `json:"roads"`
		} `json:"islands"`
	}
	_ = json.Unmarshal(d, &disp)
	if v != n || len(disp.Islands[0].Roads) != n {
		t.Fatalf("version %d roads %d, want %d", v, len(disp.Islands[0].Roads), n)
	}
}

// TestSchemaVersionIsA500 (user note): a stored world without a migration
// path answers 500 schema_version (logged with the world ID); the world is
// not reset.
func TestSchemaVersionIsA500(t *testing.T) {
	env := newPGEnv(t, nil)
	c := &client{env: env}
	out := c.must(http.MethodPost, "/api/v1/auth/guest", `{}`, 200)
	worldID := env.worldIDOf(playerOf(out)["id"].(string))
	if _, err := env.st.Pool().Exec(context.Background(), "UPDATE worlds SET state = jsonb_set(state, '{schema_version}', '99') WHERE id = $1", worldID); err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{"/api/v1/world", "/api/v1/world/islands/start/tiles"} {
		rec, _ := c.do(http.MethodGet, path, "")
		if rec.Code != 500 || code(t, rec) != "schema_version" {
			t.Fatalf("%s: %d %s", path, rec.Code, rec.Body)
		}
	}
	var sv string
	_ = env.st.Pool().QueryRow(context.Background(), "SELECT state->>'schema_version' FROM worlds WHERE id = $1", worldID).Scan(&sv)
	if sv != "99" {
		t.Fatalf("world was rewritten: schema_version %s", sv)
	}
	if !strings.Contains(env.logs.String(), "world_id="+worldID) {
		t.Fatalf("schema error not logged with the world ID:\n%s", env.logs.String())
	}
}
