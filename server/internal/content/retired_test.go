package content

import (
	"bytes"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// retiredShips matches the ship IDs and names D-075 §4 retired (sloop,
// brig, galleon → cog, hulk, carrack), never "bright".
var retiredShips = regexp.MustCompile(`(?i)sloop|galleon|brig([^h]|$)`)

// retiredAllowed are the files that may still name the retired ships: the
// decision log and the status page (history, edited by the owner) and
// this gate.
var retiredAllowed = map[string]bool{
	"docs/DECISIONS.md":                       true,
	"docs/STATUS.md":                          true,
	"server/internal/content/retired_test.go": true,
}

// TestRetiredShipIDsGone (D-075 §4): the retired ship IDs appear in no
// tracked text file or file name outside the decision log and the status
// page — content, fixtures, plans, goldens, client, assets and docs use
// cog, hulk and carrack. Binary files (GLBs, PNGs) are checked by name.
func TestRetiredShipIDsGone(t *testing.T) {
	root := repoRoot(t)
	cmd := exec.CommandContext(t.Context(), "git", "ls-files", "-z")
	cmd.Dir = root
	out, err := cmd.Output()
	if err != nil {
		t.Skipf("git ls-files: %v", err)
	}
	for _, f := range strings.Split(strings.TrimRight(string(out), "\x00"), "\x00") {
		if f == "" || retiredAllowed[f] {
			continue
		}
		if retiredShips.MatchString(filepath.Base(f)) {
			t.Errorf("%s: file name names a retired ship", f)
		}
		data, err := os.ReadFile(filepath.Join(root, f)) // #nosec G304 -- tracked repository files.
		if err != nil {
			continue // deleted in the working tree
		}
		if bytes.IndexByte(data, 0) >= 0 {
			continue // binary
		}
		for i, line := range strings.Split(string(data), "\n") {
			if retiredShips.MatchString(line) {
				t.Errorf("%s:%d names a retired ship: %s", f, i+1, strings.TrimSpace(line))
			}
		}
	}
}
