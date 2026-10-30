package devworld

import (
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"testing/fstest"
	"time"
)

func scenarioDir(t *testing.T) string {
	t.Helper()
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller failed")
	}
	return filepath.Join(filepath.Dir(file), "..", "..", "testdata", "scenarios")
}

// TestPlayedFixture: the played fixture replays the Patricians reference
// game so that it ends at now, with the player last seen there; the
// replay is cached, and a later reset continues the cached world to its
// own now.
func TestPlayedFixture(t *testing.T) {
	if testing.Short() {
		t.Skip("replays the Patricians reference game")
	}
	c := catalogue(t)
	opts := Options{Scenarios: os.DirFS(scenarioDir(t))}
	now := start.Add(48 * time.Hour).Truncate(time.Millisecond)
	w, err := NewFixtureWith(c, FixturePlayed, DevSeed, now, opts)
	if err != nil {
		t.Fatal(err)
	}
	if !w.LastEvaluatedAt.Equal(now) || !w.LastSeenAt.Equal(now) || w.PendingSummary != nil {
		t.Fatalf("evaluated %s, last seen %s, summary %v; want %s and none", w.LastEvaluatedAt, w.LastSeenAt, w.PendingSummary, now)
	}
	houses := func() int {
		n := 0
		for _, is := range w.Islands {
			for _, b := range is.Buildings {
				if b.Type == "house_patricians" {
					n++
				}
			}
		}
		return n
	}
	if n := houses(); n == 0 {
		t.Fatal("no Patrician house")
	}
	n := houses()

	playedCacheAfter = 0 // a fast machine still caches
	defer func() { playedCacheAfter = 10 * time.Second }()
	if playedCache.w == nil {
		if _, err := NewFixtureWith(c, FixturePlayed, DevSeed, now, opts); err != nil {
			t.Fatal(err)
		}
	}
	later := now.Add(10 * time.Minute)
	began := time.Now()
	w, err = NewFixtureWith(c, FixturePlayed, DevSeed, later, opts)
	if err != nil {
		t.Fatal(err)
	}
	if d := time.Since(began); d > 10*time.Second {
		t.Errorf("cached reset took %s", d)
	}
	if !w.LastEvaluatedAt.Equal(later) || !w.LastSeenAt.Equal(later) || houses() != n {
		t.Errorf("cached: evaluated %s, last seen %s, %d Patrician houses; want %s and %d", w.LastEvaluatedAt, w.LastSeenAt, houses(), later, n)
	}
}

// TestPlayedFixtureUnavailable: played needs the scenario directory and
// the scenario's seed.
func TestPlayedFixtureUnavailable(t *testing.T) {
	c := catalogue(t)
	if _, err := NewFixture(c, FixturePlayed, DevSeed, start); !errors.Is(err, ErrFixtureSeed) {
		t.Errorf("without scenarios: %v, want ErrFixtureSeed", err)
	}
	fsys := fstest.MapFS{PlayedScenario: {Data: []byte(`{"name": "p", "start": "2026-01-01T00:00:00Z", "seed": {"archipelago": 7, "start": true}, "steps": [{"advance": {"duration": "1m"}}]}`)}}
	if _, err := NewFixtureWith(c, FixturePlayed, DevSeed, start, Options{Scenarios: fsys}); !errors.Is(err, ErrFixtureSeed) {
		t.Errorf("other seed: %v, want ErrFixtureSeed", err)
	}
	w, err := NewFixtureWith(c, FixturePlayed, 7, start, Options{Scenarios: fsys})
	if err != nil {
		t.Fatal(err)
	}
	if want := start.Truncate(time.Millisecond); !w.LastEvaluatedAt.Equal(want) || w.Seed != 7 {
		t.Errorf("evaluated %s seed %d, want %s and 7", w.LastEvaluatedAt, w.Seed, want)
	}
}
