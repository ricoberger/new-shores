package plan

import (
	"bytes"
	"flag"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

var update = flag.Bool("update", false, "rewrite the scenarios the plans generate")

// root is the repository root (the plans name their content relative to it).
const root = "../../../../.."

// TestPlansRegenerate generates every plan in server/testdata/plans and
// compares the scenario byte for byte with the committed one (D-067);
// -update rewrites them.
func TestPlansRegenerate(t *testing.T) {
	if testing.Short() {
		t.Skip("generates the reference games (minutes)")
	}
	plans, err := filepath.Glob(filepath.Join(root, "server/testdata/plans/*.plan.json"))
	if err != nil {
		t.Fatal(err)
	}
	if len(plans) == 0 {
		t.Fatal("no plans")
	}
	for _, path := range plans {
		name := strings.TrimSuffix(filepath.Base(path), ".plan.json")
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			s, err := Generate(path, root, nil)
			if err != nil {
				t.Fatal(err)
			}
			data, err := Marshal(s)
			if err != nil {
				t.Fatal(err)
			}
			out := filepath.Join(root, "server/testdata/scenarios", name+".json")
			if *update {
				if err := os.WriteFile(out, data, 0o600); err != nil {
					t.Fatal(err)
				}
				return
			}
			have, err := os.ReadFile(out) // #nosec G304 -- test fixture path.
			if err != nil {
				t.Fatal(err)
			}
			if !bytes.Equal(have, data) {
				t.Errorf("%s differs from the output of %s; run go test ./internal/sim/scenario/plan -run TestPlansRegenerate -update (or cmd/replay-plan)", out, path)
			}
		})
	}
}

func TestLoadValidatesChains(t *testing.T) {
	cases := map[string]string{
		"serves an unranked tier": `{"name":"x","quarters":[{"id":"q","island":"i","civic":["market"],"houses":1,"serves":{"citizens":1}}]}`,
		"rank beyond the chain":   `{"name":"x","chains":{"buildings":{"faith":["chapel"]},"min_rank":{"citizens":{"faith":2}}}}`,
	}
	for name, src := range cases {
		t.Run(name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "p.plan.json")
			if err := os.WriteFile(path, []byte(src), 0o600); err != nil {
				t.Fatal(err)
			}
			if _, err := Load(path); err == nil {
				t.Fatal("Load accepted the plan")
			}
		})
	}
	ok := `{"name":"x","chains":{"buildings":{"faith":["chapel","church"]},"min_rank":{"citizens":{"faith":2}}},"quarters":[{"id":"q","island":"i","civic":["market"],"houses":1,"serves":{"citizens":1}}]}`
	path := filepath.Join(t.TempDir(), "p.plan.json")
	if err := os.WriteFile(path, []byte(ok), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := Load(path); err != nil {
		t.Fatal(err)
	}
}
