package api

import (
	"errors"
	"fmt"
	"io"
	"math"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"slices"
	"strconv"
	"strings"

	"github.com/ricoberger/new-shores/server/internal/auth"
)

// SessionCookie is the name of the session cookie (HttpOnly; the token is
// never readable by scripts).
const SessionCookie = "ns_session"

// Session transports of the auth endpoints.
const (
	transportCookie = "cookie"
	transportBearer = "bearer"
)

// authenticate resolves the session of a request from the Authorization
// header (bearer) or the session cookie. A request without either has no
// session (errUnauthorized). fromCookie reports a cookie session; when its
// expiry slid, the cookie is re-issued so that its Max-Age slides too.
func (s *Server) authenticate(w http.ResponseWriter, r *http.Request) (sess *auth.Session, fromCookie bool, err error) {
	token := ""
	if h := r.Header.Get("Authorization"); h != "" {
		scheme, t, ok := strings.Cut(h, " ")
		if !ok || !strings.EqualFold(scheme, "Bearer") || strings.TrimSpace(t) == "" {
			return nil, false, errUnauthorized
		}
		token = strings.TrimSpace(t)
	} else if c, cerr := r.Cookie(SessionCookie); cerr == nil && c.Value != "" {
		token, fromCookie = c.Value, true
	}
	if token == "" {
		return nil, false, errUnauthorized
	}
	sess, err = s.cfg.Accounts.Authenticate(r.Context(), token)
	if errors.Is(err, auth.ErrUnauthorized) {
		return nil, fromCookie, errUnauthorized
	}
	if err != nil {
		return nil, fromCookie, err
	}
	if fromCookie && sess.Refreshed {
		s.setCookie(w, token)
	}
	return sess, fromCookie, nil
}

// carriesSessionCookie: the request would be authenticated by the cookie
// (it has one and no Authorization header).
func carriesSessionCookie(r *http.Request) bool {
	if r.Header.Get("Authorization") != "" {
		return false
	}
	c, err := r.Cookie(SessionCookie)
	return err == nil && c.Value != ""
}

func isSafeMethod(m string) bool {
	return m == http.MethodGet || m == http.MethodHead || m == http.MethodOptions
}

var errCSRF = &apiError{code: CodeCSRFRejected, status: http.StatusForbidden, message: "request origin not allowed"}

// checkOrigin is the CSRF rule of cookie sessions: an Origin header must be
// one of the allowed origins; without Origin, Sec-Fetch-Site must be
// same-origin or same-site; without both, the Referer's origin must be
// allowed. A request that carries none of them is rejected.
func (s *Server) checkOrigin(r *http.Request) error {
	if o := r.Header.Get("Origin"); o != "" {
		if slices.Contains(s.cfg.CORSOrigins, o) {
			return nil
		}
		return errCSRF
	}
	switch r.Header.Get("Sec-Fetch-Site") {
	case "same-origin", "same-site":
		return nil
	case "":
	default:
		return errCSRF
	}
	if ref := r.Header.Get("Referer"); ref != "" {
		if u, err := url.Parse(ref); err == nil && u.Scheme != "" && u.Host != "" &&
			slices.Contains(s.cfg.CORSOrigins, u.Scheme+"://"+u.Host) {
			return nil
		}
	}
	return errCSRF
}

// clientIP is the TCP peer, or the right-most untrusted address of
// X-Forwarded-For when the peer is a trusted proxy.
func (s *Server) clientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	peer, err := netip.ParseAddr(host)
	if err != nil {
		return host
	}
	peer = peer.Unmap()
	if !s.trusted(peer) {
		return peer.String()
	}
	hops := strings.Split(strings.Join(r.Header.Values("X-Forwarded-For"), ","), ",")
	for i := len(hops) - 1; i >= 0; i-- {
		a, err := netip.ParseAddr(strings.TrimSpace(hops[i]))
		if err != nil {
			break
		}
		a = a.Unmap()
		if !s.trusted(a) {
			return a.String()
		}
	}
	return peer.String()
}

func (s *Server) trusted(a netip.Addr) bool {
	for _, p := range s.cfg.TrustedProxies {
		if p.Contains(a) {
			return true
		}
	}
	return false
}

// limit applies the auth rate limit of an endpoint to a key; it writes 429
// rate_limited with Retry-After and returns false when exceeded.
func (s *Server) limit(w http.ResponseWriter, r *http.Request, endpoint, kind, key string) bool {
	if s.cfg.Limiter == nil {
		return true
	}
	ok, retry := s.cfg.Limiter.Allow(r.Context(), endpoint+":"+kind+":"+key)
	if ok {
		return true
	}
	secs := max(1, int(math.Ceil(retry.Seconds())))
	w.Header().Set("Retry-After", strconv.Itoa(secs))
	s.writeError(w, r, &apiError{code: CodeRateLimited, status: http.StatusTooManyRequests, message: fmt.Sprintf("too many requests; retry in %d s", secs)})
	return false
}

func (s *Server) limitIP(w http.ResponseWriter, r *http.Request, endpoint string) bool {
	return s.limit(w, r, endpoint, "ip", s.clientIP(r))
}

