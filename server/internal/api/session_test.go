package api

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/coder/websocket"

	"github.com/ricoberger/new-shores/server/internal/auth"
	"github.com/ricoberger/new-shores/server/internal/store"
	"github.com/ricoberger/new-shores/server/internal/ws"
)

// TestDevAuthFacade: --dev serves the auth routes with a fixed player.
func TestDevAuthFacade(t *testing.T) {
	ts := newTestServer(t, 1)
	for _, c := range []struct {
		method, path, body string
		status             int
	}{
		{http.MethodGet, "/api/v1/auth/me", "", 200},
		{http.MethodPost, "/api/v1/auth/guest", `{}`, 200},
		{http.MethodPost, "/api/v1/auth/logout", "", 204},
		{http.MethodPost, "/api/v1/auth/login", `{"email":"a@b.org","password":"12345678"}`, 404},
		{http.MethodPost, "/api/v1/auth/register", `{"email":"a@b.org","password":"12345678"}`, 404},
		{http.MethodPost, "/api/v1/auth/verify-email", `{"token":"x"}`, 404},
		{http.MethodPost, "/api/v1/auth/password-reset/request", `{"email":"a@b.org"}`, 404},
		{http.MethodPost, "/api/v1/auth/password-reset/confirm", `{"token":"x","password":"12345678"}`, 404},
	} {
		res := ts.do(c.method, c.path, c.body, true)
		if res.status != c.status {
			t.Fatalf("%s %s: %d %s", c.method, c.path, res.status, res.body)
		}
		if c.status == 200 {
			var a authResponse
			if err := json.Unmarshal(res.body, &a); err != nil || a.Player.DisplayName != "Developer" || a.Player.Guest {
				t.Fatalf("%s: %s", c.path, res.body)
			}
		}
		if c.status == 404 && errorCode(t, res) != CodeNotFound {
			t.Fatalf("%s: %s", c.path, res.body)
		}
	}
}

// TestDevWebSocketPush: in dev mode a command is pushed as world_changed
// through the in-process hub.
func TestDevWebSocketPush(t *testing.T) {
	c := catalogue(t)
	w := foundedWorld(t, testStart)
	hub := ws.NewHub(slog.New(slog.DiscardHandler))
	srv, err := New(Config{
		Store: store.NewMemory(testWorld, w, func() time.Time { return testStart }), Catalogue: c, Clock: WallClock{},
		ResolveWorld: func(*http.Request) (store.WorldID, error) { return testWorld, nil },
		Publisher:    ws.LocalPublisher{Hub: hub}, Hub: hub, CORSOrigins: []string{testOrigin},
	})
	if err != nil {
		t.Fatal(err)
	}
	hs := httptest.NewServer(srv)
	defer hs.Close()
	defer hub.Close(context.Background())
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	conn, resp, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(hs.URL, "http")+"/api/v1/ws", &websocket.DialOptions{
		HTTPHeader: http.Header{"Origin": {testOrigin}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if resp.Body != nil {
		_ = resp.Body.Close()
	}
	defer func() { _ = conn.CloseNow() }()
	for hub.Connections() == 0 {
		time.Sleep(10 * time.Millisecond)
	}
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, hs.URL+"/api/v1/world/commands", strings.NewReader(`{"command":`+cmdRoad+`}`))
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	_ = res.Body.Close()
	if res.StatusCode != 200 {
		t.Fatalf("command: %d", res.StatusCode)
	}
	readCtx, readCancel := context.WithTimeout(ctx, time.Second)
	defer readCancel()
	_, msg, err := conn.Read(readCtx)
	if err != nil {
		t.Fatal(err)
	}
	if string(msg) != `{"type":"world_changed","world_id":"dev"}` {
		t.Fatalf("message %s", msg)
	}
	loadSpec(t).validateSchema(t, "WorldChangedMessage", msg)
}

// fakeAccounts authenticates the tokens "cookie-token" and "bearer-token"
// to the dev world; everything else is unauthorized.
type fakeAccounts struct {
	mu      sync.Mutex
	logins  int
	loggedO int
}

func (f *fakeAccounts) Authenticate(_ context.Context, token string) (*auth.Session, error) {
	if token == "cookie-token" || token == "bearer-token" {
		return &auth.Session{ID: "s", PlayerID: "p", WorldID: testWorld}, nil
	}
	return nil, auth.ErrUnauthorized
}

func (f *fakeAccounts) Guest(context.Context, string) (*auth.Issued, error) {
	return &auth.Issued{Player: auth.Player{ID: "p", DisplayName: "Settler 1234", Guest: true}, SessionToken: "new-token", DeviceToken: "device"}, nil
}

func (f *fakeAccounts) Register(context.Context, *auth.Session, string, string, *string) (*auth.Issued, error) {
	return nil, auth.ErrEmailTaken
}

func (f *fakeAccounts) Login(context.Context, *auth.Session, string, string) (*auth.Issued, error) {
	f.mu.Lock()
	f.logins++
	f.mu.Unlock()
	return &auth.Issued{Player: auth.Player{ID: "p", DisplayName: "P"}, SessionToken: "new-token"}, nil
}

func (f *fakeAccounts) Logout(context.Context, *auth.Session) error {
	f.mu.Lock()
	f.loggedO++
	f.mu.Unlock()
	return nil
}

func (f *fakeAccounts) Me(context.Context, *auth.Session) (auth.Player, error) {
	return auth.Player{ID: "p", DisplayName: "P", Guest: true}, nil
}
func (f *fakeAccounts) VerifyEmail(context.Context, string) error          { return auth.ErrInvalidToken }
func (f *fakeAccounts) RequestPasswordReset(context.Context, string) error { return nil }
func (f *fakeAccounts) ConfirmPasswordReset(context.Context, string, string) error {
	return auth.ErrWeakPassword
}

// denyAfter allows n requests per key.
type denyAfter struct {
	mu   sync.Mutex
	n    int
	seen map[string]int
}

func (d *denyAfter) Allow(_ context.Context, key string) (bool, time.Duration) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.seen[key]++
	if d.seen[key] > d.n {
		return false, 2500 * time.Millisecond
	}
	return true, 0
}

