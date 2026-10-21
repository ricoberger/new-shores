package sim

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/ricoberger/new-shores/server/internal/content"
)

// TestSchemaMigrationsRegistered: every version below SchemaVersion has a
// migration (from 1 on); envelopes without a path (version 0), newer ones
// and envelopes without a version fail loudly.
func TestSchemaMigrationsRegistered(t *testing.T) {
	m := SchemaMigrations(catalogue(t))
	if SchemaVersion != 3 || len(m) != SchemaVersion-1 {
		t.Fatalf("SchemaVersion %d with %d migrations: add migration tests", SchemaVersion, len(m))
	}
	for v := 1; v < SchemaVersion; v++ {
		if m[v] == nil {
			t.Errorf("no migration from %d", v)
		}
	}
	for _, raw := range []string{
		`{"schema_version":0,"content_version":"x","world":{}}`,
		`{"schema_version":4,"content_version":"x","world":{}}`,
		`{"content_version":"x","world":{}}`,
		`{"schema_version":1,"content_version":"x","world":{}}`,
		`{"schema_version":1,"content_version":"x","world":{"last_evaluated_at":"2026-01-01T00:00:00Z","last_seen_at":"2026-01-01T00:00:00Z"}}`,
	} {
		if _, _, _, err := Decode([]byte(raw), catalogue(t)); !errors.Is(err, ErrSchemaVersion) {
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
	w, cv, _, err := Decode(data, c)
	if err != nil || cv != "old_coast-0.2.0" {
		t.Fatalf("decode: %v %s schema %d", err, cv, SchemaVersion)
	}
	if len(w.Islands) != 1 || len(w.Ships) != 0 || len(w.Routes) != 0 || len(DueEvents(w)) != 0 {
		t.Fatalf("world: islands %d ships %d", len(w.Islands), len(w.Ships))
	}
	end := w.LastEvaluatedAt.Add(12 * time.Hour)
	run := func(split time.Duration) []byte {
		cw, _, _, err := Decode(data, c)
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
	w, _, _, err := Decode(withTag, catalogue(t))
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
		check   func(t *testing.T, c *content.Catalogue, w *World, before *World)
	}{
		{
			// The end state of the bootstrap_citizens reference game encoded
			// at schema 1 (content old_coast-0.4.0): two islands, ships,
			// routes and tier 2. Chained 1 -> 2 -> 3.
			name: "1to3 bootstrap_citizens", fixture: "schema1_bootstrap_citizens.json", version: 1, content: "old_coast-0.4.0",
			check: func(t *testing.T, c *content.Catalogue, w, before *World) {
				checkMigrated1to2(t, w)
				checkMigrated2to3(t, c, w, before)
			},
		},
		{
			name: "1to3 dev world", fixture: "schema1_dev_world.json", version: 1, content: "old_coast-0.2.0",
			check: func(t *testing.T, c *content.Catalogue, w, before *World) {
				checkMigrated1to2(t, w)
				checkMigrated2to3(t, c, w, before)
			},
		},
		{
			// The end state of bootstrap_citizens encoded at schema 2
			// (content old_coast-0.5.0): three sheep farms at 1000.
			name: "2to3 bootstrap_citizens", fixture: "schema2_bootstrap_citizens.json", version: 2, content: "old_coast-0.5.0",
			check: checkMigrated2to3,
		},
		{
			// The end state of citizens_island_load at schema 2: thirteen
			// farms of all four types, six tiles apart on one island.
			name: "2to3 citizens_island_load", fixture: "schema2_citizens_island_load.json", version: 2, content: "old_coast-0.5.0",
			check: checkMigrated2to3,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			data, err := os.ReadFile(filepath.Join("testdata", tt.fixture))
			if err != nil {
				t.Fatal(err)
			}
			var head struct {
				SchemaVersion int             `json:"schema_version"`
				World         json.RawMessage `json:"world"`
			}
			if err := json.Unmarshal(data, &head); err != nil || head.SchemaVersion != tt.version {
				t.Fatalf("fixture schema version %d (%v), want %d", head.SchemaVersion, err, tt.version)
			}
			// The stored world as written (the schema-3 struct reads every
			// field of schema 1 and 2).
			var before World
			if err := json.Unmarshal(head.World, &before); err != nil {
				t.Fatal(err)
			}
			w, cv, notes, err := Decode(data, c)
			if err != nil || cv != tt.content {
				t.Fatalf("decode: %v, content %q", err, cv)
			}
			if len(notes.FieldShortfalls) != 0 {
				t.Errorf("shortfalls %+v", notes.FieldShortfalls)
			}
			tt.check(t, c, w, &before)

			// Re-encoded at the current schema version; a current envelope
			// round-trips unchanged.
			enc := encode(t, w)
			if err := json.Unmarshal(enc, &head); err != nil || head.SchemaVersion != SchemaVersion {
				t.Fatalf("re-encoded schema version %d (%v)", head.SchemaVersion, err)
			}
			again, _, _, err := Decode(enc, nil)
			if err != nil {
				t.Fatal(err)
			}
			if got := encode(t, again); !bytes.Equal(got, enc) {
				t.Fatal("current envelope does not round-trip")
			}
			// The migration is deterministic.
			w2, _, _, err := Decode(data, c)
			if err != nil || !bytes.Equal(encode(t, w2), enc) {
				t.Fatalf("second decode differs (%v)", err)
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

// checkMigrated2to3 checks the fields migration against the stored world:
// every farm's efficiency is at least its stored one (per mille), farms at
// 1000 stay at 1000; each farm has min(required, available) fields, all
// assigned to it (a farm below required has no valid field tile left for
// which it is the nearest farm); the new fields have sequential IDs from
// the stored next building ID; nothing else changed.
func checkMigrated2to3(t *testing.T, c *content.Catalogue, w, before *World) {
	t.Helper()
	next := before.NextBuildingID
	farms := 0
	for _, bis := range before.Islands {
		is := w.Island(bis.ID)
		stored := map[int64]*Building{}
		for _, b := range bis.Buildings {
			stored[b.ID] = b
		}
		fields := map[int64][]*Building{}
		var newIDs []int64
		for _, b := range is.Buildings {
			def := c.BuildingByID[b.Type]
			if old := stored[b.ID]; old != nil {
				if old.Type != b.Type || old.X != b.X || old.Y != b.Y {
					t.Errorf("building %d moved or changed", b.ID)
				}
				continue
			}
			if def == nil || def.Field == nil {
				t.Errorf("new building %d is %s", b.ID, b.Type)
				continue
			}
			newIDs = append(newIDs, b.ID)
			fields[b.FarmID] = append(fields[b.FarmID], b)
		}
		for i, id := range newIDs {
			if id != next+int64(i) {
				t.Errorf("field IDs %v not sequential from %d", newIDs, next)
				break
			}
		}
		next += int64(len(newIDs))
		if len(fields[0]) != 0 {
			t.Errorf("island %s: %d unassigned fields", is.ID, len(fields[0]))
		}
		for _, b := range is.Buildings {
			def := c.BuildingByID[b.Type]
			if def == nil || def.Fields == nil {
				continue
			}
			farms++
			old := stored[b.ID].Efficiency
			n := len(fields[b.ID])
			if b.Efficiency < old || (old == 1000 && b.Efficiency != 1000) || b.Efficiency != fieldEfficiency(n, def.Fields.Required) {
				t.Errorf("%s %d: efficiency %d -> %d with %d fields", b.Type, b.ID, old, b.Efficiency, n)
			}
			for _, f := range fields[b.ID] {
				if fdef := c.BuildingByID[f.Type]; fdef.Field.Type != def.Fields.Type {
					t.Errorf("%s %d got a %s", b.Type, b.ID, f.Type)
				}
			}
			if n > def.Fields.Required {
				t.Errorf("%s %d: %d fields", b.Type, b.ID, n)
			}
			if n < def.Fields.Required {
				if left := freeOwnFieldTiles(is, c, b); len(left) > 0 {
					t.Errorf("%s %d: %d fields but free tiles %v", b.Type, b.ID, n, left)
				}
			}
		}
	}
	if w.NextBuildingID != next {
		t.Errorf("next building ID %d, want %d", w.NextBuildingID, next)
	}
	t.Logf("%d farms migrated", farms)
}

// freeOwnFieldTiles returns the valid field tiles in the farm's radius for
// which the farm is the nearest accepting farm.
func freeOwnFieldTiles(is *Island, c *content.Catalogue, farm *Building) []Pos {
	def := c.BuildingByID[farm.Type]
	var cand []Pos
	for y := 0; y < is.Height; y++ {
		for x := 0; x < is.Width; x++ {
			cand = append(cand, Pos{x, y})
		}
	}
	farms := acceptingFarms(is, c, def.Fields.Type)
	var out []Pos
	for _, p := range ValidFieldTiles(is, c, c.FieldByType[def.Fields.Type].ID, cand) {
		if nearestFarm(farms, p.X, p.Y) == farm.ID {
			out = append(out, p)
		}
	}
	return out
}

// schema2Envelope re-labels a current envelope as schema 2 (the schema-3
// world format is schema 2 plus fields and farm_id).
func schema2Envelope(t *testing.T, w *World) []byte {
	t.Helper()
	return bytes.Replace(encode(t, w), []byte(`"schema_version":3`), []byte(`"schema_version":2`), 1)
}

// TestMigrate2to3Shortfall: a farm whose stored efficiency needs more
// fields than its free grass tiles allow gets every free tile, a lower
// efficiency and is reported as a shortfall; a farm with room keeps 1000.
func TestMigrate2to3Shortfall(t *testing.T) {
	c := catalogue(t)
	w := NewWorld(t0)
	w.Islands = []*Island{islandFromRows("main",
		"~~~~~~~~~~~~~~~~~~~~~~~~",
		"~cccccffffffff.........~",
		"~....cffffffff.........~",
		"~....cff...fff.........~",
		"~....cff...fff.........~",
		"~....cff...fff.........~",
		"~....cff..ffff.........~",
		"~....cffffffff.........~",
		"~....cffffffff.........~",
		"~~~~~~~~~~~~~~~~~~~~~~~~",
	)}
	mustPlaceFree(t, w, c, PlaceBuilding{IslandID: "main", Type: "warehouse", X: 1, Y: 1})
	// The first farm sits in a forest clearing with 2 free grass tiles; the
	// second in open grass.
	mustPlaceFree(t, w, c, PlaceBuilding{IslandID: "main", Type: "sheep_farm", X: 8, Y: 3})
	mustPlaceFree(t, w, c, PlaceBuilding{IslandID: "main", Type: "sheep_farm", X: 17, Y: 3})
	w.Gold = 10_000_000
	// The stored schema-2 efficiencies (24 required tiles).
	w.Islands[0].Buildings[1].Efficiency = 1000
	w.Islands[0].Buildings[2].Efficiency = 1000
	got, _, notes, err := Decode(schema2Envelope(t, w), c)
	if err != nil {
		t.Fatal(err)
	}
	want := []FieldShortfall{{IslandID: "main", BuildingID: 2, Type: "sheep_farm", Placed: 2, Required: 16, OldEfficiency: 1000, NewEfficiency: 125}}
	if !slices.Equal(notes.FieldShortfalls, want) {
		t.Fatalf("shortfalls %+v, want %+v", notes.FieldShortfalls, want)
	}
	farm1, farm2 := got.Islands[0].Building(2), got.Islands[0].Building(3)
	if farm1.Efficiency != 125 || farm2.Efficiency != 1000 {
		t.Errorf("efficiencies %d, %d", farm1.Efficiency, farm2.Efficiency)
	}
	ds, err := Display(got, c, got.LastEvaluatedAt)
	if err != nil {
		t.Fatal(err)
	}
	for _, b := range ds.Islands[0].Buildings {
		// Unconnected (no road): the status is not_connected.
		if b.ID == 2 && (b.Fields == nil || *b.Fields != (FieldsDisplay{Assigned: 2, Required: 16}) || b.EfficiencyPermille != 125) {
			t.Errorf("farm display %+v efficiency %d", b.Fields, b.EfficiencyPermille)
		}
	}
}

// TestMigrate2to3RejectsFields: a schema-2 world cannot contain a field.
func TestMigrate2to3RejectsFields(t *testing.T) {
	c := catalogue(t)
	w := testWorld(t, c)
	mustApply(t, w, c, PlaceBuilding{IslandID: "main", Type: "sheep_farm", X: 14, Y: 5})
	mustApply(t, w, c, PlaceBuilding{IslandID: "main", Type: "pasture", X: 13, Y: 7})
	if _, _, _, err := Decode(schema2Envelope(t, w), c); !errors.Is(err, ErrSchemaVersion) || !strings.Contains(err.Error(), "already has field") {
		t.Fatalf("err = %v", err)
	}
	// Without a catalogue the migration cannot run.
	w2 := testWorld(t, c)
	if _, _, _, err := Decode(schema2Envelope(t, w2), nil); !errors.Is(err, ErrSchemaVersion) {
		t.Fatalf("nil catalogue: err = %v", err)
	}
}

func mustPlaceFree(t *testing.T, w *World, c *content.Catalogue, cmd PlaceBuilding) {
	t.Helper()
	if err := PlaceFree(w, c, cmd, nil); err != nil {
		t.Fatalf("PlaceFree(%+v): %v", cmd, err)
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
