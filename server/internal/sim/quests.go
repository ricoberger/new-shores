package sim

import (
	"fmt"
	"math"
	"slices"

	"github.com/ricoberger/new-shores/server/internal/content"
)

// Quest rules (content quests.json; see the content package for the
// objective vocabulary).
//
//   - A quest is active when all its prerequisites are completed and it is
//     not completed itself. An active quest completes when all its
//     objectives hold; completion is permanent and records the exact
//     millisecond (World.Quests).
//   - Completion is evaluated at every settle of Advance (every boundary and
//     the end of the advancement) and after every successful command, like
//     tier unlocks. A completion can activate a successor that completes at
//     the same instant.
//   - Objectives are a closed set of generic predicates over the world. All
//     of them change only at boundaries or commands, except the stock of a
//     good: the moment an active quest's stock threshold is reached is a
//     stock_threshold boundary computed from the net stock rate, which keeps
//     Advance exactly composable.
//   - ClaimQuest credits the rewards once: gold to the world, goods to the
//     chosen island clamped to its free committed capacity (the excess is
//     lost).

// QuestState is the state of a completed quest.
type QuestState struct {
	// CompletedAtMs is the completion time (Unix ms).
	CompletedAtMs int64 `json:"completed_at_ms"`
	// Claimed is set once the rewards were credited.
	Claimed bool `json:"claimed,omitempty"`
}

// ClaimQuest credits the rewards of a completed quest (once). IslandID is
// the island that receives reward goods; it is required when the quest
// rewards goods and optional (validated when set) otherwise.
type ClaimQuest struct {
	QuestID  string
	IslandID string
}

func (ClaimQuest) isCommand() {}

// QuestCompleted reports whether a quest is completed.
func QuestCompleted(w *World, id string) bool {
	_, ok := w.Quests[id]
	return ok
}

// questActive reports whether a quest is active: not completed and every
// prerequisite completed.
func questActive(w *World, q *content.Quest) bool {
	if QuestCompleted(w, q.ID) {
		return false
	}
	for _, p := range q.Prerequisites {
		if !QuestCompleted(w, p) {
			return false
		}
	}
	return true
}

// questEnv evaluates objectives on a world at time now. Satisfaction needs
// the settled house rates: wr when the world was just settled, otherwise
// (after a command) the rates of a settled clone, computed on demand.
type questEnv struct {
	w   *World
	c   *content.Catalogue
	now int64
	wr  *worldRates
}

func (e *questEnv) rates() *worldRates {
	if e.wr == nil {
		cw := e.w.Clone()
		e.wr, _ = settleWorld(cw, e.c, e.now)
	}
	return e.wr
}