func newSessionServer(t *testing.T, limiter auth.Limiter) (*Server, *fakeAccounts) {
	t.Helper()
	c := catalogue(t)
	w := foundedWorld(t, testStart)
	acc := &fakeAccounts{}
	hub := ws.NewHub(slog.New(slog.DiscardHandler))
	t.Cleanup(func() { hub.Close(context.Background()) })
	srv, err := New(Config{
		Store: store.NewMemory(testWorld, w, func() time.Time { return testStart }), Catalogue: c, Clock: WallClock{},
		Accounts: acc, Limiter: limiter, Hub: hub, CORSOrigins: []string{testOrigin},
		TrustedProxies: []netip.Prefix{netip.MustParsePrefix("10.0.0.0/8")},
	})
	if err != nil {
		t.Fatal(err)
	}
	return srv, acc
}

func serveReq(srv http.Handler, method, path, body string, header map[string]string) *httptest.ResponseRecorder {
	req := httptest.NewRequestWithContext(context.Background(), method, path, strings.NewReader(body))
	for k, v := range header {
		req.Header.Set(k, v)
	}
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)
	return rec
}

func code(t *testing.T, rec *httptest.ResponseRecorder) string {
	t.Helper()
	return errorCode(t, response{status: rec.Code, body: rec.Body.Bytes()})
}

