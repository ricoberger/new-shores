package sim

import (
	"bytes"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"

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
// content catalogue of the binary for migrations that need content
// (15 -> 16 reads its regions). 14 -> 15 (migrate14to15, D-071 plans) and
// 15 -> 16 (migrate15to16, D-076 regions) are registered; worlds of
// schema 1-13 are not migrated (the game was not deployed), but fail to
// load with ErrSchemaVersion (a fresh database is required).
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
func SchemaMigrations(c *content.Catalogue) Migrations {
	return Migrations{14: migrate14to15, 15: migrate15to16(c)}
}

// migrate15to16 wraps the islands of a schema-15 world into the regions
// of D-076: world.islands becomes regions[0].islands of the home region
// (the catalogue's first region; unlocked, seed = the world seed, every
// island with region_id), followed by an entry per further content region
// (locked, seed = world seed + index, no islands). Generated island IDs
// get the home region's prefix (the former isle prefix becomes oc: an ID of letters,
// a hyphen and digits keeps its digits); the rename replaces the ID as a
// JSON string everywhere in the world (ships, legs, routes, the away log),
// and the terrain (DecodeTerrain) matches the old IDs by their digits.
// Ships get the home region (region_id). The passage point is left unset
// (nil): the sim cannot run the generator, and nothing reads it while no
// passage exists.
func migrate15to16(c *content.Catalogue) Migration {
	return func(e RawEnvelope, _ *MigrationNotes) (RawEnvelope, error) {
		if c == nil || len(c.Regions) == 0 {
			return e, fmt.Errorf("schema 15 world: the migration needs the content regions")
		}
		var world map[string]json.RawMessage
		if err := json.Unmarshal(e.World, &world); err != nil {
			return e, fmt.Errorf("schema 15 world: %w", err)
		}
		var islands []map[string]json.RawMessage
		if raw, ok := world["islands"]; ok {
			if err := json.Unmarshal(raw, &islands); err != nil {
				return e, fmt.Errorf("schema 15 islands: %w", err)
			}
		}
		var seed uint64
		if raw, ok := world["seed"]; ok {
			if err := json.Unmarshal(raw, &seed); err != nil {
				return e, fmt.Errorf("schema 15 seed: %w", err)
			}
		}
		home := c.Regions[0]
		homeID, _ := json.Marshal(home.ID)
		renames := map[string]string{}
		for _, is := range islands {
			var id string
			if err := json.Unmarshal(is["id"], &id); err != nil {
				return e, fmt.Errorf("schema 15 island id: %w", err)
			}
			if to := prefixedIslandID(id, home.Prefix); to != id {
				renames[id] = to
			}
			is["region_id"] = homeID
		}
		regions := make([]Region, len(c.Regions))
		for i, r := range c.Regions {
			regions[i] = Region{ID: r.ID, Unlocked: i == 0}
			if seed != 0 {
				regions[i].Seed = (seed-1+uint64(i))%(1<<53-1) + 1 // #nosec G115 -- i >= 0; archipelago.RegionSeed
			}
		}
		rawRegions, err := json.Marshal(regions)
		if err != nil {
			return e, err
		}
		var out []map[string]json.RawMessage
		if err := json.Unmarshal(rawRegions, &out); err != nil {
			return e, err
		}
		rawIslands, err := json.Marshal(islands)
		if err != nil {
			return e, err
		}
		if islands == nil {
			rawIslands = []byte("[]")
		}
		out[0]["islands"] = rawIslands
		if world["regions"], err = json.Marshal(out); err != nil {
			return e, err
		}
		delete(world, "islands")
		if raw, ok := world["ships"]; ok {
			var ships []map[string]json.RawMessage
			if err := json.Unmarshal(raw, &ships); err != nil {
				return e, fmt.Errorf("schema 15 ships: %w", err)
			}
			for _, s := range ships {
				s["region_id"] = homeID
			}
			if world["ships"], err = json.Marshal(ships); err != nil {
				return e, err
			}
		}
		data, err := json.Marshal(world)
		if err != nil {
			return e, err
		}
		for _, from := range sortedKeys(renames) {
			data = bytes.ReplaceAll(data, []byte(strconv.Quote(from)), []byte(strconv.Quote(renames[from])))
		}
		e.World = data
		return e, nil
	}
}

// prefixedIslandID returns a generated island ID ("<letters>-<digits>")
// with the given prefix; any other ID (hand-made islands) unchanged.
func prefixedIslandID(id, prefix string) string {
	head, digits, ok := strings.Cut(id, "-")
	if !ok || head == "" || digits == "" || strings.Trim(head, "abcdefghijklmnopqrstuvwxyz") != "" || strings.Trim(digits, "0123456789") != "" {
		return id
	}
	return prefix + "-" + digits
}

// migrate14to15 adds the plans of D-071 (Island.Plans,
// Island.PlannedRoads): both are optional and absent in a schema-14
// world, which has no plans, so the world JSON is unchanged.
func migrate14to15(e RawEnvelope, _ *MigrationNotes) (RawEnvelope, error) {
	var world map[string]json.RawMessage
	if err := json.Unmarshal(e.World, &world); err != nil {
		return e, fmt.Errorf("schema 14 world: %w", err)
	}
	return e, nil
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