// objectiveValue returns the current value and the target of an objective
// in its natural unit: counts (building_count, island_settled, ship_count;
// 0/1 for connected, route_exists and tier_unlocked), milli-residents
// (population), milli-units (stock) or parts per million (satisfaction).
func (e *questEnv) objectiveValue(o content.Objective) (current, target int64) {
	w, c := e.w, e.c
	islands := w.Islands
	if o.Island != "" {
		islands = nil
		if is := w.Island(o.Island); is != nil {
			islands = []*Island{is}
		}
	}
	switch o.Kind {
	case content.ObjectiveBuildingCount:
		def := c.BuildingByID[o.Building]
		for _, is := range islands {
			if def != nil && def.Road != nil {
				for _, t := range is.Roads {
					if t == o.Building {
						current++
					}
				}
				continue
			}
			for _, b := range is.Buildings {
				if b.Type == o.Building {
					current++
				}
			}
		}
		return current, o.Min
	case content.ObjectiveConnected:
		def := c.BuildingByID[o.Building]
		for _, is := range islands {
			for _, b := range is.Buildings {
				if b.Type == o.Building && def != nil && (def.Collector() || b.AssignedWarehouseID != 0) {
					return 1, 1
				}
			}
		}
		return 0, 1
	case content.ObjectivePopulation:
		return worldPopulation(w, c)[o.Tier], o.Min
	case content.ObjectiveStock:
		for _, is := range islands {
			current += is.Inventory.Stock[o.Good]
		}
		return current, o.Min
	case content.ObjectiveRouteExists:
		for _, s := range w.Ships {
			if s.RouteID != 0 && w.Route(s.RouteID) != nil {
				return 1, 1
			}
		}
		return 0, 1
	case content.ObjectiveIslandSettled:
		for _, is := range w.Islands {
			if settled(is, c) {
				current++
			}
		}
		return current, o.Min
	case content.ObjectiveTierUnlocked:
		if TierUnlocked(w, c, o.Tier) {
			return 1, 1
		}
		return 0, 1
	case content.ObjectiveShipCount:
		if o.Ship == "" {
			return int64(len(w.Ships)), o.Min
		}
		var n int64
		for _, s := range w.Ships {
			if s.Type == o.Ship {
				n++
			}
		}
		return n, o.Min
	case content.ObjectiveSatisfaction:
		// Resident-weighted mean satisfaction of all houses of the tier;
		// without a house of the tier the objective does not hold (-1).
		var weighted, residents int64
		houses := 0
		for _, r := range e.rates().islands {
			for _, h := range r.houses {
				if h.tier.ID != o.Tier {
					continue
				}
				houses++
				// milli-residents x ppm stays far below int64 overflow.
				weighted += h.b.House.Residents * h.satisfaction
				residents += h.b.House.Residents
			}
		}
		if houses == 0 || residents == 0 {
			return -1, o.Min
		}
		return weighted / residents, o.Min
	}
	return 0, math.MaxInt64
}

// ObjectiveTarget returns the target of an objective in the display unit
// (QuestsDisplay): counts, 1 for yes/no predicates, milli-residents,
// milli-units or per-mille.
func ObjectiveTarget(o content.Objective) int64 {
	switch o.Kind {
	case content.ObjectiveConnected, content.ObjectiveRouteExists, content.ObjectiveTierUnlocked:
		return 1
	case content.ObjectiveSatisfaction:
		return o.Min / 1000
	}
	return o.Min
}

// stockObjectiveFine returns the stock of an objective's good (sub-milli,
// on the objective's island or summed) and the islands it covers.
func stockObjectiveFine(w *World, o content.Objective) (int64, []int) {
	var fine int64
	var idx []int
	for i, is := range w.Islands {
		if o.Island != "" && is.ID != o.Island {
			continue
		}
		fine += is.Inventory.fine(o.Good)
		idx = append(idx, i)
	}
	return fine, idx
}

func (e *questEnv) met(o content.Objective) bool {
	if o.Kind == content.ObjectiveStock {
		// Compare in sub-milli units: the threshold is reached exactly at
		// the stock_threshold boundary.
		fine, _ := stockObjectiveFine(e.w, o)
		return fine >= o.Min*SubPerMilli
	}
	cur, target := e.objectiveValue(o)
	return cur >= target
}

// evaluateQuests completes every active quest whose objectives all hold
// at now, repeating while completions activate further quests, and returns
// the completed IDs in content order. wr are the settled rates of w at now
// (nil after a command).
func evaluateQuests(w *World, c *content.Catalogue, now int64, wr *worldRates) []string {
	if len(c.Quests) == 0 {
		return nil
	}
	env := &questEnv{w: w, c: c, now: now, wr: wr}
	var done []string
	for changed := true; changed; {
		changed = false
		for _, q := range c.Quests {
			if !questActive(w, q) {
				continue
			}
			all := true
			for _, o := range q.Objectives {
				if !env.met(o) {
					all = false
					break
				}
			}
			if !all {
				continue
			}
			if w.Quests == nil {
				w.Quests = map[string]QuestState{}
			}
			w.Quests[q.ID] = QuestState{CompletedAtMs: now}
			done = append(done, q.ID)
			changed = true
		}
	}
	return done
}

