package api

import (
	"log/slog"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/ricoberger/new-shores/server/internal/store"
)

// TestPatchMeLanguage (D-061): PATCH /auth/me stores a served language,
// rejects an unknown or missing one, needs a session and (for the cookie)
// the CSRF origin proof; dev mode echoes without storing.
func TestPatchMeLanguage(t *testing.T) {
	accts := &fakeAccounts{}
	srv, err := New(Config{
		Store: store.NewMemory(testWorld, foundedWorld(t, testStart), func() time.Time { return testStart }), Catalogue: shippedCatalogue(t), Clock: WallClock{},
		Accounts: accts, CORSOrigins: []string{testOrigin}, Logger: slog.New(slog.DiscardHandler),
	})
	if err != nil {
		t.Fatal(err)
	}
	bearer := map[string]string{"Authorization": "Bearer bearer-token", "Content-Type": "application/json"}

	if rec := serveReq(srv, http.MethodGet, "/api/v1/auth/me", "", bearer); rec.Code != 200 || strings.Contains(rec.Body.String(), `"language"`) {
		t.Fatalf("before: %d %s", rec.Code, rec.Body)
	}
	rec := serveReq(srv, http.MethodPatch, "/api/v1/auth/me", `{"language":"de"}`, bearer)
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), `"language":"de"`) {
		t.Fatalf("patch: %d %s", rec.Code, rec.Body)
	}
	loadSpec(t).validateSchema(t, "AuthResponse", rec.Body.Bytes())
	if rec := serveReq(srv, http.MethodGet, "/api/v1/auth/me", "", bearer); !strings.Contains(rec.Body.String(), `"language":"de"`) {
		t.Fatalf("me after: %s", rec.Body)
	}

	for name, body := range map[string]string{"unknown": `{"language":"xx"}`, "empty": `{"language":""}`, "missing": `{}`, "extra": `{"language":"de","x":1}`, "null": `{"language":null}`} {
		if rec := serveReq(srv, http.MethodPatch, "/api/v1/auth/me", body, bearer); rec.Code != 400 || code(t, rec) != CodeBadRequest {
			t.Errorf("%s: %d %s", name, rec.Code, rec.Body)
		}
	}
	if rec := serveReq(srv, http.MethodPatch, "/api/v1/auth/me", `{"language":"de"}`, map[string]string{"Content-Type": "application/json"}); rec.Code != 401 {
		t.Errorf("no session: %d", rec.Code)
	}
	cookie := map[string]string{"Cookie": SessionCookie + "=cookie-token", "Content-Type": "application/json"}
	if rec := serveReq(srv, http.MethodPatch, "/api/v1/auth/me", `{"language":"en"}`, cookie); rec.Code != 403 || code(t, rec) != CodeCSRFRejected {
		t.Errorf("cookie without origin: %d %s", rec.Code, rec.Body)
	}
	cookie["Origin"] = testOrigin
	if rec := serveReq(srv, http.MethodPatch, "/api/v1/auth/me", `{"language":"en"}`, cookie); rec.Code != 200 {
		t.Errorf("cookie with origin: %d %s", rec.Code, rec.Body)
	}
}

func TestPatchMeLanguageInDevMode(t *testing.T) {
	srv := shippedServer(t)
	hdr := map[string]string{"Content-Type": "application/json"}
	rec := serveReq(srv, http.MethodPatch, "/api/v1/auth/me", `{"language":"de"}`, hdr)
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), `"language":"de"`) {
		t.Fatalf("dev patch: %d %s", rec.Code, rec.Body)
	}
	if rec := serveReq(srv, http.MethodPatch, "/api/v1/auth/me", `{"language":"xx"}`, hdr); rec.Code != 400 {
		t.Fatalf("dev unknown: %d", rec.Code)
	}
}
