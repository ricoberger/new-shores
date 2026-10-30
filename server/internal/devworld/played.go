package devworld

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io/fs"
	"sync"
	"time"

	"github.com/ricoberger/new-shores/server/internal/content"
	"github.com/ricoberger/new-shores/server/internal/sim"
	"github.com/ricoberger/new-shores/server/internal/sim/scenario"
)

// FixturePlayed is the Patricians reference game (PlayedScenario) replayed
// to its end, which lies at now: a town grown by play rather than by a
// fixture layout (shots of a lived-in island). It needs the scenario's
// archipelago seed (DevSeed; another seed is ErrFixtureSeed) and the
// scenario directory (Options.Scenarios; without it ErrFixtureSeed too).
const FixturePlayed = "played"

// PlayedScenario is the scenario file the played fixture replays.
const PlayedScenario = "bootstrap_patricians.json"

// Options are the optional inputs of NewFixtureWith.
type Options struct {
	// Scenarios is the scenario directory (server/testdata/scenarios) of
	// the played fixture; nil: played is unavailable.
	Scenarios fs.FS
}

// playedCacheAfter is the replay time above which the played world is
// cached for the process: the replay of the reference game takes about
// 40 s, too long for every reset of a shot session.
var playedCacheAfter = 10 * time.Second

// playedCache holds the last played world of the process (by content
// version, scenario bytes and seed) at its end; a later reset clones it
// and advances the clone to its now (the world continues; the scenario is
// not replayed again).
var playedCache struct {
	sync.Mutex
	key string
	w   *sim.World
}

// played builds FixturePlayed at now.
func played(c *content.Catalogue, seed uint64, now time.Time, opts Options) (*sim.World, error) {
	if opts.Scenarios == nil {
		return nil, fmt.Errorf("%w: %s needs the scenario directory", ErrFixtureSeed, FixturePlayed)
	}
	data, err := fs.ReadFile(opts.Scenarios, PlayedScenario)
	if err != nil {
		return nil, fmt.Errorf("%w: %s: %v", ErrFixtureSeed, FixturePlayed, err)
	}
	s, err := scenario.Parse(data)
	if err != nil {
		return nil, fmt.Errorf("dev fixture %s: %w", FixturePlayed, err)
	}
	if s.Seed.Archipelago != seed {
		return nil, fmt.Errorf("%w: %s replays seed %d", ErrFixtureSeed, FixturePlayed, s.Seed.Archipelago)
	}
	sum := sha256.Sum256(data)
	key := fmt.Sprintf("%s/%s/%d", c.Region.Version, hex.EncodeToString(sum[:]), seed)

	playedCache.Lock()
	defer playedCache.Unlock()
	if playedCache.key == key && !playedCache.w.LastEvaluatedAt.After(now) {
		w := playedCache.w.Clone()
		if _, err := sim.Advance(w, c, now); err != nil {
			return nil, fmt.Errorf("dev fixture %s: %w", FixturePlayed, err)
		}
		sim.MarkSeen(w)
		w.PendingSummary = nil
		return w, nil
	}

	// The scenario starts so long before now that its last step ends at
	// now: its duration is the sum of its advances.
	var d time.Duration
	for i, st := range s.Steps {
		if st.Advance != nil {
			step, err := time.ParseDuration(st.Advance.Duration)
			if err != nil {
				return nil, fmt.Errorf("dev fixture %s: step %d: %w", FixturePlayed, i, err)
			}
			d += step
		}
	}
	s.Start = now.Add(-d)
	start := time.Now()
	w, err := scenario.RunSteps(s, c, len(s.Steps))
	if err != nil {
		return nil, fmt.Errorf("dev fixture %s: %w", FixturePlayed, err)
	}
	if w.LastEvaluatedAt.After(now) {
		return nil, errors.New("dev fixture played: the replay ends after now")
	}
	if _, err := sim.Advance(w, c, now); err != nil {
		return nil, fmt.Errorf("dev fixture %s: %w", FixturePlayed, err)
	}
	sim.MarkSeen(w)
	w.PendingSummary = nil
	if time.Since(start) > playedCacheAfter {
		playedCache.key, playedCache.w = key, w.Clone()
	}
	return w, nil
}