func (s *Server) limitEmail(w http.ResponseWriter, r *http.Request, endpoint, email string) bool {
	return s.limit(w, r, endpoint, "email", strings.ToLower(strings.TrimSpace(email)))
}

// Secure comes from COOKIE_SECURE (false only for plain-http local setups).
func (s *Server) setCookie(w http.ResponseWriter, token string) {
	http.SetCookie(w, &http.Cookie{ // #nosec G124 -- HttpOnly and SameSite are set; Secure is configured.
		Name: SessionCookie, Value: token, Path: "/", HttpOnly: true, Secure: s.cfg.CookieSecure,
		SameSite: http.SameSiteLaxMode, MaxAge: int(s.cfg.SessionTTL.Seconds()),
	})
}

func (s *Server) clearCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{ // #nosec G124 -- see setCookie.
		Name: SessionCookie, Value: "", Path: "/", HttpOnly: true, Secure: s.cfg.CookieSecure,
		SameSite: http.SameSiteLaxMode, MaxAge: -1,
	})
}

// playerJSON is the account view of the session's own player.
type playerJSON struct {
	ID            string  `json:"id"`
	DisplayName   string  `json:"display_name"`
	Guest         bool    `json:"guest"`
	Email         *string `json:"email,omitempty"`
	EmailVerified bool    `json:"email_verified"`
}

func toPlayerJSON(p auth.Player) playerJSON {
	return playerJSON{ID: p.ID, DisplayName: p.DisplayName, Guest: p.Guest, Email: p.Email, EmailVerified: p.EmailVerified}
}

// devPlayer is the fixed player of the --dev facade.
var devPlayer = playerJSON{ID: "dev", DisplayName: "Developer", Guest: false}

type authResponse struct {
	Player       playerJSON `json:"player"`
	DeviceToken  string     `json:"device_token,omitempty"`
	SessionToken string     `json:"session_token,omitempty"`
}

type guestRequest struct {
	DeviceToken *string `json:"device_token"`
	Transport   *string `json:"transport"`
}

type registerRequest struct {
	Email       *string `json:"email"`
	Password    *string `json:"password"`
	DisplayName *string `json:"display_name"`
	Transport   *string `json:"transport"`
}

type loginRequest struct {
	Email     *string `json:"email"`
	Password  *string `json:"password"`
	Transport *string `json:"transport"`
}

type tokenRequest struct {
	Token *string `json:"token"`
}

type emailRequest struct {
	Email *string `json:"email"`
}

type resetConfirmRequest struct {
	Token    *string `json:"token"`
	Password *string `json:"password"`
}

// readBody decodes a JSON body strictly; an empty body is {} when
// allowEmpty.
func readBody(w http.ResponseWriter, r *http.Request, v any, allowEmpty bool) error {
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxBodyBytes))
	if err != nil {
		return badRequest(fmt.Sprintf("request body: %v", err))
	}
	if allowEmpty && len(strings.TrimSpace(string(body))) == 0 {
		body = []byte("{}")
	}
	return decodeStrict(body, v)
}

func required(name string, v *string) error {
	if v == nil {
		return badRequest(fmt.Sprintf("missing field %q", name))
	}
	return nil
}

func transport(t *string) (string, error) {
	if t == nil {
		return transportCookie, nil
	}
	switch *t {
	case transportCookie, transportBearer:
		return *t, nil
	}
	return "", badRequest(`transport must be "cookie" or "bearer"`)
}

// issue answers an operation that may have started a session: the token
// goes into the cookie or, for bearer, into the body.
func (s *Server) issue(w http.ResponseWriter, out *auth.Issued, tr string) {
	resp := authResponse{Player: toPlayerJSON(out.Player), DeviceToken: out.DeviceToken}
	if out.SessionToken != "" {
		if tr == transportBearer {
			resp.SessionToken = out.SessionToken
		} else {
			s.setCookie(w, out.SessionToken)
		}
	}
	s.writeJSON(w, http.StatusOK, resp)
}

// startsCookieSession applies the CSRF rule to requests that would set
// the session cookie (login CSRF), even without a current cookie.
func (s *Server) startsCookieSession(r *http.Request, tr string) error {
	if tr == transportCookie {
		return s.checkOrigin(r)
	}
	return nil
}

func (s *Server) devOnlyNotFound(w http.ResponseWriter, r *http.Request) {
	s.writeError(w, r, &apiError{code: CodeNotFound, status: http.StatusNotFound, message: "accounts are not available in dev mode"})
}

func (s *Server) postGuest(w http.ResponseWriter, r *http.Request) {
	if s.cfg.Accounts == nil {
		s.writeJSON(w, http.StatusOK, authResponse{Player: devPlayer})
		return
	}
	if !s.limitIP(w, r, "guest") {
		return
	}
	var req guestRequest
	if err := readBody(w, r, &req, true); err != nil {
		s.writeError(w, r, err)
		return
	}
	tr, err := transport(req.Transport)
	if err == nil {
		err = s.startsCookieSession(r, tr)
	}
	if err != nil {
		s.writeError(w, r, err)
		return
	}
	device := ""
	if req.DeviceToken != nil {
		device = *req.DeviceToken
		if device == "" {
			s.writeError(w, r, auth.ErrInvalidCredentials)
			return
		}
	}
	out, err := s.cfg.Accounts.Guest(r.Context(), device)
	if err != nil {
		s.writeError(w, r, err)
		return
	}
	s.issue(w, out, tr)
}

