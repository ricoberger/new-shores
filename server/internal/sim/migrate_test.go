package sim

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"
)

// TestSchemaMigrationsRegistered: schema 7 (D-054) registers no
// migration: envelopes of schema 1-6 (the game was not deployed), envelopes
// without a version and newer ones fail loudly with ErrSchemaVersion.
func TestSchemaMigrationsRegistered(t *testing.T) {
	m := SchemaMigrations(catalogue(t))
	if SchemaVersion != 7 || len(m) != 0 {
		t.Fatalf("SchemaVersion %d with %d migrations: add migration tests", SchemaVersion, len(m))
	}
	for _, raw := range []string{
		`{"schema_version":0,"content_version":"x","world":{}}`,
		`{"schema_version":8,"content_version":"x","world":{}}`,
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
// (the hand-made dev archipelago) and 6 (tiles in the state, before D-054)
// are not migrated; they fail with
// ErrSchemaVersion and need a fresh database (make down VOLUMES=1 && make
// up).
func TestOldSchemaFixturesFailToLoad(t *testing.T) {
	files, err := filepath.Glob(filepath.Join("testdata", "schema[456]_*.json"))
	if err != nil || len(files) < 11 {
		t.Fatalf("schema 4 fixtures %v (%v)", files, err)
	}
	for _, f := range files {
		data, err := os.ReadFile(f) // #nosec G304 -- test fixture path.
		if err != nil {
			t.Fatal(err)
		}
		if _, _, _, err := Decode(data, catalogue(t)); !errors.Is(err, ErrSchemaVersion) {
			t.Errorf("%s: err = %v, want ErrSchemaVersion", f, err)
		}
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
	c := catalogue(t)
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
