package sim

import (
	"bytes"
	"maps"
	"slices"
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
	rec.Inputs = []content.RecipeInput{content.NewRecipeInput(1000, "wood"), content.NewRecipeInput(1000, "wool")}
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

// TestInputAlternatives (D-056 §7): an input slot accepting ["wood",
// "wool"] draws wood while it is not starved, switches to wool once wood
// is starved and wool is in stock, and stays input-starved without
// flapping when both are empty. Advance stays composable.
func TestInputAlternatives(t *testing.T) {
	base := catalogue(t)
	c := *base
	c.BuildingByID = maps.Clone(base.BuildingByID)
	sm := *base.BuildingByID["sawmill"]
	rec := *sm.Recipe
	rec.Inputs = []content.RecipeInput{content.NewRecipeInput(1000, "wood", "wool")}
	sm.Recipe = &rec
	c.BuildingByID["sawmill"] = &sm
	cc := &c
	w := testWorld(t, cc)
	mustApply(t, w, cc, PlaceBuilding{IslandID: "main", Type: "sawmill", X: 14, Y: 5})
	sawmill := w.NextBuildingID - 1
	draws := func() map[string]Qty {
		t.Helper()
		return buildingDisplay(t, display(t, w, cc), sawmill).Rates.Inputs
	}

	// Both empty: starved, no flapping.
	if bs := mustAdvance(t, w, cc, 10*time.Minute); len(bs) > 10 || countKind(bs, BoundaryCoarseMode) != 0 {
		t.Fatalf("%d boundaries", len(bs))
	}
	if b := buildingDisplay(t, display(t, w, cc), sawmill); b.Status != StatusInputStarved || !slices.Equal(b.StatusGoods, []string{"wood"}) {
		t.Errorf("both empty: %s %v", b.Status, b.StatusGoods)
	}

	// Wood and wool in stock: wood is preferred.
	addStock(t, w, cc, "wood", 5)
	addStock(t, w, cc, "wool", 5)
	if in := draws(); in["wood"] <= 0 || in["wool"] != 0 {
		t.Errorf("both in stock: draws %v", in)
	}
	split := w.Clone()
	// Wood runs out first; the sawmill goes on with wool, then starves.
	bs := mustAdvance(t, w, cc, 30*time.Minute)
	if len(bs) > 20 || countKind(bs, BoundaryCoarseMode) != 0 {
		t.Fatalf("%d boundaries", len(bs))
	}
	inv := w.Islands[0].Inventory
	if inv.Stock["wood"] != 0 || inv.Stock["wool"] != 0 {
		t.Errorf("stock wood %d wool %d", inv.Stock["wood"], inv.Stock["wool"])
	}
	mustAdvance(t, split, cc, 3*time.Minute+11*time.Millisecond)
	mustAdvance(t, split, cc, 27*time.Minute-11*time.Millisecond)
	if !bytes.Equal(encode(t, w), encode(t, split)) {
		t.Error("split advance differs")
	}

	// Wool only: drawn at once.
	addStock(t, w, cc, "wool", 5)
	mustAdvance(t, w, cc, time.Second)
	if in := draws(); in["wool"] <= 0 || in["wood"] != 0 {
		t.Errorf("wool only: draws %v", in)
	}
	if b := buildingDisplay(t, display(t, w, cc), sawmill); b.Status != StatusOK {
		t.Errorf("wool only: %s", b.Status)
	}
}