func TestSessionRequired(t *testing.T) {
	srv, _ := newSessionServer(t, nil)
	for _, c := range []struct{ method, path string }{
		{http.MethodGet, "/api/v1/world"}, {http.MethodGet, "/api/v1/world/islands/start"},
		{http.MethodPost, "/api/v1/world/commands"}, {http.MethodGet, "/api/v1/auth/me"},
		{http.MethodPost, "/api/v1/auth/logout"}, {http.MethodGet, "/api/v1/ws"},
	} {
		for _, h := range []map[string]string{nil, {"Cookie": SessionCookie + "=unknown"}, {"Authorization": "Bearer unknown"}, {"Authorization": "Basic x"}} {
			rec := serveReq(srv, c.method, c.path, "", h)
			if rec.Code != 401 || code(t, rec) != CodeUnauthorized {
				t.Fatalf("%s %s %v: %d %s", c.method, c.path, h, rec.Code, rec.Body)
			}
			if h != nil && strings.HasPrefix(h["Cookie"], SessionCookie) && !strings.Contains(rec.Header().Get("Set-Cookie"), "Max-Age=0") {
				t.Errorf("%s %s: stale cookie not cleared", c.method, c.path)
			}
		}
	}
	if rec := serveReq(srv, http.MethodGet, "/api/v1/world", "", map[string]string{"Authorization": "Bearer bearer-token"}); rec.Code != 200 {
		t.Fatalf("bearer: %d %s", rec.Code, rec.Body)
	}
	if rec := serveReq(srv, http.MethodGet, "/api/v1/world", "", map[string]string{"Cookie": SessionCookie + "=cookie-token"}); rec.Code != 200 {
		t.Fatalf("cookie GET without Origin: %d %s", rec.Code, rec.Body)
	}
	// Public endpoints need no session.
	if rec := serveReq(srv, http.MethodGet, "/api/v1/content", "", nil); rec.Code != 200 {
		t.Fatalf("content: %d", rec.Code)
	}
}

// TestCSRF: cookie-authenticated state changes must prove an allowed
// origin; bearer requests are exempt.
func TestCSRF(t *testing.T) {
	srv, _ := newSessionServer(t, nil)
	cookie := SessionCookie + "=cookie-token"
	body := `{"command":` + cmdRoad + `}`
	cases := []struct {
		name   string
		header map[string]string
		ok     bool
	}{
		{"no origin evidence", map[string]string{"Cookie": cookie}, false},
		{"foreign origin", map[string]string{"Cookie": cookie, "Origin": "http://evil.example"}, false},
		{"null origin", map[string]string{"Cookie": cookie, "Origin": "null"}, false},
		{"foreign origin beats same-origin fetch", map[string]string{"Cookie": cookie, "Origin": "http://evil.example", "Sec-Fetch-Site": "same-origin"}, false},
		{"cross-site fetch", map[string]string{"Cookie": cookie, "Sec-Fetch-Site": "cross-site"}, false},
		{"cross-site fetch with allowed referer", map[string]string{"Cookie": cookie, "Sec-Fetch-Site": "cross-site", "Referer": testOrigin + "/"}, false},
		{"foreign referer", map[string]string{"Cookie": cookie, "Referer": "http://evil.example/x"}, false},
		{"allowed origin", map[string]string{"Cookie": cookie, "Origin": testOrigin}, true},
		{"same-origin fetch", map[string]string{"Cookie": cookie, "Sec-Fetch-Site": "same-origin"}, true},
		{"same-site fetch", map[string]string{"Cookie": cookie, "Sec-Fetch-Site": "same-site"}, true},
		{"referer only (user note 1: Origin or Sec-Fetch-Site required)", map[string]string{"Cookie": cookie, "Referer": testOrigin + "/game"}, false},
		{"none-site fetch", map[string]string{"Cookie": cookie, "Sec-Fetch-Site": "none"}, false},
		{"bearer is exempt", map[string]string{"Authorization": "Bearer bearer-token"}, true},
		{"bearer with a cookie is exempt", map[string]string{"Authorization": "Bearer bearer-token", "Cookie": cookie, "Origin": "http://evil.example"}, true},
	}
	for _, c := range cases {
		rec := serveReq(srv, http.MethodPost, "/api/v1/world/commands", body, c.header)
		if c.ok && rec.Code == http.StatusForbidden {
			t.Errorf("%s: rejected: %s", c.name, rec.Body)
		}
		if !c.ok && (rec.Code != http.StatusForbidden || code(t, rec) != CodeCSRFRejected) {
			t.Errorf("%s: %d %s, want 403 csrf_rejected", c.name, rec.Code, rec.Body)
		}
	}
	// Logout and the WebSocket upgrade apply the same rule.
	if rec := serveReq(srv, http.MethodPost, "/api/v1/auth/logout", "", map[string]string{"Cookie": cookie}); rec.Code != 403 {
		t.Errorf("logout without origin: %d", rec.Code)
	}
	if rec := serveReq(srv, http.MethodGet, "/api/v1/ws", "", map[string]string{"Cookie": cookie, "Origin": "http://evil.example"}); rec.Code != 403 {
		t.Errorf("ws from a foreign origin: %d", rec.Code)
	}
	// Starting a cookie session (login CSRF) needs an origin; bearer not.
	login := `{"email":"a@b.org","password":"12345678"}`
	if rec := serveReq(srv, http.MethodPost, "/api/v1/auth/login", login, nil); rec.Code != 403 {
		t.Errorf("cookie login without origin: %d", rec.Code)
	}
	if rec := serveReq(srv, http.MethodPost, "/api/v1/auth/login", login, map[string]string{"Referer": testOrigin + "/"}); rec.Code != 403 {
		t.Errorf("cookie login with a Referer only: %d", rec.Code)
	}
	if rec := serveReq(srv, http.MethodPost, "/api/v1/auth/guest", `{}`, map[string]string{"Sec-Fetch-Site": "same-origin"}); rec.Code != 200 {
		t.Errorf("cookie guest with Sec-Fetch-Site same-origin: %d", rec.Code)
	}
	if rec := serveReq(srv, http.MethodPost, "/api/v1/auth/login", login, map[string]string{"Origin": testOrigin}); rec.Code != 200 ||
		!strings.Contains(rec.Header().Get("Set-Cookie"), "ns_session=new-token") || strings.Contains(rec.Body.String(), "new-token") {
		t.Errorf("cookie login: %d %s %v", rec.Code, rec.Body, rec.Header())
	}
	rec := serveReq(srv, http.MethodPost, "/api/v1/auth/login", `{"email":"a@b.org","password":"12345678","transport":"bearer"}`, nil)
	if rec.Code != 200 || rec.Header().Get("Set-Cookie") != "" || !strings.Contains(rec.Body.String(), `"session_token":"new-token"`) {
		t.Errorf("bearer login: %d %s", rec.Code, rec.Body)
	}
	if rec := serveReq(srv, http.MethodPost, "/api/v1/auth/guest", `{"transport":"carrier-pigeon"}`, nil); rec.Code != 400 {
		t.Errorf("bad transport: %d", rec.Code)
	}
}

