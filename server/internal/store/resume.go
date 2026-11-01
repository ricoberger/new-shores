package store

import (
	"time"

	"github.com/ricoberger/new-shores/server/internal/sim"
)

// ResumeAt shifts every absolute time of w by now − w.LastEvaluatedAt
// (milliseconds), so that a world loaded from a snapshot continues at now
// as if no time had passed (the dev server's ?resume=now, D-066). The
// player counts as seen at now: LastSeenAt moves to now and the away log
// and a pending away summary are dropped, so that no "while you were away"
// summary follows.
//
// The shifted fields are the world's absolute times: LastEvaluatedAt,
// LastSeenAt, LastTrialMs, the quests' CompletedAtMs, the buildings'
// PausedAtMs, ship orders (OrderedAtMs, DueAtMs) and transit segments
// (FromMs, ToMs), the ships' PausedAtMs, QueuedAtMs, BerthUntilMs and leg
// (DepartAtMs, ArriveAtMs). The scheduled due moments (sim.DueEvents) are
// derived from these, so they move with them. Fields that are 0 because
// they are unset stay 0; durations (TransferDelayMs) do not change.
func ResumeAt(w *sim.World, now time.Time) {
	now = now.UTC().Truncate(time.Millisecond)
	d := now.UnixMilli() - w.LastEvaluatedAt.UnixMilli()
	shift := func(ms *int64) {
		if *ms != 0 {
			*ms += d
		}
	}
	w.LastEvaluatedAt = now
	w.LastSeenAt = now
	shift(&w.LastTrialMs)
	for id, q := range w.Quests {
		shift(&q.CompletedAtMs)
		w.Quests[id] = q
	}
	for _, is := range w.Islands {
		for _, b := range is.Buildings {
			shift(&b.PausedAtMs)
			if b.Order != nil {
				shift(&b.Order.OrderedAtMs)
				shift(&b.Order.DueAtMs)
			}
			for i := range b.Transit {
				b.Transit[i].FromMs += d
				b.Transit[i].ToMs += d
			}
		}
	}
	for _, s := range w.Ships {
		shift(&s.PausedAtMs)
		shift(&s.QueuedAtMs)
		shift(&s.BerthUntilMs)
		if s.Leg != nil {
			s.Leg.DepartAtMs += d
			s.Leg.ArriveAtMs += d
		}
	}
	w.Away = sim.AwayLog{}
	w.PendingSummary = nil
}
