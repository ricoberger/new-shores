package scenario

import (
	"fmt"
	"slices"
	"time"

	"github.com/ricoberger/new-shores/server/internal/content"
	"github.com/ricoberger/new-shores/server/internal/sim"
)

const timeLayout = "2006-01-02T15:04:05.000Z07:00"

// Report is the deterministic result of a scenario run (except
// AdvanceDurationMs, which is wall time and omitted when zero).
type Report struct {
	Name           string `json:"name"`
	ContentVersion string `json:"content_version"`
	// BoundaryCount is the number of boundaries crossed by all advances.
	BoundaryCount int `json:"boundary_count"`
	// AdvanceDurationMs is the measured wall time of the Advance calls only.
	// Tests that compare reports clear it with ClearTiming.
	AdvanceDurationMs float64 `json:"advance_duration_ms,omitempty"`
	// Totals per island and good, in milli-units.
	Totals map[string]map[string]Totals `json:"totals"`
	// Bottlenecks lists every building whose status is not ok.
	Bottlenecks []Bottleneck `json:"bottlenecks"`
	// PauseEvents lists the insolvency pauses and resumes in occurrence
	// order.
	PauseEvents []PauseEvent `json:"pause_events"`
	// ExpectedErrors lists the steps that failed as expected (expect_error)
	// with the sentinel name and the error message; omitted when none.
	ExpectedErrors []ExpectedError `json:"expected_errors,omitempty"`
	// Snapshots after every advance step.
	Snapshots []Snapshot `json:"snapshots"`
	// Quests lists every completed quest by completion time with the time
	// its rewards were claimed (empty if not claimed); omitted when none.
	Quests []QuestRecord `json:"quests,omitempty"`
	// AwaySummaries are the summaries produced by away_summary steps.
	AwaySummaries []sim.AwaySummary `json:"away_summaries,omitempty"`
	// Final is the Display payload at the end of the run.
	Final sim.DisplayState `json:"final"`

	advanceDuration time.Duration
	ledger          *sim.Ledger
	claims          map[string]string
}

// QuestRecord is a completed quest of a run (RFC 3339 with ms).
type QuestRecord struct {
	ID          string `json:"id"`
	CompletedAt string `json:"completed_at"`
	ClaimedAt   string `json:"claimed_at,omitempty"`
}

func (r *Report) claimedAt(id string, at time.Time) {
	if r.claims == nil {
		r.claims = map[string]string{}
	}
	r.claims[id] = at.Format(timeLayout)
}

// Totals are the accumulated goods movements of one good (milli-units).
type Totals struct {
	Produced int64 `json:"produced"`
	Consumed int64 `json:"consumed"`
	Lost     int64 `json:"lost"`
	Spent    int64 `json:"spent,omitempty"`
	Refunded int64 `json:"refunded,omitempty"`
	Granted  int64 `json:"granted,omitempty"`
	// Loaded onto ships at the island and Unloaded from ships there.
	Loaded   int64 `json:"loaded,omitempty"`
	Unloaded int64 `json:"unloaded,omitempty"`
}

// Bottleneck is a building that is not running normally.
type Bottleneck struct {
	IslandID   string `json:"island_id"`
	BuildingID int64  `json:"building_id"`
	Type       string `json:"type"`
	Status     string `json:"status"`
	Reason     string `json:"reason"`
}

// PauseEvent is an auto-pause or auto-resume of a building or a ship
// (ShipID set, BuildingID 0).
type PauseEvent struct {
	At         string `json:"at"`
	Action     string `json:"action"`
	IslandID   string `json:"island_id"`
	BuildingID int64  `json:"building_id"`
	ShipID     int64  `json:"ship_id,omitempty"`
	Type       string `json:"type"`
	// Trial marks an auto_resume by the trial reserve (rule (c)).
	Trial bool `json:"trial,omitempty"`
}

