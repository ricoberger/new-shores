package api

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"testing"
	"time"

	"github.com/ricoberger/new-shores/server/internal/store"
)

type langContent struct {
	Language    string   `json:"language"`
	Languages   []string `json:"languages"`
	Region      struct{ Name, Version string }
	Buildings   []struct{ ID, Name string }
	Quests      []struct{ ID, Title, Text string }
	SizeClasses []struct{ ID, Name string }     `json:"size_classes"`
	IslandNames []struct{ Source, Name string } `json:"island_names"`
}

func shippedServer(t *testing.T) *Server {
	t.Helper()
	srv, err := New(Config{
		Store: store.NewMemory(testWorld, foundedWorld(t, testStart), func() time.Time { return testStart }), Catalogue: shippedCatalogue(t), Clock: WallClock{},
		ResolveWorld: func(*http.Request) (store.WorldID, error) { return testWorld, nil }, Logger: slog.New(slog.DiscardHandler),
	})
	if err != nil {
		t.Fatal(err)
	}
	return srv
}

func contentIn(t *testing.T, srv *Server, path string, header map[string]string) (langContent, http.Header) {
	t.Helper()
	rec := serveReq(srv, http.MethodGet, path, "", header)
	if rec.Code != 200 {
		t.Fatalf("%s: %d %s", path, rec.Code, rec.Body)
	}
	var c langContent
	if err := json.Unmarshal(rec.Body.Bytes(), &c); err != nil {
		t.Fatal(err)
	}
	return c, rec.Header()
}

// TestContentLanguage: ?lang wins over Accept-Language, the text fields
// follow the language, the version stays one value and an unknown
// language is a bad request.
func TestContentLanguage(t *testing.T) {
	srv := shippedServer(t)
	en, h := contentIn(t, srv, "/api/v1/content", nil)
	if en.Language != "en" || len(en.Languages) < 2 || en.Languages[0] != "en" || en.Languages[1] != "de" || h.Get("Content-Language") != "en" {
		t.Fatalf("default: %q %v %q", en.Language, en.Languages, h.Get("Content-Language"))
	}
	de, h := contentIn(t, srv, "/api/v1/content?lang=de", nil)
	if de.Language != "de" || h.Get("Content-Language") != "de" || h.Get("Vary") != "Accept-Language" {
		t.Fatalf("de: %q %v", de.Language, h)
	}
	if de.Region.Version != en.Region.Version || de.Region.Name == en.Region.Name {
		t.Errorf("region: %+v vs %+v", de.Region, en.Region)
	}
	if len(de.Buildings) != len(en.Buildings) || len(de.Quests) != len(en.Quests) || len(de.IslandNames) != len(en.IslandNames) || len(en.IslandNames) < 40 {
		t.Fatal("payload shapes differ")
	}
	for i := range en.Buildings {
		if en.Buildings[i].ID != de.Buildings[i].ID {
			t.Fatalf("building order differs at %d", i)
		}
		if en.Buildings[i].Name == de.Buildings[i].Name && !map[string]bool{"depot": true}[en.Buildings[i].ID] {
			t.Errorf("building %s not translated: %q", en.Buildings[i].ID, en.Buildings[i].Name)
		}
	}
	for i := range en.Quests {
		if en.Quests[i].Text == de.Quests[i].Text || en.Quests[i].Title == de.Quests[i].Title {
			t.Errorf("quest %s not translated", en.Quests[i].ID)
		}
	}
	for i := range en.IslandNames {
		if de.IslandNames[i].Source != en.IslandNames[i].Source || en.IslandNames[i].Name != en.IslandNames[i].Source {
			t.Errorf("island name %d: %+v / %+v", i, en.IslandNames[i], de.IslandNames[i])
		}
	}
	if de.SizeClasses[0].Name != "Groß" {
		t.Errorf("size class = %q", de.SizeClasses[0].Name)
	}

	// Accept-Language is the fallback; the parameter wins.
	if c, _ := contentIn(t, srv, "/api/v1/content", map[string]string{"Accept-Language": "fr;q=0.9, de-AT;q=0.8, en;q=0.5"}); c.Language != "de" {
		t.Errorf("Accept-Language de-AT: %q", c.Language)
	}
	if c, _ := contentIn(t, srv, "/api/v1/content", map[string]string{"Accept-Language": "fr, es"}); c.Language != "en" {
		t.Errorf("Accept-Language fr: %q", c.Language)
	}
	if c, _ := contentIn(t, srv, "/api/v1/content?lang=en", map[string]string{"Accept-Language": "de"}); c.Language != "en" {
		t.Errorf("?lang=en: %q", c.Language)
	}
	for _, bad := range []string{"fr", "", "de&lang=en"} {
		if rec := serveReq(srv, http.MethodGet, "/api/v1/content?lang="+bad, "", nil); rec.Code != http.StatusBadRequest {
			t.Errorf("lang=%q: %d", bad, rec.Code)
		}
	}
}
