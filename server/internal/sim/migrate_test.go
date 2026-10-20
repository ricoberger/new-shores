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

// TestSchemaMigrationsRegistered: every version below SchemaVersion has a
// migration (from 1 on); envelopes without a path (version 0), newer ones
// and envelopes without a version fail loudly.
func TestSchemaMigrationsRegistered(t *testing.T) {
	m := SchemaMigrations()
	if SchemaVersion != 2 || len(m) != SchemaVersion-1 {
		t.Fatalf("SchemaVersion %d with %d migrations: add migration tests", SchemaVersion, len(m))
	}
	for v := 1; v < SchemaVersion; v++ {
		if m[v] == nil {
			t.Errorf("no migration from %d", v)
		}
	}
	for _, raw := range []string{
		`{"schema_version":0,"content_version":"x","world":{}}`,
		`{"schema_version":3,"content_version":"x","world":{}}`,
		`{"content_version":"x","world":{}}`,
		`{"schema_version":1,"content_version":"x","world":{}}`,
		`{"schema_version":1,"content_version":"x","world":{"last_evaluated_at":"2026-01-01T00:00:00Z","last_seen_at":"2026-01-01T00:00:00Z"}}`,
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
	migrations := Migrations{prev: func(e RawEnvelope) (RawEnvelope, error) {
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
	fail := Migrations{prev: func(e RawEnvelope) (RawEnvelope, error) { return e, errors.New("boom") }}
	if _, _, err := DecodeWith(old, fail); !errors.Is(err, ErrSchemaVersion) || !strings.Contains(err.Error(), "boom") {
		t.Fatalf("err = %v", err)
	}
	// Newer than the binary: never migrated down.
	newer := bytes.Replace(current, []byte(fmt.Sprintf(`"schema_version":%d`, SchemaVersion)), []byte(fmt.Sprintf(`"schema_version":%d`, SchemaVersion+1)), 1)
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
// commands; it is re-encoded at the current schema version.
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
	// The removed per-tile Tile.Fertility was never written by any stored
	// world (no reader or writer existed), and island fertility tags are an
	// optional field added within schema 1 (R-10).
	for _, field := range []string{`"fertility"`, `"fertilities"`} {
		if bytes.Contains(data, []byte(field)) {
			t.Fatalf("schema-1 fixture carries %s", field)
		}
	}
	w, cv, err := Decode(data)
	if err != nil || cv != "old_coast-0.2.0" {
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
	if err := json.Unmarshal(encode(t, w), &env); err != nil || env.SchemaVersion != SchemaVersion {
		t.Errorf("re-encoded schema version %d (%v)", env.SchemaVersion, err)
	}
}

// TestDecodeIgnoresTileFertility (R-10): a schema-1 envelope with the
// removed per-tile "fertility" field still decodes; the field is ignored
// (dropped on re-encode) and the island has no fertility tags.
func TestDecodeIgnoresTileFertility(t *testing.T) {
	data, err := os.ReadFile(filepath.Join("testdata", "schema1_dev_world.json"))
	if err != nil {
		t.Fatal(err)
	}
	withTag := bytes.Replace(data, []byte(`{"terrain":"grass"}`), []byte(`{"terrain":"grass","fertility":["wheat"]}`), 1)
	if bytes.Equal(withTag, data) {
		t.Fatal("fixture has no grass tile to tag")
	}
	w, _, err := Decode(withTag)
	if err != nil {
		t.Fatal(err)
	}
	if len(w.Islands[0].Fertilities) != 0 || bytes.Contains(encode(t, w), []byte(`"fertility"`)) {
		t.Errorf("fertility survived decoding: %v", w.Islands[0].Fertilities)
	}
}

// TestMigrations is the template for every schema migration: each case
// decodes a committed envelope of an older schema version (a real world
// encoded by the binary of that version) through Decode, asserts the
// migrated fields, re-encodes it at SchemaVersion, checks that the result
// round-trips unchanged and that Advance and Display work on it.
func TestMigrations(t *testing.T) {
	c := catalogue(t)
	tests := []struct {
		name    string
		fixture string
		version int
		content string
		check   func(t *testing.T, w *World)
	}{
		{
			// The end state of the bootstrap_citizens reference game encoded
			// at schema 1 (content old_coast-0.4.0): two islands, ships,
			// routes and tier 2.
			name: "1to2 bootstrap_citizens", fixture: "schema1_bootstrap_citizens.json", version: 1, content: "old_coast-0.4.0",
			check: checkMigrated1to2,
		},
		{
			name: "1to2 dev world", fixture: "schema1_dev_world.json", version: 1, content: "old_coast-0.2.0",
			check: checkMigrated1to2,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			data, err := os.ReadFile(filepath.Join("testdata", tt.fixture))
			if err != nil {
				t.Fatal(err)
			}
			var head struct {
				SchemaVersion int `json:"schema_version"`
			}
			if err := json.Unmarshal(data, &head); err != nil || head.SchemaVersion != tt.version {
				t.Fatalf("fixture schema version %d (%v), want %d", head.SchemaVersion, err, tt.version)
			}
			w, cv, err := Decode(data)
			if err != nil || cv != tt.content {
				t.Fatalf("decode: %v, content %q", err, cv)
			}
			tt.check(t, w)

			// Re-encoded at the current schema version; a current envelope
			// round-trips unchanged.
			enc := encode(t, w)
			if err := json.Unmarshal(enc, &head); err != nil || head.SchemaVersion != SchemaVersion {
				t.Fatalf("re-encoded schema version %d (%v)", head.SchemaVersion, err)
			}
			again, _, err := Decode(enc)
			if err != nil {
				t.Fatal(err)
			}
			if got := encode(t, again); !bytes.Equal(got, enc) {
				t.Fatal("current envelope does not round-trip")
			}

			// Advance and Display work on the migrated world.
			end := again.LastEvaluatedAt.Add(time.Hour)
			if _, err := Advance(again, c, end); err != nil {
				t.Fatal(err)
			}
			if _, err := Display(again, c, end); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func checkMigrated1to2(t *testing.T, w *World) {
	t.Helper()
	if !w.LastSeenAt.Equal(w.LastEvaluatedAt) || w.LastSeenAt.IsZero() {
		t.Errorf("last_seen_at %s, last_evaluated_at %s", w.LastSeenAt, w.LastEvaluatedAt)
	}
	if len(w.Quests) != 0 || w.PendingSummary != nil {
		t.Errorf("quests %v, pending summary %+v", w.Quests, w.PendingSummary)
	}
	if empty := (AwayLog{}); w.Away.GoldDeltaSub != empty.GoldDeltaSub || w.Away.Flows != nil || w.Away.PopulationDelta != nil ||
		w.Away.AutoPaused != 0 || w.Away.AutoResumed != 0 || w.Away.ShipsArrived != 0 || w.Away.Arrivals != nil {
		t.Errorf("accumulator %+v", w.Away)
	}
}
