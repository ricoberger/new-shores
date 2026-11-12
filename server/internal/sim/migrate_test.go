package sim

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/ricoberger/new-shores/server/internal/content"
)

// TestSchemaMigrationsRegistered: schema 16 (D-076 regions) registers the
// migrations 14 -> 15 and 15 -> 16; envelopes of schema 1-13 (the game was not
// deployed), envelopes without a version and newer ones fail loudly with
// ErrSchemaVersion.
func TestSchemaMigrationsRegistered(t *testing.T) {
	m := SchemaMigrations(catalogue(t))
	if SchemaVersion != 16 || len(m) != 2 || m[14] == nil || m[15] == nil {
		t.Fatalf("SchemaVersion %d with %d migrations: add migration tests", SchemaVersion, len(m))
	}
	for _, raw := range []string{
		`{"schema_version":0,"content_version":"x","world":{}}`,
		`{"schema_version":17,"content_version":"x","world":{}}`,
		`{"schema_version":13,"content_version":"old_coast-0.17.0","world":{}}`,
		`{"schema_version":12,"content_version":"old_coast-0.16.0","world":{}}`,
		`{"schema_version":11,"content_version":"old_coast-0.15.0","world":{}}`,
		`{"schema_version":10,"content_version":"old_coast-0.13.0","world":{"last_evaluated_at":"2026-01-01T00:00:00Z","last_seen_at":"2026-01-01T00:00:00Z"}}`,
		`{"schema_version":9,"content_version":"old_coast-0.11.0","world":{"last_evaluated_at":"2026-01-01T00:00:00Z","last_seen_at":"2026-01-01T00:00:00Z"}}`,
		`{"schema_version":8,"content_version":"old_coast-0.11.0","world":{"last_evaluated_at":"2026-01-01T00:00:00Z","last_seen_at":"2026-01-01T00:00:00Z"}}`,
		`{"schema_version":7,"content_version":"old_coast-0.10.0","world":{"last_evaluated_at":"2026-01-01T00:00:00Z","last_seen_at":"2026-01-01T00:00:00Z"}}`,
		`{"schema_version":6,"content_version":"old_coast-0.9.0","world":{"last_evaluated_at":"2026-01-01T00:00:00Z","last_seen_at":"2026-01-01T00:00:00Z"}}`,
		`{"schema_version":5,"content_version":"old_coast-0.8.0","world":{"last_evaluated_at":"2026-01-01T00:00:00Z","last_seen_at":"2026-01-01T00:00:00Z"}}`,
		`{"schema_version":4,"content_version":"old_coast-0.7.0","world":{"last_evaluated_at":"2026-01-01T00:00:00Z","last_seen_at":"2026-01-01T00:00:00Z"}}`,
		`{"content_version":"x","world":{}}`,
		`{"schema_version":1,"content_version":"x","world":{}}`,
		`{"schema_version":2,"content_version":"x","world":{"last_evaluated_at":"2026-01-01T00:00:00Z","last_seen_at":"2026-01-01T00:00:00Z"}}`,
		`{"schema_version":3,"content_version":"old_coast-0.6.0","world":{"last_evaluated_at":"2026-01-01T00:00:00Z","last_seen_at":"2026-01-01T00:00:00Z"}}`,
	} {
		if _, _, _, err := Decode([]byte(raw), catalogue(t)); !errors.Is(err, ErrSchemaVersion) {
			t.Errorf("%s: err = %v, want ErrSchemaVersion", raw, err)
		}
	}
}

// TestOldSchemaFixturesFailToLoad: worlds of schema 4 (radius fields), 5
// (the hand-made dev archipelago), 6 (tiles in the state, before D-054),
// 7 (ships without names), 8 (market_small, before the tier-3 content)
// and 10–11 (before D-058 terrain / D-062 water rows) are not migrated; they fail with
// ErrSchemaVersion and need a fresh database (make down VOLUMES=1 &&
// make up).
func TestOldSchemaFixturesFailToLoad(t *testing.T) {
	files, err := filepath.Glob(filepath.Join("testdata", "schema[45678]_*.json"))
	if err == nil {
		var ten []string
		ten, err = filepath.Glob(filepath.Join("testdata", "schema1[01]_*.json"))
		files = append(files, ten...)
	}
	if err != nil || len(files) < 23 {
		t.Fatalf("old schema fixtures %v (%v)", files, err)
	}
	for _, f := range files {
		data, err := os.ReadFile(f) // #nosec G304 -- test fixture path.
		if err != nil {
			t.Fatal(err)
		}
		for _, c := range []*content.Catalogue{catalogue(t), shippedCatalogue(t)} {
			if _, _, _, err := Decode(data, c); !errors.Is(err, ErrSchemaVersion) {
				t.Errorf("%s: err = %v, want ErrSchemaVersion", f, err)
			}
		}
	}
}

