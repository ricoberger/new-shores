package sim

import (
	"encoding/json"
	"fmt"

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
// which logs it (this package never logs). No registered migration reports
// anything yet.
type MigrationNotes struct{}

// SchemaMigrations returns the registered schema migrations; c is the
// content catalogue of the binary for migrations that need content. None
// is registered: worlds of schema 1-9 are not migrated (the game was not
// deployed; schema 10 renamed market_small to market with the tier-3
// content, D-056 C3) but fail to load with ErrSchemaVersion (a fresh
// database is required).
//
// Adding the next migration (docs/ARCHITECTURE.md §4.1):
//
//  1. Before changing the world format, commit an envelope encoded by the
//     current binary as testdata/schema<N>_<what>.json (a real world, e.g.
//     the end state of a scenario).
//  2. Increment SchemaVersion, write migrateNtoN1 (pure, JSON in, JSON out)
//     and register it here under N.
//  3. Add a test that decodes the fixture, asserts the migrated fields and
//     checks the re-encode/round-trip/Advance/Display template
//     (TestSchemaFixtures in migrate_test.go).
func SchemaMigrations(_ *content.Catalogue) Migrations {
	return Migrations{}
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
