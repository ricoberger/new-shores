package sim

import (
	"bytes"
	"encoding/json"
	"errors"
	"os"
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

// TestSchema1FixtureWithoutShips (R-10): a schema-1 world stored before
// ships existed (the dev world of M3 with a small plank chain, no island
// names or positions, no ships, routes or orders) decodes, advances
// deterministically and composably, displays and accepts the new
// commands; the schema version stays 1.
func TestSchema1FixtureWithoutShips(t *testing.T) {
	c := catalogue(t)
	data, err := os.ReadFile(filepath.Join("testdata", "schema1_dev_world.json"))
	if err != nil {
		t.Fatal(err)
	}
	for _, field := range []string{`"ships"`, `"routes"`, `"order"`, `"name"`, `"next_ship_id"`} {
		if bytes.Contains(data, []byte(field)) {
			t.Fatalf("fixture already contains %s", field)
		}
	}
	w, cv, err := Decode(data)
	if err != nil || cv != "old_coast-0.2.0" || SchemaVersion != 1 {
		t.Fatalf("decode: %v %s schema %d", err, cv, SchemaVersion)
	}
	if len(w.Islands) != 1 || len(w.Ships) != 0 || len(w.Routes) != 0 || len(DueEvents(w)) != 0 {
		t.Fatalf("world: islands %d ships %d", len(w.Islands), len(w.Ships))
	}
	end := w.LastEvaluatedAt.Add(12 * time.Hour)
	run := func(split time.Duration) []byte {
		cw, _, err := Decode(data)
		if err != nil {
			t.Fatal(err)
		}
		if split > 0 {
			if _, err := Advance(cw, c, cw.LastEvaluatedAt.Add(split)); err != nil {
				t.Fatal(err)
			}
		}
		if _, err := Advance(cw, c, end); err != nil {
			t.Fatal(err)
		}
		if _, err := Display(cw, c, end); err != nil {
			t.Fatal(err)
		}
		return encode(t, cw)
	}
	a := run(0)
	if !bytes.Equal(a, run(0)) || !bytes.Equal(a, run(37*time.Minute+123*time.Millisecond)) {
		t.Fatal("advancing the schema-1 fixture is not deterministic or not composable")
	}
	ds, err := Display(w, c, w.LastEvaluatedAt)
	if err != nil || len(ds.Ships) != 0 || len(ds.Routes) != 0 || !ds.Islands[0].Settled {
		t.Fatalf("display: %v %+v", err, ds.Islands[0].Settled)
	}
	// The new commands work on an old world: a shipyard can be built and
	// ordered from (sails come from the start stock).
	w.Gold = 10_000_000
	if err := AddStock(w, c, "start", "planks", 100_000, nil); err != nil {
		t.Fatal(err)
	}
	if err := Apply(w, c, CreateRoute{Stops: []Stop{{IslandID: "start"}, {IslandID: "start"}}}); !errors.Is(err, ErrRouteInvalid) {
		t.Errorf("route on a one-island world: %v", err)
	}
	var env struct {
		SchemaVersion int `json:"schema_version"`
	}
	if err := json.Unmarshal(encode(t, w), &env); err != nil || env.SchemaVersion != 1 {
		t.Errorf("re-encoded schema version %d (%v)", env.SchemaVersion, err)
	}
}