// ExpectedError is a step that failed with the expected sentinel and left
// the world unchanged.
type ExpectedError struct {
	Step    int    `json:"step"`
	Error   string `json:"error"`
	Message string `json:"message"`
}

// Snapshot is the state after an advance step.
type Snapshot struct {
	Step          int                              `json:"step"`
	At            string                           `json:"at"`
	Boundaries    int                              `json:"boundaries"`
	Inventory     map[string]map[string]GoodAmount `json:"inventory"`
	StatusesCount map[string]int                   `json:"statuses"`
	// Gold in milli-gold and the balance in milli-gold per minute.
	Gold              int64 `json:"gold"`
	BalanceRatePerMin int64 `json:"balance_rate_per_min"`
	// Population per tier over all islands (milli-residents).
	Population    map[string]int64 `json:"population"`
	UnlockedTiers []string         `json:"unlocked_tiers"`
	// Ships after the step (omitted without ships).
	Ships []ShipSnapshot `json:"ships,omitempty"`
	// Farms with fields after the step (omitted without such farms).
	Farms []FarmSnapshot `json:"farms,omitempty"`
}

// FarmSnapshot is the field state of a farm in a snapshot: its active
// fields, the requirement and maximum, its efficiency (permille) and the
// IDs of its inactive fields (omitted when all are active).
type FarmSnapshot struct {
	Island     string  `json:"island"`
	ID         int64   `json:"id"`
	Type       string  `json:"type"`
	Active     int     `json:"active"`
	Required   int     `json:"required"`
	Max        int     `json:"max"`
	Fields     int     `json:"fields"`
	Efficiency int64   `json:"efficiency_permille"`
	Inactive   []int64 `json:"inactive,omitempty"`
}

// ShipSnapshot is the state of a ship in a snapshot; Cargo in milli-units
// per good.
type ShipSnapshot struct {
	ID        int64            `json:"id"`
	State     string           `json:"state"`
	IslandID  string           `json:"island_id,omitempty"`
	RouteID   int64            `json:"route_id,omitempty"`
	StopIndex int              `json:"stop_index,omitempty"`
	Cargo     map[string]int64 `json:"cargo,omitempty"`
	Paused    bool             `json:"paused,omitempty"`
}

// GoodAmount is stock and in-transit of a good (milli-units).
type GoodAmount struct {
	Stock     int64 `json:"stock"`
	InTransit int64 `json:"in_transit"`
}

// Ledger returns the exact (sub-milli) ledger of the run.
func (r *Report) Ledger() *sim.Ledger { return r.ledger }

// ClearTiming removes the wall-clock measurement so that reports can be
// compared byte for byte.
func (r *Report) ClearTiming() { r.AdvanceDurationMs = 0 }

// AdvanceDuration returns the measured wall time of the Advance calls.
func (r *Report) AdvanceDuration() time.Duration { return r.advanceDuration }

func (r *runner) display() (sim.DisplayState, error) {
	return sim.Display(r.w, r.c, r.w.LastEvaluatedAt)
}

// initSnapshots prepares the snapshot bookkeeping of a run.
func (r *runner) initSnapshots() {
	r.lastAdv = -1
	for i, st := range r.s.Steps {
		if st.Advance != nil {
			r.lastAdv = i
		}
	}
	r.lastSlot = 0
	r.tiers = sim.UnlockedTiers(r.w, r.c)
	r.populated = map[string]bool{}
	for tier, n := range sim.WorldPopulation(r.w, r.c) {
		r.populated[tier] = n > 0
	}
}

// wantSnapshot reports whether the advance step i records a snapshot
// (Scenario.SnapshotEvery). Milestones are detected after every advance,
// recorded or not, so that none is skipped.
func (r *runner) wantSnapshot(i int) bool {
	every := int64(r.s.SnapshotEvery)
	if every <= 1 {
		return true
	}
	milestone := false
	if tiers := sim.UnlockedTiers(r.w, r.c); !slices.Equal(tiers, r.tiers) {
		r.tiers, milestone = tiers, true
	}
	for tier, n := range sim.WorldPopulation(r.w, r.c) {
		if n > 0 && !r.populated[tier] {
			r.populated[tier], milestone = true, true
		}
	}
	slot := int64(r.w.LastEvaluatedAt.Sub(r.s.Start) / (time.Duration(every) * time.Minute))
	onGrid := slot > r.lastSlot
	if onGrid {
		r.lastSlot = slot
	}
	first := len(r.report.Snapshots) == 0
	return first || milestone || onGrid || i == r.lastAdv
}

