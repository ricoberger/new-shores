package sim

import (
	"maps"
	"slices"
	"time"

	"github.com/ricoberger/new-shores/server/internal/content"
)

// "While you were away" (GAME_DESIGN "Offline behaviour", UI.md §2).
//
//   - World.LastSeenAt is the world time of the player's last successful
//     command (initially the world's creation). The caller sets it with
//     MarkSeen after every successful player command; reads, failed
//     commands and scheduled events never set it.
//   - Every Advance, whoever triggers it, accumulates the data of the
//     summary in World.Away: goods flows per island, the gold and
//     population change, auto-pause/resume and ship arrival counts. MarkSeen
//     resets the accumulator, so it always covers [LastSeenAt,
//     LastEvaluatedAt].
//   - MaybeProduceSummary stores a summary over [LastSeenAt, now] as the
//     single pending summary when the gap is at least away_summary_minutes
//     and no summary is pending or the pending one ended at least that long
//     ago (the new one replaces it: its interval is a superset).
//     AckSummary clears the pending summary with a matching ID.
//   - The summary is a pure function of the accumulator and the world, so
//     identical inputs give byte-identical summaries.

// maxSummaryArrivals bounds the ship arrivals listed in a summary (the
// count stays exact) so that a long absence with busy routes cannot grow
// the world envelope without limit.
const maxSummaryArrivals = 50

// AwayLog accumulates the data of the next "while you were away" summary
// since World.LastSeenAt. Every field is additive, so splitting an
// advancement does not change it.
type AwayLog struct {
	// GoldDeltaSub is the gold change in gold sub-units (signed).
	GoldDeltaSub int64 `json:"gold_delta_sub,omitempty"`
	// PopulationDelta is the residents change per tier (milli-residents,
	// signed).
	PopulationDelta map[string]Qty `json:"population_delta,omitempty"`
	// Flows per island and good.
	Flows map[string]map[string]AwayFlow `json:"flows,omitempty"`
	// AutoPaused and AutoResumed count the auto_pause and auto_resume
	// events of buildings and ships.
	AutoPaused  int `json:"auto_paused,omitempty"`
	AutoResumed int `json:"auto_resumed,omitempty"`
	// ShipsArrived counts the ship arrivals; Arrivals lists the first
	// maxSummaryArrivals of them.
	ShipsArrived int           `json:"ships_arrived,omitempty"`
	Arrivals     []AwayArrival `json:"arrivals,omitempty"`
}

// AwayFlow is the produced, consumed and lost amount of one good on one
// island in milli-units plus a sub-milli remainder in [0, SubPerMilli).
type AwayFlow struct {
	Produced    Qty   `json:"produced,omitempty"`
	ProducedSub int64 `json:"produced_sub,omitempty"`
	Consumed    Qty   `json:"consumed,omitempty"`
	ConsumedSub int64 `json:"consumed_sub,omitempty"`
	Lost        Qty   `json:"lost,omitempty"`
	LostSub     int64 `json:"lost_sub,omitempty"`
}

// AwayArrival is a ship arrival (Unix ms).
type AwayArrival struct {
	ShipID   int64  `json:"ship_id"`
	IslandID string `json:"island_id"`
	AtMs     int64  `json:"at_ms"`
}

func (l *AwayLog) clone() AwayLog {
	c := *l
	c.PopulationDelta = maps.Clone(l.PopulationDelta)
	if l.Flows != nil {
		c.Flows = make(map[string]map[string]AwayFlow, len(l.Flows))
		for k, v := range l.Flows {
			c.Flows[k] = maps.Clone(v)
		}
	}
	if l.Arrivals != nil {
		c.Arrivals = slices.Clone(l.Arrivals)
	}
	return c
}

// addFine adds f sub-milli units to a milli-units/remainder pair.
func addFine(m *Qty, s *int64, f int64) {
	*m += f / SubPerMilli
	*s += f % SubPerMilli
	if *s >= SubPerMilli {
		*m++
		*s -= SubPerMilli
	} else if *s < 0 {
		*m--
		*s += SubPerMilli
	}
}

// roundPair rounds a milli-units/remainder pair half up to milli-units.
func roundPair(m Qty, s int64) Qty {
	if s*2 >= SubPerMilli {
		return m + 1
	}
	return m
}

// addLedger adds the produced, consumed and lost flows of l.
func (a *AwayLog) addLedger(l *Ledger) {
	for island, goods := range l.Islands {
		for good, f := range goods {
			if f.Produced == 0 && f.Consumed == 0 && f.Lost == 0 {
				continue
			}
			if a.Flows == nil {
				a.Flows = map[string]map[string]AwayFlow{}
			}
			if a.Flows[island] == nil {
				a.Flows[island] = map[string]AwayFlow{}
			}
			af := a.Flows[island][good]
			addFine(&af.Produced, &af.ProducedSub, f.Produced)
			addFine(&af.Consumed, &af.ConsumedSub, f.Consumed)
			addFine(&af.Lost, &af.LostSub, f.Lost)
			a.Flows[island][good] = af
		}
	}
}

