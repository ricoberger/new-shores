// Package devworld builds the single in-memory world of the --dev server
// (docs/FIRST_PLAYABLE.md, M1b) from an embedded scenario document. It reuses
// the scenario runner's island parser and seeding (scenario.Parse and
// scenario.BuildWorld); the document has an island and a seed but no steps.
package devworld

import (
	_ "embed"
	"errors"
	"fmt"
	"time"

	"github.com/ricoberger/new-shores/server/internal/content"
	"github.com/ricoberger/new-shores/server/internal/sim"
	"github.com/ricoberger/new-shores/server/internal/sim/scenario"
)

//go:embed island.json
var islandJSON []byte

// IslandJSON returns the embedded scenario document of the dev island.
func IslandJSON() []byte { return append([]byte(nil), islandJSON...) }

// New builds the dev world evaluated at start (truncated to milliseconds).
func New(c *content.Catalogue, start time.Time) (*sim.World, error) {
	s, err := scenario.Parse(islandJSON)
	if err != nil {
		return nil, fmt.Errorf("dev island: %w", err)
	}
	if len(s.Steps) > 0 {
		return nil, errors.New("dev island: the document must not contain steps")
	}
	s.Start = start.UTC().Truncate(time.Millisecond)
	w, err := scenario.BuildWorld(s, c, nil)
	if err != nil {
		return nil, fmt.Errorf("dev island: %w", err)
	}
	return w, nil
}
