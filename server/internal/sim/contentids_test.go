package sim

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// TestDecodeRejectsUnknownContentIDs (D-083): an envelope stored at the
// current schema under the catalogue's content version that names a
// building, good, ship or quest the catalogue does not define (a toolmaker
// in a 0.24.0 world) fails with ErrUnknownContent, listing every such ID.
// The same world under another content version, or stored at an older
// schema and migrated, decodes: the caller decides about the content
// version, and migrated worlds keep the IDs of their time.
func TestDecodeRejectsUnknownContentIDs(t *testing.T) {
	c := shippedCatalogue(t)
	data, err := os.ReadFile(filepath.Join("testdata", "schema17_bootstrap_citizens.json"))
	if err != nil {
		t.Fatal(err)
	}
	var env map[string]any
	if err := json.Unmarshal(data, &env); err != nil {
		t.Fatal(err)
	}
	if env["content_version"] != c.Region.Version {
		t.Fatalf("fixture content %v, want %s (regenerate the schema fixtures)", env["content_version"], c.Region.Version)
	}
	if _, _, _, err := Decode(data, c); err != nil {
		t.Fatalf("clean fixture: %v", err)
	}
	world := env["world"].(map[string]any)
	island := world["regions"].([]any)[0].(map[string]any)["islands"].([]any)[0].(map[string]any)
	island["buildings"] = append(island["buildings"].([]any), map[string]any{
		"id": 999_999, "type": "toolmaker", "x": 0, "y": 0, "rotation": 0, "efficiency": 1000,
		"transit": []any{map[string]any{"good": "tools", "from_ms": 0, "to_ms": 1, "rate_sub": 1}},
	})
	island["inventory"].(map[string]any)["stock"].(map[string]any)["tools"] = 1000
	world["quests"].(map[string]any)["intro_tools"] = map[string]any{}
	world["ships"] = append(world["ships"].([]any), map[string]any{"id": 99, "type": "galley", "name": "X", "state": "idle", "island_id": "oc-01"})
	encodeEnv := func(schema int, cv string) []byte {
		env["schema_version"], env["content_version"] = schema, cv
		out, err := json.Marshal(env)
		if err != nil {
			t.Fatal(err)
		}
		return out
	}

	_, _, _, err = Decode(encodeEnv(SchemaVersion, c.Region.Version), c)
	if !errors.Is(err, ErrUnknownContent) {
		t.Fatalf("err = %v, want ErrUnknownContent", err)
	}
	if want := "building toolmaker, good tools, quest intro_tools, ship galley"; !strings.Contains(err.Error(), want) {
		t.Errorf("err = %v, want it to list %q", err, want)
	}
	if _, _, _, err := Decode(encodeEnv(SchemaVersion, "old_coast-0.23.1"), c); err != nil {
		t.Errorf("other content version: %v (the caller checks the version)", err)
	}
	if _, _, notes, err := Decode(encodeEnv(SchemaVersion-1, c.Region.Version), c); err != nil || notes.FromSchema != SchemaVersion-1 {
		t.Errorf("migrated from %d: notes %+v, %v (migrated worlds are not checked)", SchemaVersion-1, notes, err)
	}
}