// TestMigrate14to15: migrate14to15 leaves the world JSON of every
// committed schema-14 envelope (before the D-071 plans) unchanged; through
// the registered migrations (14 -> 15 -> 16) it decodes into a world
// without plans that advances and displays.
func TestMigrate14to15(t *testing.T) {
	catalogues := map[string]*content.Catalogue{}
	for _, c := range []*content.Catalogue{catalogue(t), shippedCatalogue(t)} {
		catalogues[c.Region.Version] = c
	}
	files, err := filepath.Glob(filepath.Join("testdata", "schema14_*.json"))
	if err != nil || len(files) < 3 {
		t.Fatalf("schema 14 fixtures %v (%v)", files, err)
	}
	for _, f := range files {
		t.Run(filepath.Base(f), func(t *testing.T) {
			data, err := os.ReadFile(f) // #nosec G304 -- test fixture path.
			if err != nil {
				t.Fatal(err)
			}
			terrain, err := os.ReadFile(strings.TrimSuffix(f, ".json") + ".terrain.gz") // #nosec G304 -- test fixture path.
			if err != nil {
				t.Fatal(err)
			}
			var c *content.Catalogue
			for key, cat := range catalogues {
				if bytes.Contains(data, []byte(`"content_version":"`+key+`"`)) {
					c = cat
				}
			}
			if c == nil {
				t.Fatal("no catalogue for the fixture's content version")
			}
			w, cv, _, err := DecodeState(data, terrain, c)
			if err != nil {
				t.Fatal(err)
			}
			for _, is := range w.Islands() {
				if len(is.Plans) != 0 || len(is.PlannedRoads) != 0 {
					t.Fatalf("island %s has plans after the migration", is.ID)
				}
			}
			var head struct {
				World json.RawMessage `json:"world"`
			}
			if err := json.Unmarshal(data, &head); err != nil {
				t.Fatal(err)
			}
			if out, err := migrate14to15(RawEnvelope{ContentVersion: cv, World: head.World}, &MigrationNotes{}); err != nil || !bytes.Equal(out.World, head.World) {
				t.Fatalf("migrate14to15 changed the world (%v)", err)
			}
			end := w.LastEvaluatedAt.Add(time.Hour)
			if _, err := Advance(w, c, end); err != nil {
				t.Fatal(err)
			}
			if _, err := Display(w, c, end); err != nil {
				t.Fatal(err)
			}
		})
	}
}

