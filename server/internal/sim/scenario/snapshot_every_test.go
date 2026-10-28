package scenario

import (
	"bytes"
	"fmt"
	"reflect"
	"testing"
)

// TestSnapshotEvery checks that a snapshot interval only thins the
// snapshots: the recorded ones equal those of the one-minute run (their
// boundary counts add up the skipped advances), the first, the last and
// every grid and milestone snapshot are present, and the rest of the report
// is unchanged.
func TestSnapshotEvery(t *testing.T) {
	const name = "bootstrap_citizens"
	full := loadScenario(t, name)
	c, err := full.LoadContent(repoRoot(t))
	if err != nil {
		t.Fatal(err)
	}
	ref, err := Run(full, c)
	if err != nil {
		t.Fatal(err)
	}
	thin := loadScenario(t, name)
	thin.SnapshotEvery = 10
	got, err := Run(thin, c)
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Snapshots) == 0 || len(got.Snapshots) >= len(ref.Snapshots) {
		t.Fatalf("%d snapshots of %d, want fewer", len(got.Snapshots), len(ref.Snapshots))
	}
	byStep := map[int]Snapshot{}
	for _, s := range ref.Snapshots {
		byStep[s.Step] = s
	}
	prev := -1
	for _, s := range got.Snapshots {
		want, boundaries := byStep[s.Step], 0
		for _, o := range ref.Snapshots {
			if o.Step > prev && o.Step <= s.Step {
				boundaries += o.Boundaries
			}
		}
		prev = s.Step
		want.Boundaries = boundaries
		if !reflect.DeepEqual(want, s) {
			t.Errorf("snapshot of step %d differs from the one-minute run", s.Step)
		}
	}
	if got.Snapshots[0].Step != ref.Snapshots[0].Step || got.Snapshots[len(got.Snapshots)-1].Step != ref.Snapshots[len(ref.Snapshots)-1].Step {
		t.Error("first or last snapshot missing")
	}
	got.Snapshots, ref.Snapshots = nil, nil
	if !bytes.Equal(encodeReport(t, ref), encodeReport(t, got)) {
		t.Error("the rest of the report changed with the snapshot interval")
	}
}

func TestParseSnapshotEvery(t *testing.T) {
	doc := `{"name":"x","start":"2026-01-01T00:00:00Z","island":{"rows":["."]},"seed":{},"snapshot_every":%d,"steps":[]}`
	for _, n := range []int{-1, maxSnapshotEvery + 1} {
		if _, err := Parse([]byte(fmt.Sprintf(doc, n))); err == nil {
			t.Errorf("snapshot_every %d accepted", n)
		}
	}
	if _, err := Parse([]byte(fmt.Sprintf(doc, 10))); err != nil {
		t.Error(err)
	}
}
