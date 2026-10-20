// Package devworld builds new worlds from an embedded scenario document:
// the single in-memory world of the --dev server (NewDev) and the world of
// every new player in default mode (New). It reuses the scenario runner's
// island parser and seeding (scenario.Parse and scenario.BuildWorld); the
// document is a two-island archipelago (the start island with its seed and
// the unsettled island 2) and has no steps.
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

// IslandJSON returns the embedded scenario document of the archipelago.
func IslandJSON() []byte { return append([]byte(nil), islandJSON...) }

// New builds a new player world evaluated at start (truncated to
// milliseconds): the archipelago with the content starting stock only
// (start.json).
func New(c *content.Catalogue, start time.Time) (*sim.World, error) {
	return build(c, start, false)
}

// NewDev builds the --dev server's world: like New plus the document's
// dev-only bonus of gold and goods, which lets a developer play the first
// settlement flow without the M4 balancing pass.
func NewDev(c *content.Catalogue, start time.Time) (*sim.World, error) {
	return build(c, start, true)
}

func build(c *content.Catalogue, start time.Time, dev bool) (*sim.World, error) {
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
	if dev {
		if err := scenario.ApplyBonus(s, c, w, nil); err != nil {
			return nil, fmt.Errorf("dev island: %w", err)
		}
	}
	return w, nil
}
