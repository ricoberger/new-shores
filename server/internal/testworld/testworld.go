// Package testworld builds the hand-made archipelago the API, store and
// event tests build on: the --dev archipelago before D-053, frozen so the
// coordinates those tests place at stay valid. The server never uses it;
// its worlds come from the archipelago generator (devworld).
package testworld

import (
	_ "embed"
	"errors"
	"fmt"
	"time"

	"github.com/ricoberger/new-shores/server/internal/content"
	"github.com/ricoberger/new-shores/server/internal/sim"
	"github.com/ricoberger/new-shores/server/internal/sim/scenario"
)

//go:embed archipelago.json
var archipelagoJSON []byte

// Island IDs of the test archipelago.
const (
	StartIsland = "start"
	Island2     = "island2"
)

// Trading Post site of Founded on the start island.
const (
	StartTPX = 2
	StartTPY = 0
)

// Sea is the test archipelago at start: no island settled, the start ship
// at sea with the starting stock.
func Sea(c *content.Catalogue, start time.Time) (*sim.World, error) {
	s, err := scenario.Parse(archipelagoJSON)
	if err != nil {
		return nil, fmt.Errorf("test archipelago: %w", err)
	}
	if len(s.Steps) > 0 {
		return nil, errors.New("test archipelago: the document must not contain steps")
	}
	s.Start = start.UTC().Truncate(time.Millisecond)
	w, err := scenario.BuildWorld(s, c, nil)
	if err != nil {
		return nil, fmt.Errorf("test archipelago: %w", err)
	}
	return w, nil
}

// Founded is the test archipelago evaluated at now (truncated to
// milliseconds) with the start island founded from the start ship over the
// minute before (Trading Post at StartTPX, StartTPY); the sloop is idle
// there and the player was last seen at now.
func Founded(c *content.Catalogue, now time.Time) (*sim.World, error) {
	now = now.UTC().Truncate(time.Millisecond)
	w, err := Sea(c, now.Add(-time.Minute))
	if err != nil {
		return nil, err
	}
	if len(w.Ships) == 0 {
		return nil, errors.New("test archipelago: no start ship")
	}
	s := w.Ships[0]
	if err := sim.Apply(w, c, sim.SailShip{ShipID: s.ID, ToIslandID: StartIsland}); err != nil {
		return nil, err
	}
	if s.Leg == nil || s.Leg.ArriveAtMs > now.UnixMilli() {
		return nil, errors.New("test archipelago: the start ship does not arrive within a minute")
	}
	if _, err := sim.Advance(w, c, time.UnixMilli(s.Leg.ArriveAtMs).UTC()); err != nil {
		return nil, err
	}
	tp := ""
	for _, b := range c.Buildings {
		if b.TradingPost != nil {
			tp = b.ID
			break
		}
	}
	if err := sim.Apply(w, c, sim.FoundIsland{ShipID: s.ID, IslandID: StartIsland, BuildingType: tp, X: StartTPX, Y: StartTPY}); err != nil {
		return nil, err
	}
	if _, err := sim.Advance(w, c, now); err != nil {
		return nil, err
	}
	sim.MarkSeen(w)
	w.PendingSummary = nil
	return w, nil
}