func (s *Server) postRegister(w http.ResponseWriter, r *http.Request) {
	if s.cfg.Accounts == nil {
		s.devOnlyNotFound(w, r)
		return
	}
	if !s.limitIP(w, r, "register") {
		return
	}
	var req registerRequest
	if err := readBody(w, r, &req, false); err != nil {
		s.writeError(w, r, err)
		return
	}
	err := required("email", req.Email)
	if err == nil {
		err = required("password", req.Password)
	}
	tr := ""
	if err == nil {
		tr, err = transport(req.Transport)
	}
	cur := info(r.Context()).session
	if err == nil && cur == nil {
		err = s.startsCookieSession(r, tr)
	}
	if err != nil {
		s.writeError(w, r, err)
		return
	}
	out, err := s.cfg.Accounts.Register(r.Context(), cur, *req.Email, *req.Password, req.DisplayName)
	if err != nil {
		s.writeError(w, r, err)
		return
	}
	s.issue(w, out, tr)
}

func (s *Server) postLogin(w http.ResponseWriter, r *http.Request) {
	if s.cfg.Accounts == nil {
		s.devOnlyNotFound(w, r)
		return
	}
	if !s.limitIP(w, r, "login") {
		return
	}
	var req loginRequest
	if err := readBody(w, r, &req, false); err != nil {
		s.writeError(w, r, err)
		return
	}
	err := required("email", req.Email)
	if err == nil {
		err = required("password", req.Password)
	}
	tr := ""
	if err == nil {
		tr, err = transport(req.Transport)
	}
	if err == nil {
		err = s.startsCookieSession(r, tr)
	}
	if err != nil {
		s.writeError(w, r, err)
		return
	}
	if !s.limitEmail(w, r, "login", *req.Email) {
		return
	}
	out, err := s.cfg.Accounts.Login(r.Context(), info(r.Context()).session, *req.Email, *req.Password)
	if err != nil {
		s.writeError(w, r, err)
		return
	}
	s.issue(w, out, tr)
}

func (s *Server) postLogout(w http.ResponseWriter, r *http.Request) {
	if s.cfg.Accounts != nil {
		ri := info(r.Context())
		if err := s.cfg.Accounts.Logout(r.Context(), ri.session); err != nil {
			s.writeError(w, r, err)
			return
		}
		if ri.cookie {
			s.clearCookie(w)
		}
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) getMe(w http.ResponseWriter, r *http.Request) {
	if s.cfg.Accounts == nil {
		s.writeJSON(w, http.StatusOK, authResponse{Player: devPlayer})
		return
	}
	p, err := s.cfg.Accounts.Me(r.Context(), info(r.Context()).session)
	if err != nil {
		s.writeError(w, r, err)
		return
	}
	s.writeJSON(w, http.StatusOK, authResponse{Player: toPlayerJSON(p)})
}

func (s *Server) postVerifyEmail(w http.ResponseWriter, r *http.Request) {
	if s.cfg.Accounts == nil {
		s.devOnlyNotFound(w, r)
		return
	}
	if !s.limitIP(w, r, "verify-email") {
		return
	}
	var req tokenRequest
	if err := readBody(w, r, &req, false); err != nil {
		s.writeError(w, r, err)
		return
	}
	if err := required("token", req.Token); err != nil {
		s.writeError(w, r, err)
		return
	}
	if err := s.cfg.Accounts.VerifyEmail(r.Context(), *req.Token); err != nil {
		s.writeError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) postResetRequest(w http.ResponseWriter, r *http.Request) {
	if s.cfg.Accounts == nil {
		s.devOnlyNotFound(w, r)
		return
	}
	if !s.limitIP(w, r, "password-reset") {
		return
	}
	var req emailRequest
	if err := readBody(w, r, &req, false); err != nil {
		s.writeError(w, r, err)
		return
	}
	if err := required("email", req.Email); err != nil {
		s.writeError(w, r, err)
		return
	}
	if !s.limitEmail(w, r, "password-reset", *req.Email) {
		return
	}
	if err := s.cfg.Accounts.RequestPasswordReset(r.Context(), *req.Email); err != nil {
		s.writeError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) postResetConfirm(w http.ResponseWriter, r *http.Request) {
	if s.cfg.Accounts == nil {
		s.devOnlyNotFound(w, r)
		return
	}
	var req resetConfirmRequest
	if err := readBody(w, r, &req, false); err != nil {
		s.writeError(w, r, err)
		return
	}
	err := required("token", req.Token)
	if err == nil {
		err = required("password", req.Password)
	}
	if err != nil {
		s.writeError(w, r, err)
		return
	}
	if err := s.cfg.Accounts.ConfirmPasswordReset(r.Context(), *req.Token, *req.Password); err != nil {
		s.writeError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