// TestDecodeAppliesRegisteredMigration: a stored envelope one version older
// than SchemaVersion is upgraded by the registered migration function and
// then decoded as a current envelope.
func TestDecodeAppliesRegisteredMigration(t *testing.T) {
	c := catalogue(t)
	w := testWorld(t, c)
	mustAdvance(t, w, c, 5*time.Second)
	current := encode(t, w)

	// A fictitious previous version stored the gold under "treasury".
	var env map[string]json.RawMessage
	if err := json.Unmarshal(current, &env); err != nil {
		t.Fatal(err)
	}
	var world map[string]json.RawMessage
	if err := json.Unmarshal(env["world"], &world); err != nil {
		t.Fatal(err)
	}
	world["treasury"] = world["gold"]
	delete(world, "gold")
	env["world"], _ = json.Marshal(world)
	prev := SchemaVersion - 1
	env["schema_version"] = json.RawMessage(strconv.Itoa(prev))
	old, _ := json.Marshal(env)

	calls := 0
	migrations := Migrations{prev: func(e RawEnvelope, _ *MigrationNotes) (RawEnvelope, error) {
		calls++
		var m map[string]json.RawMessage
		if err := json.Unmarshal(e.World, &m); err != nil {
			return e, err
		}
		m["gold"] = m["treasury"]
		delete(m, "treasury")
		out, err := json.Marshal(m)
		return RawEnvelope{ContentVersion: e.ContentVersion, World: out}, err
	}}
	got, cv, _, err := DecodeWith(old, migrations)
	if err != nil {
		t.Fatal(err)
	}
	if calls != 1 || cv != "test" {
		t.Fatalf("calls %d, content version %q", calls, cv)
	}
	if again := encode(t, got); !bytes.Equal(again, current) {
		t.Fatalf("migrated world differs:\n%s\n%s", again, current)
	}

	// Without the registered migration the same envelope fails loudly.
	if _, _, _, err := DecodeWith(old, Migrations{}); !errors.Is(err, ErrSchemaVersion) {
		t.Fatalf("err = %v, want ErrSchemaVersion", err)
	}
	// A failing migration fails with ErrSchemaVersion too.
	fail := Migrations{prev: func(e RawEnvelope, _ *MigrationNotes) (RawEnvelope, error) { return e, errors.New("boom") }}
	if _, _, _, err := DecodeWith(old, fail); !errors.Is(err, ErrSchemaVersion) || !strings.Contains(err.Error(), "boom") {
		t.Fatalf("err = %v", err)
	}
	// Newer than the binary: never migrated down.
	newer := bytes.Replace(current, []byte(fmt.Sprintf(`"schema_version":%d`, SchemaVersion)), []byte(fmt.Sprintf(`"schema_version":%d`, SchemaVersion+1)), 1)
	if _, _, _, err := DecodeWith(newer, migrations); !errors.Is(err, ErrSchemaVersion) {
		t.Fatalf("newer: err = %v", err)
	}
}

// TestMigrationHookIsCoveredByPurity: the migration registry lives in a
// non-test file of this package, so TestPurity checks it (no I/O, no clock,
// no randomness, no global state).
func TestMigrationHookIsCoveredByPurity(t *testing.T) {
	files := parseNonTest(t, simDir(t))
	if _, ok := files[filepath.Join(simDir(t), "migrate.go")]; !ok {
		t.Fatal("migrate.go is not among the files checked by TestPurity")
	}
}

// TestSchemaFixturesDecode is the template for the next schema migration:
// every committed state envelope of the current schema with its terrain
// (testdata/schema<N>_*.json and .terrain.gz, written by the scenario
// package's TestSchemaFixtures) decodes, re-encodes byte for byte (state
// and terrain), and Advance and Display work on it.
func TestSchemaFixturesDecode(t *testing.T) {
	// Fixtures of the pinned pre-D-054 content and of the shipped content
	// (the reference games); each decodes with the catalogue of its
	// content version.
	catalogues := map[string]*content.Catalogue{}
	for _, c := range []*content.Catalogue{catalogue(t), shippedCatalogue(t)} {
		catalogues[c.Region.Version] = c
	}
	files, err := filepath.Glob(filepath.Join("testdata", fmt.Sprintf("schema%d_*.json", SchemaVersion)))
	if err != nil || len(files) < 3 {
		t.Fatalf("schema fixtures %v (%v)", files, err)
	}
	for _, f := range files {
		t.Run(filepath.Base(f), func(t *testing.T) {
			data, err := os.ReadFile(f) // #nosec G304 -- test fixture path.
			if err != nil {
				t.Fatal(err)
			}
			terrain, err := os.ReadFile(strings.TrimSuffix(f, ".json") + ".terrain.gz") // #nosec G304 -- test fixture path.
			if err != nil {
				t.Fatal(err)
			}
			var c *content.Catalogue
			for key, cat := range catalogues {
				if bytes.Contains(data, []byte(`"content_version":"`+key+`"`)) {
					c = cat
				}
			}
			if c == nil {
				t.Fatal("no catalogue for the fixture's content version")
			}
			w, cv, _, err := DecodeState(data, terrain, c)
			if err != nil || cv != c.Region.Version {
				t.Fatalf("decode: %v, content %q", err, cv)
			}
			if bytes.Contains(data, []byte(`"tiles"`)) {
				t.Error("the state envelope carries tiles")
			}
			state, terrain2, err := EncodeState(w, cv)
			if err != nil || !bytes.Equal(append(state, '\n'), data) || !bytes.Equal(terrain2, terrain) {
				t.Fatalf("the envelope does not round-trip (%v)", err)
			}
			end := w.LastEvaluatedAt.Add(time.Hour)
			if _, err := Advance(w, c, end); err != nil {
				t.Fatal(err)
			}
			if _, err := Display(w, c, end); err != nil {
				t.Fatal(err)
			}
		})
	}
}