func TestSessionCookieAttributes(t *testing.T) {
	srv, _ := newSessionServer(t, nil)
	rec := serveReq(srv, http.MethodPost, "/api/v1/auth/guest", `{}`, map[string]string{"Origin": testOrigin})
	c := rec.Result().Cookies()
	if rec.Code != 200 || len(c) != 1 || c[0].Name != SessionCookie || !c[0].HttpOnly || c[0].SameSite != http.SameSiteLaxMode || c[0].Path != "/" || c[0].MaxAge != 30*24*3600 {
		t.Fatalf("%d %+v", rec.Code, c)
	}
	if rec.Header().Get("Access-Control-Allow-Credentials") != "true" {
		t.Fatal("missing Access-Control-Allow-Credentials")
	}
	pre := serveReq(srv, http.MethodOptions, "/api/v1/auth/guest", "", map[string]string{"Origin": testOrigin})
	if !strings.Contains(pre.Header().Get("Access-Control-Allow-Headers"), "Authorization") {
		t.Fatalf("preflight %v", pre.Header())
	}
	logout := serveReq(srv, http.MethodPost, "/api/v1/auth/logout", "", map[string]string{"Cookie": SessionCookie + "=cookie-token", "Origin": testOrigin})
	if logout.Code != 204 || !strings.Contains(logout.Header().Get("Set-Cookie"), "Max-Age=0") {
		t.Fatalf("logout %d %v", logout.Code, logout.Header())
	}
}