func (r *runner) snapshot(step, boundaries int) Snapshot {
	snap := Snapshot{
		Step: step, At: r.w.LastEvaluatedAt.Format(timeLayout), Boundaries: boundaries,
		Inventory: map[string]map[string]GoodAmount{}, StatusesCount: map[string]int{},
		Population: map[string]int64{}, UnlockedTiers: sim.UnlockedTiers(r.w, r.c),
	}
	ds, err := r.display()
	if err != nil {
		return snap
	}
	snap.Gold, snap.BalanceRatePerMin = ds.Gold, ds.BalanceRatePerMin
	for _, is := range ds.Islands {
		inv := map[string]GoodAmount{}
		for good, g := range is.Inventory {
			if g.Stock != 0 || g.InTransit != 0 {
				inv[good] = GoodAmount{Stock: g.Stock, InTransit: g.InTransit}
			}
		}
		snap.Inventory[is.ID] = inv
		for tier, n := range is.Population {
			snap.Population[tier] += n
		}
		inactive := map[int64][]int64{}
		for _, b := range is.Buildings {
			if b.Rates != nil {
				snap.StatusesCount[b.Status]++
			}
			if b.FarmID != nil && b.Active != nil && !*b.Active {
				inactive[*b.FarmID] = append(inactive[*b.FarmID], b.ID)
			}
		}
		for _, b := range is.Buildings {
			if f := b.Fields; f != nil {
				snap.Farms = append(snap.Farms, FarmSnapshot{
					Island: is.ID, ID: b.ID, Type: b.Type, Active: f.Active, Required: f.Required, Max: f.Max,
					Fields: len(f.IDs), Efficiency: b.EfficiencyPermille, Inactive: inactive[b.ID],
				})
			}
		}
	}
	for _, sh := range ds.Ships {
		ss := ShipSnapshot{ID: sh.ID, State: sh.State, IslandID: sh.IslandID, RouteID: sh.RouteID, StopIndex: sh.StopIndex, Paused: sh.Paused}
		for _, sl := range sh.Cargo {
			if ss.Cargo == nil {
				ss.Cargo = map[string]int64{}
			}
			ss.Cargo[sl.Good] += sl.Amount
		}
		snap.Ships = append(snap.Ships, ss)
	}
	return snap
}

func (r *runner) finish() error {
	ds, err := r.display()
	if err != nil {
		return err
	}
	rep := r.report
	rep.Final = ds
	rep.ledger = r.l
	rep.AdvanceDurationMs = float64(rep.advanceDuration.Microseconds()) / 1000
	rep.Totals = map[string]map[string]Totals{}
	for island, goods := range r.l.Islands {
		t := map[string]Totals{}
		for good, f := range goods {
			t[good] = Totals{
				Produced: sim.FineToMilli(f.Produced),
				Consumed: sim.FineToMilli(f.Consumed),
				Lost:     sim.FineToMilli(f.Lost),
				Spent:    sim.FineToMilli(f.Spent),
				Refunded: sim.FineToMilli(f.Refunded),
				Granted:  sim.FineToMilli(f.Granted),
				Loaded:   sim.FineToMilli(f.Loaded),
				Unloaded: sim.FineToMilli(f.Unloaded),
			}
		}
		rep.Totals[island] = t
	}
	for _, q := range ds.Quests.Completed {
		rep.Quests = append(rep.Quests, QuestRecord{ID: q.ID, CompletedAt: q.CompletedAt, ClaimedAt: rep.claims[q.ID]})
	}
	rep.Bottlenecks = []Bottleneck{}
	if rep.PauseEvents == nil {
		rep.PauseEvents = []PauseEvent{}
	}
	for _, is := range ds.Islands {
		for _, b := range is.Buildings {
			if b.Status == sim.StatusOK {
				continue
			}
			rep.Bottlenecks = append(rep.Bottlenecks, Bottleneck{
				IslandID: is.ID, BuildingID: b.ID, Type: b.Type, Status: b.Status, Reason: reason(r.c, is, b),
			})
		}
	}
	return nil
}