// fixtureCatalogue returns the catalogue of a fixture's content version.
func fixtureCatalogue(t *testing.T, data []byte) *content.Catalogue {
	t.Helper()
	for _, c := range []*content.Catalogue{catalogue(t), shippedCatalogue(t)} {
		if bytes.Contains(data, []byte(`"content_version":"`+c.Region.Version+`"`)) {
			return c
		}
	}
	t.Fatal("no catalogue for the fixture's content version")
	return nil
}

// TestMigrate15to16: every committed schema-15 envelope (before the D-076
// regions) decodes through migrate15to16 with its terrain into a world
// whose islands are the home region's, with region-prefixed generated
// IDs, region_id on islands and ships; re-encoded it equals the schema-16
// fixture of the same scenario (the current binary's encoding of the same
// end state) but for the passage point, which a migrated world does not
// know; it advances and displays.
func TestMigrate15to16(t *testing.T) {
	files, err := filepath.Glob(filepath.Join("testdata", "schema15_*.json"))
	if err != nil || len(files) < 4 {
		t.Fatalf("schema 15 fixtures %v (%v)", files, err)
	}
	for _, f := range files {
		t.Run(filepath.Base(f), func(t *testing.T) {
			data, err := os.ReadFile(f) // #nosec G304 -- test fixture path.
			if err != nil {
				t.Fatal(err)
			}
			terrain, err := os.ReadFile(strings.TrimSuffix(f, ".json") + ".terrain.gz") // #nosec G304 -- test fixture path.
			if err != nil {
				t.Fatal(err)
			}
			c := fixtureCatalogue(t, data)
			w, cv, _, err := DecodeState(data, terrain, c)
			if err != nil {
				t.Fatal(err)
			}
			if len(w.Regions) != len(c.Regions) || w.Regions[0].ID != c.Regions[0].ID || !w.Regions[0].Unlocked || w.Regions[0].PassagePoint != nil {
				t.Fatalf("regions %+v", w.Regions)
			}
			for _, is := range w.Islands() {
				if is.RegionID != c.Regions[0].ID || (w.Seed != 0 && !strings.HasPrefix(is.ID, c.Region.Prefix+"-")) {
					t.Fatalf("island %s in region %q", is.ID, is.RegionID)
				}
			}
			for _, s := range w.Ships {
				if s.RegionID != c.Regions[0].ID {
					t.Fatalf("ship %d in region %q", s.ID, s.RegionID)
				}
			}
			state, terrain16, err := EncodeState(w, cv)
			if err != nil {
				t.Fatal(err)
			}
			base := strings.Replace(strings.TrimSuffix(f, ".json"), "schema15_", "schema16_", 1)
			want, err := os.ReadFile(base + ".json") // #nosec G304 -- test fixture path.
			if err != nil {
				t.Fatal(err)
			}
			wantTerrain, err := os.ReadFile(base + ".terrain.gz") // #nosec G304 -- test fixture path.
			if err != nil {
				t.Fatal(err)
			}
			want = regexp.MustCompile(`"passage_point":\{"x":-?\d+,"y":-?\d+\},`).ReplaceAll(bytes.TrimSuffix(want, []byte("\n")), nil)
			if !bytes.Equal(state, want) || !bytes.Equal(terrain16, wantTerrain) {
				t.Fatal("the migrated world differs from the schema-16 fixture")
			}
			end := w.LastEvaluatedAt.Add(time.Hour)
			if _, err := Advance(w, c, end); err != nil {
				t.Fatal(err)
			}
			if _, err := Display(w, c, end); err != nil {
				t.Fatal(err)
			}
		})
	}
}

