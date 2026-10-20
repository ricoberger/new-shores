package sim

import (
	"bytes"
	"encoding/json"
	"errors"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// TestSchemaMigrationsEmpty: no migration is registered while SchemaVersion
// is 1, so every older or newer envelope fails loudly.
func TestSchemaMigrationsEmpty(t *testing.T) {
	if SchemaVersion != 1 || len(SchemaMigrations()) != 0 {
		t.Fatalf("SchemaVersion %d with %d migrations: add migration tests", SchemaVersion, len(SchemaMigrations()))
	}
	for _, raw := range []string{
		`{"schema_version":0,"content_version":"x","world":{}}`,
		`{"schema_version":2,"content_version":"x","world":{}}`,
		`{"content_version":"x","world":{}}`,
	} {
		if _, _, err := Decode([]byte(raw)); !errors.Is(err, ErrSchemaVersion) {
			t.Errorf("%s: err = %v, want ErrSchemaVersion", raw, err)
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

	// A fictitious version 0 stored the gold under "treasury".
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
	env["schema_version"] = json.RawMessage(`0`)
	old, _ := json.Marshal(env)

	calls := 0
	migrations := Migrations{0: func(e RawEnvelope) (RawEnvelope, error) {
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
	got, cv, err := DecodeWith(old, migrations)
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
	if _, _, err := DecodeWith(old, Migrations{}); !errors.Is(err, ErrSchemaVersion) {
		t.Fatalf("err = %v, want ErrSchemaVersion", err)
	}
	// A failing migration fails with ErrSchemaVersion too.
	fail := Migrations{0: func(e RawEnvelope) (RawEnvelope, error) { return e, errors.New("boom") }}
	if _, _, err := DecodeWith(old, fail); !errors.Is(err, ErrSchemaVersion) || !strings.Contains(err.Error(), "boom") {
		t.Fatalf("err = %v", err)
	}
	// Newer than the binary: never migrated down.
	newer := bytes.Replace(current, []byte(`"schema_version":1`), []byte(`"schema_version":2`), 1)
	if _, _, err := DecodeWith(newer, migrations); !errors.Is(err, ErrSchemaVersion) {
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