func (a *AwayLog) addPopulation(delta map[string]Qty) {
	for tier, d := range delta {
		if d == 0 {
			continue
		}
		if a.PopulationDelta == nil {
			a.PopulationDelta = map[string]Qty{}
		}
		a.PopulationDelta[tier] += d
		if a.PopulationDelta[tier] == 0 {
			delete(a.PopulationDelta, tier)
		}
	}
	if len(a.PopulationDelta) == 0 {
		a.PopulationDelta = nil
	}
}

func (a *AwayLog) addArrival(s *Ship, island string, now int64) {
	a.ShipsArrived++
	if len(a.Arrivals) < maxSummaryArrivals {
		a.Arrivals = append(a.Arrivals, AwayArrival{ShipID: s.ID, IslandID: island, AtMs: now})
	}
}

// AckSummary acknowledges the pending summary with the given ID (a no-op
// for any other ID). It always succeeds.
type AckSummary struct {
	SummaryID int64
}

func (AckSummary) isCommand() {}

func ackSummary(w *World, cmd AckSummary) {
	if w.PendingSummary != nil && w.PendingSummary.ID == cmd.SummaryID {
		w.PendingSummary = nil
	}
}

// MarkSeen records a successful player command at the world's evaluation
// time: LastSeenAt moves there and the summary accumulator starts over.
func MarkSeen(w *World) {
	w.LastSeenAt = w.LastEvaluatedAt
	w.Away = AwayLog{}
}

// AwaySummary is a "while you were away" summary over [From, To]. Goods
// are milli-units, gold milli-gold, residents milli-residents.
type AwaySummary struct {
	// ID identifies the summary: To in Unix milliseconds.
	ID   int64  `json:"id"`
	From string `json:"from"`
	To   string `json:"to"`
	// GoldBefore and GoldAfter in milli-gold.
	GoldBefore Qty `json:"gold_before"`
	GoldAfter  Qty `json:"gold_after"`
	// Population per tier with residents before or after (archipelago).
	Population map[string]AwayPopulation `json:"population"`
	// Islands in world order.
	Islands []AwayIsland `json:"islands"`
	// AutoPaused and AutoResumed count the insolvency pauses and resumes
	// during the interval; StillUnpaid lists what is paused for insolvency
	// at To.
	AutoPaused   int          `json:"auto_paused"`
	AutoResumed  int          `json:"auto_resumed"`
	StillUnpaid  []AwayUnpaid `json:"still_unpaid"`
	ShipsArrived int          `json:"ships_arrived"`
	// Arrivals lists the first arrivals (at most 50; ShipsArrived is exact).
	Arrivals []AwayArrivalDisplay `json:"arrivals"`
	// QuestsCompleted during the interval, by completion time.
	QuestsCompleted []AwayQuest `json:"quests_completed"`
}

// AwayPopulation is the residents of a tier before and after.
type AwayPopulation struct {
	Before Qty `json:"before"`
	After  Qty `json:"after"`
}

// AwayIsland lists the goods of an island with any flow or stock.
type AwayIsland struct {
	ID    string              `json:"id"`
	Goods map[string]AwayGood `json:"goods"`
}

// AwayGood is the summary of one good on one island.
type AwayGood struct {
	Produced   Qty  `json:"produced"`
	Consumed   Qty  `json:"consumed"`
	Lost       Qty  `json:"lost"`
	StockAfter Qty  `json:"stock_after"`
	Capacity   Qty  `json:"capacity"`
	AtCapacity bool `json:"at_capacity"`
}

// AwayUnpaid is a building (BuildingID set) or ship (ShipID set) paused for
// insolvency at the end of the interval.
type AwayUnpaid struct {
	IslandID   string `json:"island_id"`
	BuildingID int64  `json:"building_id,omitempty"`
	ShipID     int64  `json:"ship_id,omitempty"`
	Type       string `json:"type"`
}

// AwayArrivalDisplay is a ship arrival (RFC 3339 with ms).
type AwayArrivalDisplay struct {
	ShipID   int64  `json:"ship_id"`
	IslandID string `json:"island_id"`
	At       string `json:"at"`
}

// AwayQuest is a quest completed during the interval.
type AwayQuest struct {
	ID          string `json:"id"`
	CompletedAt string `json:"completed_at"`
}

