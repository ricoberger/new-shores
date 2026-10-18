package sim

import (
	"encoding/json"
	"fmt"
)

// SchemaVersion is the current world schema version.
const SchemaVersion = 1

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
// Envelopes with another schema version are rejected with ErrSchemaVersion.
func Decode(data []byte) (*World, string, error) {
	var head struct {
		SchemaVersion int `json:"schema_version"`
	}
	if err := json.Unmarshal(data, &head); err != nil {
		return nil, "", fmt.Errorf("decode envelope: %w", err)
	}
	if head.SchemaVersion != SchemaVersion {
		return nil, "", fmt.Errorf("%w: %d (want %d)", ErrSchemaVersion, head.SchemaVersion, SchemaVersion)
	}
	var env Envelope
	if err := json.Unmarshal(data, &env); err != nil {
		return nil, "", fmt.Errorf("decode envelope: %w", err)
	}
	env.World.LastEvaluatedAt = env.World.LastEvaluatedAt.UTC()
	return &env.World, env.ContentVersion, nil
}
