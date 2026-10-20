package sim

import (
	"bytes"
	"testing"
	"time"

	"github.com/ricoberger/new-shores/server/internal/content"
)

// withTwoInputSawmill returns a copy of the catalogue whose sawmill needs
// wood and wool (two inputs, like a smelter's iron ore and charcoal).
func withTwoInputSawmill(base *content.Catalogue) *content.Catalogue {
	c := *base
	c.BuildingByID = make(map[string]*content.Building, len(base.BuildingByID))
	for id, b := range base.BuildingByID {
		c.BuildingByID[id] = b
	}
	sm := *base.BuildingByID["sawmill"]
	rec := *sm.Recipe
	rec.Inputs = []content.GoodAmount{{Good: "wood", Amount: 1000}, {Good: "wool", Amount: 1000}}
	sm.Recipe = &rec
	c.BuildingByID["sawmill"] = &sm
	return &c
}

// TestTwoStarvedInputsDoNotFlap: a producer whose two inputs are both
// empty without arrivals stays input-starved. Before the fix each starved
// input left its regime because the other one capped the consumer at zero,
// both re-entered a millisecond later, and Advance ran into the iteration
// cap and coarse mode. Arrivals of one input alone keep the producer
// starved; with both inputs in stock it runs. Advance stays composable.
func TestTwoStarvedInputsDoNotFlap(t *testing.T) {
	c := withTwoInputSawmill(catalogue(t))
	w := testWorld(t, c)
	mustApply(t, w, c, PlaceBuilding{IslandID: "main", Type: "sawmill", X: 14, Y: 5})
	sawmill := w.NextBuildingID - 1
	split := w.Clone()

	bs := mustAdvance(t, w, c, 10*time.Minute)
	if len(bs) > 10 || countKind(bs, BoundaryCoarseMode) != 0 {
		t.Fatalf("%d boundaries (%d coarse)", len(bs), countKind(bs, BoundaryCoarseMode))
	}
	if b := buildingDisplay(t, display(t, w, c), sawmill); b.Status != StatusInputStarved || b.Rates.Outputs["planks"] != 0 {
		t.Errorf("sawmill %s rate %d", b.Status, b.Rates.Outputs["planks"])
	}
	mustAdvance(t, split, c, 3*time.Minute+7*time.Millisecond)
	mustAdvance(t, split, c, 7*time.Minute-7*time.Millisecond)
	if !bytes.Equal(encode(t, w), encode(t, split)) {
		t.Error("split advance differs")
	}

	// One input in stock: still starved, no flapping.
	addStock(t, w, c, "wood", 20)
	if bs := mustAdvance(t, w, c, time.Minute); len(bs) > 10 {
		t.Fatalf("%d boundaries with one input", len(bs))
	}
	if b := buildingDisplay(t, display(t, w, c), sawmill); b.Status != StatusInputStarved {
		t.Errorf("sawmill with wood only: %s", b.Status)
	}
	// Both inputs in stock: the sawmill runs.
	addStock(t, w, c, "wool", 20)
	mustAdvance(t, w, c, time.Minute)
	if b := buildingDisplay(t, display(t, w, c), sawmill); b.Status != StatusOK || b.Rates.Outputs["planks"] <= 0 {
		t.Errorf("sawmill with both inputs: %s rate %d", b.Status, b.Rates.Outputs["planks"])
	}
}
