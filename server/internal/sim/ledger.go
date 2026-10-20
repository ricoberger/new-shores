package sim

import (
	"maps"
	"slices"

	"github.com/ricoberger/new-shores/server/internal/content"
)

// Flow accumulates the goods movements of one good on one island, in
// sub-milli units (see SubPerMilli). It is diagnostic output, not world
// state.
//
// Conservation per island: stock + in transit + buffers = Produced -
// Consumed - Lost - Spent + Refunded + Granted - Loaded + Unloaded. Over the
// whole world Loaded and Unloaded cancel against the cargo aboard ships:
// sum(islands) + sum(cargo) = sum(Produced - Consumed - Lost - Spent +
// Refunded + Granted).
type Flow struct {
	// Produced by recipes (into transit or an unconnected buffer). Buffered
	// goods that later leave with a connected producer's output stream are
	// not counted again.
	Produced int64 `json:"produced"`
	// Consumed by recipes from the island inventory.
	Consumed int64 `json:"consumed"`
	// Lost to capacity clamping (coarse steps, refunds, surplus loss) and
	// demolished buffers.
	Lost int64 `json:"lost"`
	// Spent on construction.
	Spent int64 `json:"spent"`
	// Refunded by demolition (before clamping; clamped refunds count as Lost).
	Refunded int64 `json:"refunded"`
	// Granted from outside the simulation (seeding, AddStock).
	Granted int64 `json:"granted"`
	// Loaded from the island inventory onto a ship.
	Loaded int64 `json:"loaded,omitempty"`
	// Unloaded from a ship at this island: into the inventory, or spent
	// (founding, recorded as Spent too) or lost above capacity (scrapping,
	// recorded as Lost too).
	Unloaded int64 `json:"unloaded,omitempty"`
}

// Ledger collects Flows per island and good. A nil *Ledger discards all
// records, so callers that do not need accounting pass nil.
type Ledger struct {
	Islands map[string]map[string]*Flow `json:"islands"`
}

// NewLedger returns an empty ledger.
func NewLedger() *Ledger { return &Ledger{Islands: map[string]map[string]*Flow{}} }

func (l *Ledger) flow(island, good string) *Flow {
	if l == nil {
		return new(Flow)
	}
	goods := l.Islands[island]
	if goods == nil {
		goods = map[string]*Flow{}
		l.Islands[island] = goods
	}
	f := goods[good]
	if f == nil {
		f = &Flow{}
		goods[good] = f
	}
	return f
}

// Flow returns the accumulated flow for a good on an island (zero if none).
func (l *Ledger) Flow(island, good string) Flow {
	if l == nil || l.Islands[island] == nil || l.Islands[island][good] == nil {
		return Flow{}
	}
	return *l.Islands[island][good]
}

// capacityFine returns the per-good capacity of the island in sub-milli
// units. Capacity is per good but identical for every good (MECHANICS §5).
func capacityFine(is *Island, c *content.Catalogue) int64 {
	return capacityMilli(is, c) * SubPerMilli
}

// capacityMilli returns the per-good capacity in milli-units: the sum of the
// level capacities of all warehouses on the island (0 without one).
func capacityMilli(is *Island, c *content.Catalogue) Qty {
	var total Qty
	for _, b := range is.Buildings {
		def := c.BuildingByID[b.Type]
		if def == nil || def.Warehouse == nil {
			continue
		}
		total += warehouseLevel(def, b).Capacity
	}
	return total
}

func warehouseLevel(def *content.Building, b *Building) content.WarehouseLevel {
	lvl := b.Level
	if lvl < 1 {
		lvl = 1
	}
	if lvl > len(def.Warehouse.Levels) {
		lvl = len(def.Warehouse.Levels)
	}
	return def.Warehouse.Levels[lvl-1]
}

// transitFine returns the amount of a good still in transit at time now.
func transitFine(is *Island, good string, now int64) int64 {
	var total int64
	for _, b := range is.Buildings {
		total += b.transitFine(good, now)
	}
	return total
}

func (b *Building) transitFine(good string, now int64) int64 {
	var total int64
	for _, s := range b.Transit {
		if s.Good != good || s.ToMs <= now {
			continue
		}
		total += s.RateSub * (s.ToMs - max(s.FromMs, now))
	}
	return total
}

// committedFine is stock plus in-transit: the quantity the warehouse full
// rule is evaluated against.
func committedFine(is *Island, good string, now int64) int64 {
	return is.Inventory.fine(good) + transitFine(is, good, now)
}

// sortedKeys returns the sorted union of the keys of the given maps.
func sortedKeys[V any](ms ...map[string]V) []string {
	set := map[string]bool{}
	for _, m := range ms {
		for k := range m {
			set[k] = true
		}
	}
	return slices.Sorted(maps.Keys(set))
}

// FineToMilli converts a sub-milli amount (as recorded in a Flow) to
// milli-units, rounding half up.
func FineToMilli(f int64) Qty { return roundFine(f) }

// FineStock returns stock plus in-transit plus producer buffers of a good
// on an island in sub-milli units (the quantity the ledger accounts for).
func FineStock(is *Island, good string, now int64) int64 {
	t := is.Inventory.fine(good) + transitFine(is, good, now)
	for _, b := range is.Buildings {
		t += b.bufferFine(good)
	}
	return t
}
