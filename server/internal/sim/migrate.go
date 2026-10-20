package sim

import (
	"encoding/json"
	"fmt"
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
// the rest of this package.
type Migration func(RawEnvelope) (RawEnvelope, error)

// Migrations maps a schema version N to the migration from N to N+1.
type Migrations map[int]Migration

// SchemaMigrations returns the registered schema migrations. Add an entry
// here (and a test against a stored fixture of the old version) whenever
// SchemaVersion is incremented (docs/ARCHITECTURE.md §4.1). No migration
// exists yet: SchemaVersion is still 1.
func SchemaMigrations() Migrations {
	return Migrations{}
}

// DecodeWith is Decode with an explicit migration registry. An envelope
// older than SchemaVersion is upgraded step by step with migrations; an
// envelope that is newer than SchemaVersion, or older without a registered
// path to SchemaVersion, fails with ErrSchemaVersion (it is never reset or
// silently accepted).
func DecodeWith(data []byte, migrations Migrations) (*World, string, error) {
	var head struct {
		SchemaVersion  *int            `json:"schema_version"`
		ContentVersion string          `json:"content_version"`
		World          json.RawMessage `json:"world"`
	}
	if err := json.Unmarshal(data, &head); err != nil {
		return nil, "", fmt.Errorf("decode envelope: %w", err)
	}
	if head.SchemaVersion == nil {
		return nil, "", fmt.Errorf("%w: missing schema_version", ErrSchemaVersion)
	}
	v := *head.SchemaVersion
	if v > SchemaVersion {
		return nil, "", fmt.Errorf("%w: %d is newer than %d", ErrSchemaVersion, v, SchemaVersion)
	}
	if v == SchemaVersion {
		return decodeCurrent(data)
	}
	env := RawEnvelope{ContentVersion: head.ContentVersion, World: head.World}
	for ; v < SchemaVersion; v++ {
		m := migrations[v]
		if m == nil {
			return nil, "", fmt.Errorf("%w: no migration from %d to %d (want %d)", ErrSchemaVersion, v, v+1, SchemaVersion)
		}
		next, err := m(env)
		if err != nil {
			return nil, "", fmt.Errorf("%w: migration from %d to %d: %w", ErrSchemaVersion, v, v+1, err)
		}
		env = next
	}
	out, err := json.Marshal(struct {
		SchemaVersion  int             `json:"schema_version"`
		ContentVersion string          `json:"content_version"`
		World          json.RawMessage `json:"world"`
	}{SchemaVersion, env.ContentVersion, env.World})
	if err != nil {
		return nil, "", fmt.Errorf("decode envelope: %w", err)
	}
	return decodeCurrent(out)
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
