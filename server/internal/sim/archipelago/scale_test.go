package archipelago

import (
	"bytes"
	"compress/gzip"
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/ricoberger/new-shores/server/internal/content"
	"github.com/ricoberger/new-shores/server/internal/sim"
)

// Target island sizes of the scaling work (not committed content): the
// size classes, the buildable-area target and the spacing a content
// variant would use. targetCatalogue builds that variant from the shipped
// content in a temporary directory (the schema's size maximum raised to
// fit), so the measurements below need no committed content change.
var (
	targetSizes   = map[string]int{"large": 160, "medium": 100, "small": 56, "rock": 16}
	targetOnce    sync.Once
	targetCat     *content.Catalogue
	targetCatErr  error
	targetArea    = 72000
	targetSpacing = map[string]int{"min": 100, "nearest_max": 300}
)

func targetCatalogue(t testing.TB) *content.Catalogue {
	t.Helper()
	targetOnce.Do(func() { targetCat, targetCatErr = loadTarget() })
	if targetCatErr != nil {
		t.Fatal(targetCatErr)
	}
	return targetCat
}

func loadTarget() (*content.Catalogue, error) {
	_, file, _, _ := runtime.Caller(0)
	root := filepath.Join(filepath.Dir(file), "..", "..", "..", "..", "content")
	dir, err := os.MkdirTemp("", "ns-target-content-")
	if err != nil {
		return nil, err
	}
	defer func() { _ = os.RemoveAll(dir) }()
	for _, sub := range []string{"old_coast", "schema"} {
		if err := os.CopyFS(filepath.Join(dir, sub), os.DirFS(filepath.Join(root, sub))); err != nil {
			return nil, err
		}
	}
	islandsPath := filepath.Join(dir, "old_coast", "islands.json")
	raw, err := os.ReadFile(islandsPath) // #nosec G304 -- test temp dir.
	if err != nil {
		return nil, err
	}
	var islands map[string]any
	if err := json.Unmarshal(raw, &islands); err != nil {
		return nil, err
	}
	for _, sc := range islands["size_classes"].([]any) {
		m := sc.(map[string]any)
		m["size"] = targetSizes[m["id"].(string)]
	}
	islands["buildable_area"].(map[string]any)["target"] = targetArea
	islands["spacing"] = targetSpacing
	if raw, err = json.Marshal(islands); err != nil {
		return nil, err
	}
	if err := os.WriteFile(islandsPath, raw, 0o600); err != nil {
		return nil, err
	}
	schemaPath := filepath.Join(dir, "schema", "islands.schema.json")
	schema, err := os.ReadFile(schemaPath) // #nosec G304 -- test temp dir.
	if err != nil {
		return nil, err
	}
	schema = []byte(strings.Replace(string(schema), `"minimum": 8, "maximum": 128`, `"minimum": 8, "maximum": 256`, 1))
	if err := os.WriteFile(schemaPath, schema, 0o600); err != nil { // #nosec G703 -- test temp dir.
		return nil, err
	}
	return content.Load(filepath.Join(dir, "old_coast"))
}

// TestEncodedStateSize reports the persisted size of a new world (the
// JSON text stored in the worlds.state JSONB column) at the committed
// and at the target island sizes (run with -v). ARCHITECTURE §4.2:
// compress (zstd) once it grows past ~1 MB.
func TestEncodedStateSize(t *testing.T) {
	for _, tc := range []struct {
		name string
		cat  func(testing.TB) *content.Catalogue
	}{{"committed", catalogue}, {"target", targetCatalogue}} {
		t.Run(tc.name, func(t *testing.T) {
			c := tc.cat(t)
			w, err := NewWorld(c, 1053001, time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC))
			if err != nil {
				t.Fatal(err)
			}
			state, err := sim.Encode(w, c.Region.Version)
			if err != nil {
				t.Fatal(err)
			}
			var gz bytes.Buffer
			zw := gzip.NewWriter(&gz)
			_, _ = zw.Write(state)
			_ = zw.Close()
			tiles := 0
			for _, is := range w.Islands {
				tiles += len(is.Tiles)
			}
			t.Logf("%s: %d islands, %d tiles, state %d bytes (%.2f MB), gzip %d bytes", tc.name, len(w.Islands), tiles, len(state), float64(len(state))/1e6, gz.Len())
			if len(state) == 0 {
				t.Fatal("empty state")
			}
		})
	}
}

// BenchmarkGenerate times the generator at the committed and the target
// island sizes.
func BenchmarkGenerate(b *testing.B) {
	for _, tc := range []struct {
		name string
		cat  func(testing.TB) *content.Catalogue
	}{{"committed", catalogue}, {"target", targetCatalogue}} {
		b.Run(tc.name, func(b *testing.B) {
			c := tc.cat(b)
			seed := uint64(1)
			for b.Loop() {
				if _, err := Generate(seed, c); err != nil {
					b.Fatal(err)
				}
				seed++
			}
		})
	}
}