// recordPauseEvents appends the auto-pause and auto-resume events of an
// Advance to the report.
func (r *runner) recordPauseEvents(bs []sim.Boundary) {
	for _, b := range bs {
		action := ""
		switch {
		case b.Kind == sim.BoundaryAutoPause:
			action = "auto_pause"
		case b.Kind == sim.BoundaryAutoResume && (b.BuildingID != 0 || b.ShipID != 0):
			action = "auto_resume"
		default:
			continue
		}
		typ := ""
		if b.ShipID != 0 {
			if s := r.w.Ship(b.ShipID); s != nil {
				typ = s.Type
			}
		} else if is := r.w.Island(b.IslandID); is != nil {
			if bd := is.Building(b.BuildingID); bd != nil {
				typ = bd.Type
			}
		}
		r.report.PauseEvents = append(r.report.PauseEvents, PauseEvent{
			At: b.At.Format(timeLayout), Action: action, IslandID: b.IslandID, BuildingID: b.BuildingID, ShipID: b.ShipID, Type: typ,
			Trial: b.Trial,
		})
	}
}

// reason renders the MECHANICS §14 message for a building status.
func reason(c *content.Catalogue, is sim.IslandDisplay, b sim.BuildingDisplay) string {
	switch b.Status {
	case sim.StatusPaused:
		if b.PausedReason == sim.PausedReasonUnpaid {
			return "Paused: insufficient gold"
		}
		return "Paused by player"
	case sim.StatusNotConnected:
		return "No road to a warehouse"
	case sim.StatusWarehouseFull:
		for _, good := range sortedKeys(b.Rates.Outputs) {
			if g := is.Inventory[good]; g.Stock+g.InTransit >= g.Capacity {
				return fmt.Sprintf("%s at capacity (%s/%s)", good, units(g.Stock+g.InTransit), units(g.Capacity))
			}
		}
		return "Warehouse full"
	case sim.StatusInputStarved:
		for _, good := range sortedKeys(b.Rates.Inputs) {
			if is.Inventory[good].Stock == 0 {
				return fmt.Sprintf("Missing: %s (%s/min)", good, units(b.Rates.Inputs[good]))
			}
		}
		return "Missing input"
	case sim.StatusThrottled:
		return fmt.Sprintf("Warehouse overloaded (throughput factor %d ‰)", b.ThroughputFactorPermille)
	case sim.StatusShortOfWorkers:
		if b.Workforce != nil {
			name := b.Workforce.Tier
			if t := c.TierByID[name]; t != nil {
				name = t.Name
			}
			wf := is.Workforce[b.Workforce.Tier]
			return fmt.Sprintf("Needs %s %s on this island (%s available)", units(wf.Required), name, units(wf.Available))
		}
		return "Short of workers"
	case sim.StatusLowEfficiency:
		if b.Fields != nil {
			return fmt.Sprintf("%d / %d fields", b.Fields.Active, b.Fields.Required)
		}
		return fmt.Sprintf("Only %d ‰ of the work area usable", b.EfficiencyPermille)
	case sim.StatusNotAdjacent:
		return "Not connected to its farm"
	}
	return b.Status
}

func units(milli int64) string {
	if milli%1000 == 0 {
		return fmt.Sprintf("%d", milli/1000)
	}
	return fmt.Sprintf("%.3f", float64(milli)/1000)
}