// TestAuthRateLimit: exceeding the limit is 429 rate_limited with
// Retry-After; login is limited per IP and per email.
func TestAuthRateLimit(t *testing.T) {
	lim := &denyAfter{n: 2, seen: map[string]int{}}
	srv, acc := newSessionServer(t, lim)
	h := map[string]string{"Origin": testOrigin}
	for i := range 3 {
		rec := serveReq(srv, http.MethodPost, "/api/v1/auth/guest", `{}`, h)
		if i < 2 && rec.Code != 200 {
			t.Fatalf("request %d: %d", i, rec.Code)
		}
		if i == 2 && (rec.Code != 429 || code(t, rec) != CodeRateLimited || rec.Header().Get("Retry-After") != "3") {
			t.Fatalf("third request: %d %s Retry-After=%q", rec.Code, rec.Body, rec.Header().Get("Retry-After"))
		}
	}
	// Per email: different IPs (via a trusted proxy) hit the same email key.
	for i := range 3 {
		h := map[string]string{"Origin": testOrigin, "X-Forwarded-For": "203.0.113." + string(rune('1'+i))}
		req := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/api/v1/auth/login", strings.NewReader(`{"email":" Victim@Example.org","password":"12345678"}`))
		req.RemoteAddr = "10.1.2.3:4567"
		for k, v := range h {
			req.Header.Set(k, v)
		}
		rec := httptest.NewRecorder()
		srv.ServeHTTP(rec, req)
		if i < 2 && rec.Code != 200 {
			t.Fatalf("login %d: %d %s", i, rec.Code, rec.Body)
		}
		if i == 2 && rec.Code != 429 {
			t.Fatalf("login per email not limited: %d", rec.Code)
		}
	}
	if acc.logins != 2 {
		t.Fatalf("logins %d", acc.logins)
	}
	if lim.seen["login:email:victim@example.org"] != 3 {
		t.Fatalf("email key not normalised: %v", lim.seen)
	}
}

func TestClientIP(t *testing.T) {
	srv, _ := newSessionServer(t, nil)
	for _, c := range []struct{ peer, xff, want string }{
		{"203.0.113.9:1", "", "203.0.113.9"},
		{"203.0.113.9:1", "198.51.100.1", "203.0.113.9"}, // untrusted peer: header ignored
		{"10.0.0.1:1", "198.51.100.1", "198.51.100.1"},
		{"10.0.0.1:1", "198.51.100.7, 198.51.100.1, 10.0.0.2", "198.51.100.1"},
		{"10.0.0.1:1", "", "10.0.0.1"},
		{"[::ffff:10.0.0.1]:1", "198.51.100.1", "198.51.100.1"},
	} {
		req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/", nil)
		req.RemoteAddr = c.peer
		if c.xff != "" {
			req.Header.Set("X-Forwarded-For", c.xff)
		}
		if got := srv.clientIP(req); got != c.want {
			t.Errorf("peer %s xff %q: %s, want %s", c.peer, c.xff, got, c.want)
		}
	}
}

func TestAuthErrorCodes(t *testing.T) {
	srv, _ := newSessionServer(t, nil)
	spec := loadSpec(t)
	h := map[string]string{"Origin": testOrigin}
	for _, c := range []struct {
		path, body string
		status     int
		code       string
	}{
		{"/api/v1/auth/register", `{"email":"a@b.org","password":"12345678"}`, 409, CodeEmailTaken},
		{"/api/v1/auth/register", `{"email":"a@b.org"}`, 400, CodeBadRequest},
		{"/api/v1/auth/verify-email", `{"token":"x"}`, 400, CodeInvalidToken},
		{"/api/v1/auth/password-reset/confirm", `{"token":"x","password":"1"}`, 400, CodeWeakPassword},
		{"/api/v1/auth/password-reset/request", `{"email":"a@b.org","x":1}`, 400, CodeBadRequest},
		{"/api/v1/auth/guest", `{"device_token":""}`, 401, CodeInvalidCredentials},
	} {
		rec := serveReq(srv, http.MethodPost, c.path, c.body, h)
		if rec.Code != c.status || code(t, rec) != c.code {
			t.Errorf("%s %s: %d %s", c.path, c.body, rec.Code, rec.Body)
		}
		spec.validateSchema(t, "ErrorResponse", rec.Body.Bytes())
	}
	if rec := serveReq(srv, http.MethodPost, "/api/v1/auth/password-reset/request", `{"email":"nobody@example.org"}`, h); rec.Code != 204 {
		t.Errorf("reset request: %d", rec.Code)
	}
}
