package content

import (
	"bytes"
	"compress/gzip"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path"
	"strings"
	"testing"
)

// TestNoLegacyIslandIDs is the grep gate of the D-076 rename: island IDs
// are region-prefixed ("oc-01"), the pre-D-076 form appears nowhere in
// the repository but in docs/DECISIONS.md (history) and the frozen
// envelopes of older schemas (server/internal/sim/testdata/schema<N>_*,
// the input of the migrations). Gzipped fixtures are read unpacked.
func TestNoLegacyIslandIDs(t *testing.T) {
	legacy := []byte("isle" + "-")
	root := repoRoot(t)
	skipDirs := map[string]bool{".git": true, "node_modules": true, ".experiment": true, ".snapshots": true, ".ai-team": true, "dist": true, "test-results": true, "playwright-report": true, "__pycache__": true}
	skipExt := map[string]bool{".png": true, ".glb": true, ".jpg": true, ".webp": true, ".ico": true, ".woff2": true}
	var hits []string
	fsys := os.DirFS(root)
	err := fs.WalkDir(fsys, ".", func(rel string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			if skipDirs[d.Name()] {
				return fs.SkipDir
			}
			return nil
		}
		if skipExt[path.Ext(rel)] || rel == "docs/DECISIONS.md" ||
			strings.HasPrefix(rel, "server/internal/sim/testdata/schema") {
			return nil
		}
		data, err := fs.ReadFile(fsys, rel)
		if err != nil {
			return err
		}
		if strings.HasSuffix(rel, ".gz") {
			zr, err := gzip.NewReader(bytes.NewReader(data))
			if err != nil {
				return fmt.Errorf("%s: %w", rel, err)
			}
			if data, err = io.ReadAll(zr); err != nil {
				return fmt.Errorf("%s: %w", rel, err)
			}
		}
		if bytes.IndexByte(data, 0) >= 0 {
			return nil
		}
		if bytes.Contains(data, legacy) {
			hits = append(hits, rel)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(hits) > 0 {
		t.Fatalf("pre-D-076 island IDs in %v", hits)
	}
}
