package sim

import (
	"encoding/json"

	"github.com/ricoberger/new-shores/server/internal/content"
)

// SchemaVersion is the current world schema version. Version 2 added the
// quest state and the "while you were away" summary, version 3 the
// explicit fields of farms (D-049), version 4 the Trading Post, inland
// Warehouses, berths and the start at sea (D-051) and version 5 the
// adjacency fields (D-051 part 4: Building.FarmID is the owning farm,
// Building.Inactive), version 6 the generated archipelago (D-053:
// World.Seed, World.ArchipelagoRoll, Island.SizeClass), version 7 the
// terrain stored apart from the state (D-054: EncodeState writes islands
// without tiles) and version 8 the ship names (D-055: Ship.Name, migrated
// from 7 with the default names) and version 10 tier 3 (D-056 C3: the
// market renamed from market_small, the Merchant content; 9 is unused, the
// S1 documents named it for the need model, which shipped as 8) and
// version 11 the D-058 terrain (Tile.Level and Tile.Height, the river,
// islet and cliff terrains, roads on rivers), and version 12 the per-column
// water rows (D-062), and version 13 the ranked service chains (D-065:
// guard and fire station lose their levels, the market and the warehouse
// have four; a stored level 2 of a guard or fire station is not migrated).
// Versions 1-12 have no
// migration path (the game was not deployed; a fresh database is needed:
// make down VOLUMES=1 && make up).
const SchemaVersion = 13

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

// Decode parses an envelope and returns the world, its content version and
// the notes of the applied migrations. Older envelopes are upgraded with
// the registered schema migrations (SchemaMigrations with the catalogue c);
// a schema version without a migration path to SchemaVersion, or a newer
// one, is rejected with ErrSchemaVersion.
func Decode(data []byte, c *content.Catalogue) (*World, string, MigrationNotes, error) {
	return DecodeWith(data, SchemaMigrations(c))
}
