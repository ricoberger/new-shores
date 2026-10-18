package scenario

import (
	"fmt"
	"time"

	"github.com/ricoberger/new-shores/server/internal/sim"
)

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
	// Snapshots after every advance step.
	Snapshots []Snapshot `json:"snapshots"`
	// Final is the Display payload at the end of the run.
	Final sim.DisplayState `json:"final"`

	advanceDuration time.Duration
	ledger          *sim.Ledger
}

// Totals are the accumulated goods movements of one good (milli-units).
type Totals struct {
	Produced int64 `json:"produced"`
	Consumed int64 `json:"consumed"`
	Lost     int64 `json:"lost"`
	Spent    int64 `json:"spent,omitempty"`
	Refunded int64 `json:"refunded,omitempty"`
	Granted  int64 `json:"granted,omitempty"`
}

// Bottleneck is a building that is not running normally.
type Bottleneck struct {
	IslandID   string `json:"island_id"`
	BuildingID int64  `json:"building_id"`
	Type       string `json:"type"`
	Status     string `json:"status"`
	Reason     string `json:"reason"`
}

// Snapshot is the inventory after an advance step.
type Snapshot struct {
	Step          int                              `json:"step"`
	At            string                           `json:"at"`
	Boundaries    int                              `json:"boundaries"`
	Inventory     map[string]map[string]GoodAmount `json:"inventory"`
	StatusesCount map[string]int                   `json:"statuses"`
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

func (r *runner) snapshot(step, boundaries int) Snapshot {
	snap := Snapshot{
		Step: step, At: r.w.LastEvaluatedAt.Format("2006-01-02T15:04:05.000Z07:00"), Boundaries: boundaries,
		Inventory: map[string]map[string]GoodAmount{}, StatusesCount: map[string]int{},
	}
	ds, err := r.display()
	if err != nil {
		return snap
	}
	for _, is := range ds.Islands {
		inv := map[string]GoodAmount{}
		for good, g := range is.Inventory {
			if g.Stock != 0 || g.InTransit != 0 {
				inv[good] = GoodAmount{Stock: g.Stock, InTransit: g.InTransit}
			}
		}
		snap.Inventory[is.ID] = inv
		for _, b := range is.Buildings {
			if b.Rates != nil {
				snap.StatusesCount[b.Status]++
			}
		}
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
			}
		}
		rep.Totals[island] = t
	}
	rep.Bottlenecks = []Bottleneck{}
	for _, is := range ds.Islands {
		for _, b := range is.Buildings {
			if b.Status == sim.StatusOK {
				continue
			}
			rep.Bottlenecks = append(rep.Bottlenecks, Bottleneck{
				IslandID: is.ID, BuildingID: b.ID, Type: b.Type, Status: b.Status, Reason: reason(is, b),
			})
		}
	}
	return nil
}

// reason renders the MECHANICS §14 message for a building status.
func reason(is sim.IslandDisplay, b sim.BuildingDisplay) string {
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
	case sim.StatusLowEfficiency:
		return fmt.Sprintf("Only %d ‰ of the work area usable", b.EfficiencyPermille)
	}
	return b.Status
}

func units(milli int64) string {
	if milli%1000 == 0 {
		return fmt.Sprintf("%d", milli/1000)
	}
	return fmt.Sprintf("%.3f", float64(milli)/1000)
}
