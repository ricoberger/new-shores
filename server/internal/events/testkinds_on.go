//go:build testevents

package events

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/ricoberger/new-shores/server/internal/sim"
	"github.com/ricoberger/new-shores/server/internal/store"
)

// TestKindsCompiled reports whether the test-only event kinds are compiled
// in (build tag testevents).
const TestKindsCompiled = true

// KindTestCredit adds goods to island inventories. Test builds only: it is
// used to observe duplicate processing and multi-world locking.
const KindTestCredit = "test_credit"

func registerTestKinds(r *Registry) {
	r.Register(KindTestCredit, testCredit)
}

// TestCreditPayload is the payload of test_credit.
type TestCreditPayload struct {
	Credits []TestCredit `json:"credits"`
}

// TestCredit adds AmountMilli of Good to an island of a world.
type TestCredit struct {
	WorldID     store.WorldID `json:"world_id"`
	IslandID    string        `json:"island_id"`
	Good        string        `json:"good"`
	AmountMilli int64         `json:"amount_milli"`
}

// testCredit adds each credit clamped to the free warehouse capacity; the
// surplus is logged.
func testCredit(_ context.Context, hc *HandlerContext) error {
	var p TestCreditPayload
	if err := json.Unmarshal(hc.Event.Payload, &p); err != nil {
		return fmt.Errorf("test_credit payload: %w", err)
	}
	var surplus int64
	for _, c := range p.Credits {
		w, ok := hc.Worlds[c.WorldID]
		if !ok {
			return fmt.Errorf("test_credit: world %s is not part of the event", c.WorldID)
		}
		if c.AmountMilli < 0 {
			return errors.New("test_credit: negative amount")
		}
		amount := c.AmountMilli
		err := sim.AddStock(w, hc.Catalogue, c.IslandID, c.Good, amount, nil)
		if errors.Is(err, sim.ErrOverCapacity) {
			free, ferr := freeCapacity(w, hc, c)
			if ferr != nil {
				return ferr
			}
			amount = min(amount, free)
			err = sim.AddStock(w, hc.Catalogue, c.IslandID, c.Good, amount, nil)
			if errors.Is(err, sim.ErrOverCapacity) {
				amount, err = 0, nil
			}
		}
		if err != nil {
			return fmt.Errorf("test_credit: %w", err)
		}
		surplus += c.AmountMilli - amount
	}
	if surplus > 0 {
		hc.Logger.Info("test_credit surplus over capacity", "event_id", hc.Event.ID, "surplus_milli", surplus)
	}
	return nil
}

func freeCapacity(w *sim.World, hc *HandlerContext, c TestCredit) (int64, error) {
	ds, err := sim.Display(w, hc.Catalogue, w.LastEvaluatedAt)
	if err != nil {
		return 0, err
	}
	for _, is := range ds.Islands {
		if is.ID == c.IslandID {
			g := is.Inventory[c.Good]
			return max(0, g.Capacity-g.Stock-g.InTransit), nil
		}
	}
	return 0, fmt.Errorf("test_credit: %w: %q", sim.ErrUnknownIsland, c.IslandID)
}
