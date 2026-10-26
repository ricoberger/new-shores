// Package devworld builds new worlds on the seeded archipelago (D-053):
// the single in-memory world of the --dev server and the world of every
// new player in default mode (New), plus the dev fixtures (NewFixture).
// A new world has no island settled and the start ship at sea at the
// archipelago's centre carrying the starting stock (D-051).
package devworld

import (
	"crypto/rand"
	"encoding/binary"
	"time"

	"github.com/ricoberger/new-shores/server/internal/content"
	"github.com/ricoberger/new-shores/server/internal/sim"
	"github.com/ricoberger/new-shores/server/internal/sim/archipelago"
)

// DevSeed is the archipelago seed of the --dev server (flag --seed) and of
// the dev fixtures by default: since the D-054 island sizes the first seed
// from 1 053 001 on whose home island the start ship reaches, and from
// which a sloop reaches the nearest neighbour, in 1-5 minutes (R-18;
// 1 053 001 itself needs 6 minutes from the spawn).
const DevSeed uint64 = 1_053_003

// New builds a new player world on the archipelago of seed, evaluated at
// start (truncated to milliseconds): no island settled and the start ship
// at sea carrying the content starting stock (start.json; the gold on the
// balance).
func New(c *content.Catalogue, seed uint64, start time.Time) (*sim.World, error) {
	return archipelago.NewWorld(c, seed, start.UTC().Truncate(time.Millisecond))
}

// RandomSeed returns a random archipelago seed in 1..archipelago.MaxSeed
// for a new player world.
func RandomSeed() uint64 {
	var b [8]byte
	for {
		_, _ = rand.Read(b[:]) // crypto/rand.Read never fails (Go 1.24+)
		if s := binary.LittleEndian.Uint64(b[:]) & archipelago.MaxSeed; s != 0 {
			return s
		}
	}
}
