package sim

import (
	"encoding/json"
)

// SchemaVersion is the current world schema version. Version 2 added the
// quest state and the "while you were away" summary (migrate1to2).
const SchemaVersion = 2

// Envelope is the versioned persistence format of a world
// (docs/ARCHITECTURE.md §4.1).
type Envelope struct {
	SchemaVersion  int    `json:"schema_version"`
	ContentVersion string `json:"content_version"`
	World          World  `json:"world"`
}

// Encode serialises the world into a versioned envelope. The output is
// deterministic (struct field order, sorted map keys) and round-trip stable.
func Encode(w *World, contentVersion string) ([]byte, error) {
	return json.Marshal(Envelope{SchemaVersion: SchemaVersion, ContentVersion: contentVersion, World: *w})
}

// Decode parses an envelope and returns the world and its content version.
// Older envelopes are upgraded with the registered schema migrations
// (SchemaMigrations); a schema version without a migration path to
// SchemaVersion, or a newer one, is rejected with ErrSchemaVersion.
func Decode(data []byte) (*World, string, error) {
	return DecodeWith(data, SchemaMigrations())
}
