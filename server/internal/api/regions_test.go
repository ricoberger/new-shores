package api

import (
	"encoding/json"
	"path/filepath"
	"testing"
	"time"

	"github.com/ricoberger/new-shores/server/internal/content"
	"github.com/ricoberger/new-shores/server/internal/sim"
	"github.com/ricoberger/new-shores/server/internal/sim/archipelago"
)

// twoRegionCatalogue is the two-region test content of the content
// package (old_coast and south with a passage, D-076).
func twoRegionCatalogue(t *testing.T) *content.Catalogue {
	t.Helper()
	c, err := content.LoadWithSchemas(filepath.Join(repoRoot(t), "server", "internal", "content", "testdata", "regions"), filepath.Join(repoRoot(t), "content", "schema"))
	if err != nil {
		t.Fatal(err)
	}
	return c
}

// TestContentRegions: GET /content lists the regions of regions.json and
// the passages; the shipped content has one region (the top level is its
// catalogue) and no passage.
func TestContentRegions(t *testing.T) {
	spec := loadSpec(t)
	shipped, err := content.LoadWithSchemas(filepath.Join(repoRoot(t), "content"), filepath.Join(repoRoot(t), "content", "schema"))
	if err != nil {
		t.Fatal(err)
	}
	p := newContentPayload(shipped, "en")
	if len(p.Regions) != 1 || p.Regions[0] != (contentRegionJSON{ID: "old_coast", Prefix: "oc", Home: true}) || p.Passages == nil || len(p.Passages) != 0 {
		t.Fatalf("regions %+v passages %+v", p.Regions, p.Passages)
	}
	data, err := json.Marshal(p)
	if err != nil {
		t.Fatal(err)
	}
	spec.validateSchema(t, "Content", data)

	p = newContentPayload(twoRegionCatalogue(t), "de")
	if len(p.Regions) != 2 || p.Regions[1].ID != "south" || p.Regions[1].Prefix != "so" || p.Regions[1].Home || p.Regions[1].Gate == nil || *p.Regions[1].Gate != "sawmill" {
		t.Fatalf("regions %+v", p.Regions)
	}
	south := p.Regions[1].Catalogue
	if south == nil || south.Region.ID != "south" || south.Regions != nil || south.Passages != nil || len(south.Buildings) == 0 {
		t.Fatalf("south catalogue %+v", south)
	}
	if len(p.Passages) != 1 || p.Passages[0] != (passageJSON{From: "old_coast", To: "south", Ms: 10 * 60_000}) {
		t.Fatalf("passages %+v", p.Passages)
	}
	if len(p.Goods) <= len(south.Goods) {
		t.Fatalf("the top level has %d goods, the south %d: goods are global", len(p.Goods), len(south.Goods))
	}
	data, err = json.Marshal(p)
	if err != nil {
		t.Fatal(err)
	}
	spec.validateSchema(t, "Content", data)
}

// TestDisplayRegions: the display of a new world of two regions lists both
// (the second locked, without seed islands or passage point) and matches
// the DisplayState schema; islands and the start ship name the home region.
func TestDisplayRegions(t *testing.T) {
	c := twoRegionCatalogue(t)
	start := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	w, err := archipelago.NewWorld(c, 7, start)
	if err != nil {
		t.Fatal(err)
	}
	ds, err := sim.Display(w, c, start)
	if err != nil {
		t.Fatal(err)
	}
	if len(ds.Regions) != 2 || ds.Regions[0].ID != "old_coast" || !ds.Regions[0].Unlocked || ds.Regions[0].PassagePoint == nil ||
		ds.Regions[0].Bounds != ds.Archipelago.Bounds || ds.Regions[1].ID != "south" || ds.Regions[1].Unlocked || ds.Regions[1].PassagePoint != nil || ds.Regions[1].Seed != 8 {
		t.Fatalf("regions %+v", ds.Regions)
	}
	for _, is := range ds.Islands {
		if is.RegionID != "old_coast" {
			t.Fatalf("island %s in region %q", is.ID, is.RegionID)
		}
	}
	if s := ds.Ships[0]; s.RegionID == nil || *s.RegionID != "old_coast" {
		t.Fatalf("start ship region %v", s.RegionID)
	}
	ds.Archipelago.GeneratorVersion = archipelago.GeneratorVersion // as the server fills it in
	data, err := json.Marshal(ds)
	if err != nil {
		t.Fatal(err)
	}
	loadSpec(t).validateSchema(t, "DisplayState", data)
}
