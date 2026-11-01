package scenario

import (
	"testing"
	"time"

	"github.com/ricoberger/new-shores/server/internal/sim"
)

// BenchmarkAdvanceBootstrapPatricians measures sim.Advance (one world
// minute per op, which re-derives every rate) in a late bootstrap_patricians
// world: the hot path of the long reference-game tests (house need
// evaluation). The setup replays 3/4 of the scenario once (not timed).
func BenchmarkAdvanceBootstrapPatricians(b *testing.B) {
	s := loadScenario(b, "bootstrap_patricians")
	c, err := s.LoadContent(repoRoot(b))
	if err != nil {
		b.Fatal(err)
	}
	w, err := RunSteps(s, c, len(s.Steps)*3/4)
	if err != nil {
		b.Fatal(err)
	}
	b.ResetTimer()
	for b.Loop() {
		if _, err := sim.Advance(w, c, w.LastEvaluatedAt.Add(time.Minute)); err != nil {
			b.Fatal(err)
		}
	}
}
