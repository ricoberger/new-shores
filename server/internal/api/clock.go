package api

import "time"

// Clock reads the wall clock. Handlers never read the system clock
// directly; tests inject a fake clock.
type Clock interface {
	Now() time.Time
}

// WallClock is the system clock. It is the only place outside the
// simulation that reads the current time.
type WallClock struct{}

// Now returns the current wall-clock time in UTC.
func (WallClock) Now() time.Time { return time.Now().UTC() }

// TimeScale maps wall-clock time to world time for the dev server:
// world = Start + (wall - Start) * Scale, truncated to milliseconds.
type TimeScale struct {
	Start time.Time
	Scale float64
}

// At returns the world time for a wall-clock time.
func (s TimeScale) At(wall time.Time) time.Time {
	d := time.Duration(float64(wall.Sub(s.Start)) * s.Scale)
	return s.Start.Add(d).UTC().Truncate(time.Millisecond)
}

// WallAt returns the wall-clock time at which the world reaches the world
// time t (the inverse of At, up to rounding).
func (s TimeScale) WallAt(t time.Time) time.Time {
	return s.Start.Add(time.Duration(float64(t.Sub(s.Start)) / s.Scale))
}
