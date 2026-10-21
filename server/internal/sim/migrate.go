package sim

import (
	"cmp"
	"encoding/json"
	"fmt"
	"slices"

	"github.com/ricoberger/new-shores/server/internal/content"
)

// RawEnvelope is a stored envelope whose world has not been decoded yet:
// the input and output of a schema migration. World holds the JSON of the
// world in the schema version the migration reads (input) or writes
// (output).
type RawEnvelope struct {
	ContentVersion string
	World          json.RawMessage
}

// Migration upgrades an envelope from schema version N to N+1. Migrations
// are pure functions on the envelope (no I/O, no clock, no randomness), like
// the rest of this package; notes collects what a migration reports to the
// caller (never nil).
type Migration func(e RawEnvelope, notes *MigrationNotes) (RawEnvelope, error)

// Migrations maps a schema version N to the migration from N to N+1.
type Migrations map[int]Migration

// MigrationNotes is what the migrations of one Decode report to the caller,
// which logs it (this package never logs).
type MigrationNotes struct {
	// FieldShortfalls lists the farms whose efficiency the 2 -> 3
	// migration could not keep because the free field tiles ran out.
	FieldShortfalls []FieldShortfall
}

// FieldShortfall is a farm that got fewer fields in the 2 -> 3 migration
// than its stored efficiency needs. Efficiencies are per mille.
type FieldShortfall struct {
	IslandID      string
	BuildingID    int64
	Type          string
	Placed        int
	Required      int
	OldEfficiency int64
	NewEfficiency int64
}

// SchemaMigrations returns the registered schema migrations. c is the
// content catalogue of the binary; the 2 -> 3 migration reads the farm and
// field definitions from it (a nil catalogue fails that migration).
//
// Adding the next migration (docs/ARCHITECTURE.md §4.1):
//
//  1. Before changing the world format, commit an envelope encoded by the
//     current binary as testdata/schema<N>_<what>.json (a real world, e.g.
//     the end state of a scenario).
//  2. Increment SchemaVersion, write migrateNtoN1 (pure, JSON in, JSON out)
//     and register it here under N.
//  3. Add a case to the table of TestMigrations (migrate_test.go) that
//     decodes the fixture, asserts the migrated fields and checks the
//     re-encode/round-trip/Advance/Display template.
func SchemaMigrations(c *content.Catalogue) Migrations {
	return Migrations{
		1: migrate1to2,
		2: func(e RawEnvelope, notes *MigrationNotes) (RawEnvelope, error) { return migrate2to3(e, c, notes) },
	}
}

// migrate1to2 adds the state of quests and the "while you were away"
// summary (schema 2): no completed quests, last_seen_at =
// last_evaluated_at, an empty summary accumulator and no pending summary.
// Only last_seen_at has to be written; the other fields are omitted when
// empty.
func migrate1to2(e RawEnvelope, _ *MigrationNotes) (RawEnvelope, error) {
	var world map[string]json.RawMessage
	if err := json.Unmarshal(e.World, &world); err != nil {
		return e, err
	}
	last, ok := world["last_evaluated_at"]
	if !ok {
		return e, fmt.Errorf("world has no last_evaluated_at")
	}
	for _, field := range []string{"quests", "last_seen_at", "away", "pending_summary"} {
		if _, ok := world[field]; ok {
			return e, fmt.Errorf("schema 1 world already has %q", field)
		}
	}
	world["last_seen_at"] = last
	out, err := json.Marshal(world)
	if err != nil {
		return e, err
	}
	return RawEnvelope{ContentVersion: e.ContentVersion, World: out}, nil
}

// DecodeWith is Decode with an explicit migration registry. An envelope
// older than SchemaVersion is upgraded step by step with migrations; an
// envelope that is newer than SchemaVersion, or older without a registered
// path to SchemaVersion, fails with ErrSchemaVersion (it is never reset or
// silently accepted). The notes of the applied migrations are returned.
func DecodeWith(data []byte, migrations Migrations) (*World, string, MigrationNotes, error) {
	var notes MigrationNotes
	var head struct {
		SchemaVersion  *int            `json:"schema_version"`
		ContentVersion string          `json:"content_version"`
		World          json.RawMessage `json:"world"`
	}
	if err := json.Unmarshal(data, &head); err != nil {
		return nil, "", notes, fmt.Errorf("decode envelope: %w", err)
	}
	if head.SchemaVersion == nil {
		return nil, "", notes, fmt.Errorf("%w: missing schema_version", ErrSchemaVersion)
	}
	v := *head.SchemaVersion
	if v > SchemaVersion {
		return nil, "", notes, fmt.Errorf("%w: %d is newer than %d", ErrSchemaVersion, v, SchemaVersion)
	}
	if v == SchemaVersion {
		w, cv, err := decodeCurrent(data)
		return w, cv, notes, err
	}
	env := RawEnvelope{ContentVersion: head.ContentVersion, World: head.World}
	for ; v < SchemaVersion; v++ {
		m := migrations[v]
		if m == nil {
			return nil, "", MigrationNotes{}, fmt.Errorf("%w: no migration from %d to %d (want %d)", ErrSchemaVersion, v, v+1, SchemaVersion)
		}
		next, err := m(env, &notes)
		if err != nil {
			return nil, "", MigrationNotes{}, fmt.Errorf("%w: migration from %d to %d: %w", ErrSchemaVersion, v, v+1, err)
		}
		env = next
	}
	out, err := json.Marshal(struct {
		SchemaVersion  int             `json:"schema_version"`
		ContentVersion string          `json:"content_version"`
		World          json.RawMessage `json:"world"`
	}{SchemaVersion, env.ContentVersion, env.World})
	if err != nil {
		return nil, "", MigrationNotes{}, fmt.Errorf("decode envelope: %w", err)
	}
	w, cv, err := decodeCurrent(out)
	if err != nil {
		return nil, "", MigrationNotes{}, err
	}
	return w, cv, notes, nil
}