// ProduceSummary returns the summary over [LastSeenAt, LastEvaluatedAt]
// from the accumulator and the world. It does not change w.
func ProduceSummary(w *World, c *content.Catalogue) *AwaySummary {
	from, to := w.LastSeenAt.UnixMilli(), w.LastEvaluatedAt.UnixMilli()
	a := &w.Away
	s := &AwaySummary{
		ID: to, From: formatMs(from), To: formatMs(to),
		GoldAfter:  w.Gold,
		Population: map[string]AwayPopulation{}, Islands: []AwayIsland{},
		AutoPaused: a.AutoPaused, AutoResumed: a.AutoResumed, StillUnpaid: []AwayUnpaid{},
		ShipsArrived: a.ShipsArrived, Arrivals: []AwayArrivalDisplay{}, QuestsCompleted: []AwayQuest{},
	}
	before := w.goldFine() - a.GoldDeltaSub
	s.GoldBefore = max(before, 0) / GoldSubPerMilli
	pop := worldPopulation(w, c)
	for _, tier := range sortedKeys(pop, a.PopulationDelta) {
		p := AwayPopulation{Before: pop[tier] - a.PopulationDelta[tier], After: pop[tier]}
		if p.Before != 0 || p.After != 0 {
			s.Population[tier] = p
		}
	}
	for _, is := range w.Islands {
		ai := AwayIsland{ID: is.ID, Goods: map[string]AwayGood{}}
		capMilli := capacityMilli(is, c)
		flows := a.Flows[is.ID]
		goods := sortedKeys(flows)
		for _, good := range sortedKeys(is.Inventory.Stock) {
			if _, ok := flows[good]; !ok {
				goods = append(goods, good)
			}
		}
		slices.Sort(goods)
		for _, good := range goods {
			f := flows[good]
			g := AwayGood{
				Produced: roundPair(f.Produced, f.ProducedSub), Consumed: roundPair(f.Consumed, f.ConsumedSub),
				Lost: roundPair(f.Lost, f.LostSub), StockAfter: roundFine(is.Inventory.fine(good)), Capacity: capMilli,
			}
			g.AtCapacity = capMilli > 0 && (is.Inventory.Full[good] || committedFine(is, good, to) >= capacityFine(is, c))
			if g.Produced == 0 && g.Consumed == 0 && g.Lost == 0 && g.StockAfter == 0 {
				continue
			}
			ai.Goods[good] = g
		}
		s.Islands = append(s.Islands, ai)
		for _, b := range is.Buildings {
			if b.Paused && b.PausedReason == PausedReasonUnpaid {
				s.StillUnpaid = append(s.StillUnpaid, AwayUnpaid{IslandID: is.ID, BuildingID: b.ID, Type: b.Type})
			}
		}
	}
	for _, sh := range w.Ships {
		if sh.Paused && sh.PausedReason == PausedReasonUnpaid {
			s.StillUnpaid = append(s.StillUnpaid, AwayUnpaid{IslandID: sh.IslandID, ShipID: sh.ID, Type: sh.Type})
		}
	}
	for _, e := range a.Arrivals {
		s.Arrivals = append(s.Arrivals, AwayArrivalDisplay{ShipID: e.ShipID, IslandID: e.IslandID, At: formatMs(e.AtMs)})
	}
	for _, id := range sortedCompletions(w, c) {
		if at := w.Quests[id].CompletedAtMs; at > from && at <= to {
			s.QuestsCompleted = append(s.QuestsCompleted, AwayQuest{ID: id, CompletedAt: formatMs(at)})
		}
	}
	return s
}

// MaybeProduceSummary applies the production rule at the world's
// evaluation time: when at least away_summary_minutes passed since
// LastSeenAt and no summary is pending, or the pending one ended at least
// that long ago, it stores a summary over [LastSeenAt, now] as the pending
// summary and returns true.
func MaybeProduceSummary(w *World, c *content.Catalogue) bool {
	gap := c.Region.Rules.AwaySummaryMs
	now := w.LastEvaluatedAt
	if gap <= 0 || now.Sub(w.LastSeenAt) < time.Duration(gap)*time.Millisecond {
		return false
	}
	if p := w.PendingSummary; p != nil && now.UnixMilli()-p.ID < gap {
		return false
	}
	w.PendingSummary = ProduceSummary(w, c)
	return true
}

func (s *AwaySummary) clone() *AwaySummary {
	if s == nil {
		return nil
	}
	c := *s
	c.Population = maps.Clone(s.Population)
	c.Islands = make([]AwayIsland, len(s.Islands))
	for i, is := range s.Islands {
		c.Islands[i] = AwayIsland{ID: is.ID, Goods: maps.Clone(is.Goods)}
	}
	c.StillUnpaid = slices.Clone(s.StillUnpaid)
	c.Arrivals = slices.Clone(s.Arrivals)
	c.QuestsCompleted = slices.Clone(s.QuestsCompleted)
	return &c
}
