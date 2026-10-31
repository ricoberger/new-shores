package scenario

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/ricoberger/new-shores/server/internal/content"
	"github.com/ricoberger/new-shores/server/internal/sim"
	"github.com/ricoberger/new-shores/server/internal/sim/archipelago"
)

// displayFixtureOffsetsMs are the sample offsets of the extrapolation
// fixtures; only offsets strictly before next_change_at are kept.
var displayFixtureOffsetsMs = []int64{250, 1000, 5000, 30000, 300000}

// displayFixtureOffsetsOverride keeps the fixtures of large worlds small:
// a full Display of bootstrap_patricians is about 2.6 MB indented, so it
// keeps a single sample.
var displayFixtureOffsetsOverride = map[string][]int64{
	"bootstrap_patricians": {250},
}

// DisplayFixture is the extrapolation fixture shared with the client tests
// (server/testdata/display): the Display payload at the end of a scenario
// and the payloads after advancing it by each sample offset.
type DisplayFixture struct {
	Scenario string           `json:"scenario"`
	Base     sim.DisplayState `json:"base"`
	Samples  []DisplaySample  `json:"samples"`
}

// DisplaySample is the Display payload OffsetMs after the base.
type DisplaySample struct {
	OffsetMs int64            `json:"offset_ms"`
	Display  sim.DisplayState `json:"display"`
}

func displayDir(t testing.TB) string {
	return filepath.Join(repoRoot(t), "server", "testdata", "display")
}

// runToEnd returns the final world of a scenario (the shared replay; the
// caller must not modify it).
func runToEnd(t *testing.T, name string) (*content.Catalogue, *sim.World) {
	t.Helper()
	r := replay(t, name)
	return r.c, r.w
}

func buildDisplayFixture(t *testing.T, name string) DisplayFixture {
	t.Helper()
	c, w := runToEnd(t, name)
	base, err := sim.Display(w, c, w.LastEvaluatedAt)
	if err != nil {
		t.Fatal(err)
	}
	base.Archipelago.GeneratorVersion = archipelago.GeneratorVersion
	limit := int64(-1)
	if base.NextChangeAt != nil {
		next, err := time.Parse(time.RFC3339, *base.NextChangeAt)
		if err != nil {
			t.Fatal(err)
		}
		limit = next.Sub(w.LastEvaluatedAt).Milliseconds()
	}
	fx := DisplayFixture{Scenario: name, Base: base, Samples: []DisplaySample{}}
	offsets := displayFixtureOffsetsMs
	if o, ok := displayFixtureOffsetsOverride[name]; ok {
		offsets = o
	}
	for _, off := range offsets {
		if limit >= 0 && off >= limit {
			continue
		}
		cw := w.Clone()
		at := w.LastEvaluatedAt.Add(time.Duration(off) * time.Millisecond)
		if _, err := sim.Advance(cw, c, at); err != nil {
			t.Fatal(err)
		}
		ds, err := sim.Display(cw, c, at)
		ds.Archipelago.GeneratorVersion = archipelago.GeneratorVersion
		if err != nil {
			t.Fatal(err)
		}
		fx.Samples = append(fx.Samples, DisplaySample{OffsetMs: off, Display: ds})
	}
	return fx
}

// TestDisplayFixtures writes (with -update) or compares byte for byte the
// client extrapolation fixtures server/testdata/display/<scenario>.json.
func TestDisplayFixtures(t *testing.T) {
	files, err := filepath.Glob(filepath.Join(scenarioDir(t), "*.json"))
	if err != nil {
		t.Fatal(err)
	}
	if *update {
		if err := os.MkdirAll(displayDir(t), 0o750); err != nil {
			t.Fatal(err)
		}
	}
	n := 0
	for _, f := range files {
		if strings.HasSuffix(f, ".golden.json") {
			continue
		}
		n++
		name := strings.TrimSuffix(filepath.Base(f), ".json")
		t.Run(name, func(t *testing.T) {
			data, err := json.MarshalIndent(buildDisplayFixture(t, name), "", "  ")
			if err != nil {
				t.Fatal(err)
			}
			got := append(data, '\n')
			path := filepath.Join(displayDir(t), name+".json")
			if *update {
				if err := os.WriteFile(path, got, 0o600); err != nil {
					t.Fatal(err)
				}
				return
			}
			want, err := os.ReadFile(path) // #nosec G304 -- test fixture path.
			if err != nil {
				t.Fatalf("read fixture (run with -update): %v", err)
			}
			if !bytes.Equal(got, want) {
				t.Errorf("fixture differs from %s (run with -update and review the diff)", path)
			}
		})
	}
	if n < 5 {
		t.Fatalf("found %d scenarios, want at least 5", n)
	}
}