// decodeCurrent decodes an envelope of the current schema version.
func decodeCurrent(data []byte) (*World, string, error) {
	var env Envelope
	if err := json.Unmarshal(data, &env); err != nil {
		return nil, "", fmt.Errorf("decode envelope: %w", err)
	}
	env.World.LastEvaluatedAt = env.World.LastEvaluatedAt.UTC()
	return &env.World, env.ContentVersion, nil
}

// migrate2to3 gives every farm explicit fields (D-049). Schema 2 farms
// drew their efficiency from free grass tiles in their radius; schema 3
// farms need field buildings. For every building whose current content
// definition has a fields block, in ascending building ID (islands are
// independent), the migration places up to fields.required fields on the
// free tiles that pass the field rule for its field type and for which
// this farm is the nearest accepting farm (so that the assignment holds
// afterwards), nearest to the farm's footprint centre first, ties by row
// then column. Tiles taken for one farm are no longer free for the next.
// Assignment, efficiency and connectivity are then recomputed. A farm whose
// new efficiency is below its stored one (its free tiles ran out) is
// reported in notes. A world that already contains a field fails.
func migrate2to3(e RawEnvelope, c *content.Catalogue, notes *MigrationNotes) (RawEnvelope, error) {
	if c == nil {
		return e, fmt.Errorf("the fields migration needs the content catalogue")
	}
	var w World
	if err := json.Unmarshal(e.World, &w); err != nil {
		return e, err
	}
	for _, is := range w.Islands {
		for _, b := range is.Buildings {
			if def := c.BuildingByID[b.Type]; def != nil && def.Field != nil {
				return e, fmt.Errorf("schema 2 world already has field %d (%s) on island %q", b.ID, b.Type, is.ID)
			}
		}
	}
	for _, is := range w.Islands {
		old := map[int64]int64{}
		placed := map[int64]int{}
		farms := slices.Clone(is.Buildings)
		slices.SortFunc(farms, func(a, b *Building) int { return cmp.Compare(a.ID, b.ID) })
		for _, b := range farms {
			def := c.BuildingByID[b.Type]
			if def == nil || def.Fields == nil {
				continue
			}
			old[b.ID] = b.Efficiency
			tiles := migrationFieldTiles(is, c, b, def)
			fdef := c.FieldByType[def.Fields.Type]
			for _, p := range tiles {
				is.Buildings = append(is.Buildings, &Building{ID: w.NextBuildingID, Type: fdef.ID, X: p.X, Y: p.Y, Efficiency: 1000})
				w.NextBuildingID++
			}
			placed[b.ID] = len(tiles)
		}
		if len(old) == 0 {
			continue
		}
		afterChange(is, c)
		for _, b := range farms {
			def := c.BuildingByID[b.Type]
			if def == nil || def.Fields == nil || b.Efficiency >= old[b.ID] {
				continue
			}
			notes.FieldShortfalls = append(notes.FieldShortfalls, FieldShortfall{
				IslandID: is.ID, BuildingID: b.ID, Type: b.Type, Placed: placed[b.ID], Required: def.Fields.Required,
				OldEfficiency: old[b.ID], NewEfficiency: b.Efficiency,
			})
		}
	}
	out, err := json.Marshal(&w)
	if err != nil {
		return e, err
	}
	return RawEnvelope{ContentVersion: e.ContentVersion, World: out}, nil
}

// migrationFieldTiles selects the field tiles of a farm for migrate2to3:
// up to fields.required valid field tiles in its radius for which it is
// the nearest accepting farm, nearest first, ties by row then column.
func migrationFieldTiles(is *Island, c *content.Catalogue, b *Building, def *content.Building) []Pos {
	fdef := c.FieldByType[def.Fields.Type]
	if fdef == nil || def.WorkArea == nil {
		return nil
	}
	farms := acceptingFarms(is, c, def.Fields.Type)
	occ := is.occupancy(c)
	w, h := footprint(def, b.Rotation)
	self := farmSite{id: b.ID, x: b.X, y: b.Y, w: w, h: h, radius: def.WorkArea.Radius}
	r := def.WorkArea.Radius
	var tiles []Pos
	for ty := b.Y - r - h; ty <= b.Y+h+r; ty++ {
		for tx := b.X - r - w; tx <= b.X+w+r; tx++ {
			if !self.contains(tx, ty) || nearestFarm(farms, tx, ty) != b.ID {
				continue
			}
			if checkFieldTile(is, occ, fdef, farms, tx, ty) == nil {
				tiles = append(tiles, Pos{tx, ty})
			}
		}
	}
	slices.SortFunc(tiles, func(p, q Pos) int {
		return cmp.Or(cmp.Compare(self.dist2(p.X, p.Y), self.dist2(q.X, q.Y)), cmp.Compare(p.Y, q.Y), cmp.Compare(p.X, q.X))
	})
	return tiles[:min(len(tiles), def.Fields.Required)]
}