// questStockBoundary considers, for every stock objective of an active
// quest below its threshold, the time at which the current net stock rate
// reaches the threshold (a stock_threshold boundary).
func questStockBoundary(w *World, c *content.Catalogue, wr *worldRates, now int64, consider func(int64, Boundary)) {
	for _, q := range c.Quests {
		if !questActive(w, q) {
			continue
		}
		for _, o := range q.Objectives {
			if o.Kind != content.ObjectiveStock {
				continue
			}
			fine, idx := stockObjectiveFine(w, o)
			need := o.Min*SubPerMilli - fine
			if need <= 0 {
				continue
			}
			var net int64
			for _, i := range idx {
				r := wr.islands[i]
				net += r.inflow[o.Good] - r.cons[o.Good]
			}
			if net > 0 {
				consider(now+ceilDiv(need, net), Boundary{Kind: BoundaryStockThreshold, IslandID: o.Island, Good: o.Good, Quest: q.ID})
			}
		}
	}
}

// claimQuest credits the rewards of a completed, unclaimed quest.
func claimQuest(w *World, c *content.Catalogue, cmd ClaimQuest, l *Ledger) error {
	q := c.QuestByID[cmd.QuestID]
	if q == nil {
		return fmt.Errorf("%w: %q", ErrQuestNotFound, cmd.QuestID)
	}
	st, ok := w.Quests[q.ID]
	switch {
	case !ok:
		return fmt.Errorf("%w: %q", ErrQuestNotCompleted, q.ID)
	case st.Claimed:
		return fmt.Errorf("%w: %q", ErrQuestAlreadyClaimed, q.ID)
	}
	var is *Island
	if cmd.IslandID != "" {
		var err error
		if is, err = lookupIsland(w, cmd.IslandID); err != nil {
			return err
		}
		if !settled(is, c) {
			return fmt.Errorf("%w: %q", ErrIslandNotSettled, is.ID)
		}
	}
	if len(q.Rewards.Goods) > 0 && is == nil {
		return fmt.Errorf("%w: quest %q rewards goods and needs an island", ErrInvalidCommand, q.ID)
	}
	w.Gold += q.Rewards.Gold
	if len(q.Rewards.Goods) > 0 {
		now := w.LastEvaluatedAt.UnixMilli()
		capFine := capacityFine(is, c)
		for _, g := range q.Rewards.Goods {
			add := g.Amount * SubPerMilli
			credit := min(add, max(capFine-committedFine(is, g.Good, now), 0))
			is.Inventory.setFine(g.Good, is.Inventory.fine(g.Good)+credit)
			f := l.flow(is.ID, g.Good)
			f.Granted += add
			f.Lost += add - credit
		}
		clearRegimes(is)
	}
	st.Claimed = true
	w.Quests[q.ID] = st
	return nil
}

// claimableQuests returns the completed, unclaimed quests in content order.
func claimableQuests(w *World, c *content.Catalogue) []string {
	out := []string{}
	for _, q := range c.Quests {
		if st, ok := w.Quests[q.ID]; ok && !st.Claimed {
			out = append(out, q.ID)
		}
	}
	return out
}

// sortedCompletions returns the completed quests sorted by completion time,
// then content order (unknown IDs last, by ID).
func sortedCompletions(w *World, c *content.Catalogue) []string {
	ids := make([]string, 0, len(w.Quests))
	for id := range w.Quests {
		ids = append(ids, id)
	}
	index := func(id string) int {
		if q := c.QuestByID[id]; q != nil {
			return q.Index
		}
		return math.MaxInt
	}
	slices.SortFunc(ids, func(a, b string) int {
		ta, tb := w.Quests[a].CompletedAtMs, w.Quests[b].CompletedAtMs
		switch {
		case ta != tb:
			if ta < tb {
				return -1
			}
			return 1
		case index(a) != index(b):
			return index(a) - index(b)
		case a < b:
			return -1
		case a > b:
			return 1
		}
		return 0
	})
	return ids
}