// TestMigrate15to16Renames: the rename of generated island IDs and its
// limits — hand-made IDs stay, an ID already prefixed stays, every
// occurrence as a JSON string (ships, legs, routes) follows.
func TestMigrate15to16Renames(t *testing.T) {
	legacy := "isle" + "-" // the pre-D-076 form (grep gate)
	for id, want := range map[string]string{legacy + "01": "oc-01", legacy + "13": "oc-13", "oc-02": "oc-02", "main": "main", "wild-x": "wild-x", "a-b-1": "a-b-1", "-01": "-01", "Old-01": "Old-01"} {
		if got := prefixedIslandID(id, "oc"); got != want {
			t.Errorf("prefixedIslandID(%q) = %q, want %q", id, got, want)
		}
	}
	raw := strings.ReplaceAll(`{"seed":7,"islands":[{"id":"L-01","name":"L-02 bay"},{"id":"L-02"}],"ships":[{"id":1,"island_id":"L-02","leg":{"from_island":"L-01","to_island":"L-02"}}],"routes":[{"id":1,"stops":[{"island_id":"L-01"}]}]}`, "L-", legacy)
	out, err := migrate15to16(shippedCatalogue(t))(RawEnvelope{World: json.RawMessage(raw)}, &MigrationNotes{})
	if err != nil {
		t.Fatal(err)
	}
	want := `{"regions":[{"id":"old_coast","islands":[{"id":"oc-01","name":"` + legacy + `02 bay","region_id":"old_coast"},{"id":"oc-02","region_id":"old_coast"}],"seed":7,"unlocked":true}],"routes":[{"id":1,"stops":[{"island_id":"oc-01"}]}],"seed":7,"ships":[{"id":1,"island_id":"oc-02","leg":{"from_island":"oc-01","to_island":"oc-02"},"region_id":"old_coast"}]}`
	if string(out.World) != want {
		t.Fatalf("migrated\n%s\nwant\n%s", out.World, want)
	}
	if _, err := migrate15to16(nil)(RawEnvelope{World: json.RawMessage(raw)}, &MigrationNotes{}); err == nil {
		t.Fatal("migrated without content regions")
	}
}

// TestMigrate15to16Snapshots: the owner's dev snapshots in .snapshots/
// (D-066, git-ignored; skipped when there are none) migrate from schema 15
// with the shipped content, keep every island under its prefixed ID and
// advance and display. Their content version may be older than the
// catalogue's; the dev server rejects that with 409 (D-066), the
// migration itself does not depend on it.
func TestMigrate15to16Snapshots(t *testing.T) {
	files, _ := filepath.Glob(filepath.Join(repoRoot(t), ".snapshots", "*.json"))
	if len(files) == 0 {
		t.Skip("no snapshots in .snapshots/")
	}
	c := shippedCatalogue(t)
	for _, f := range files {
		t.Run(filepath.Base(f), func(t *testing.T) {
			data, err := os.ReadFile(f) // #nosec G304 -- local snapshot path.
			if err != nil {
				t.Fatal(err)
			}
			if !bytes.Contains(data[:min(len(data), 64)], []byte(`"schema_version":15`)) {
				t.Skip("not a schema-15 snapshot")
			}
			w, _, _, err := Decode(data, c)
			if err != nil {
				t.Fatal(err)
			}
			if len(w.Regions) != 1 || len(w.Islands()) == 0 {
				t.Fatalf("%d regions, %d islands", len(w.Regions), len(w.Islands()))
			}
			for _, is := range w.Islands() {
				if !strings.HasPrefix(is.ID, "oc-") || is.RegionID != "old_coast" || len(is.Tiles) != is.Width*is.Height {
					t.Fatalf("island %s region %q", is.ID, is.RegionID)
				}
			}
			if bytes.Contains(must(Encode(w, "x")), []byte(`"isle`+`-`)) {
				t.Fatal("an old island ID survived the migration")
			}
			end := w.LastEvaluatedAt.Add(time.Minute)
			if _, err := Advance(w, c, end); err != nil {
				t.Fatal(err)
			}
			if _, err := Display(w, c, end); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func must(data []byte, err error) []byte {
	if err != nil {
		panic(err)
	}
	return data
}
