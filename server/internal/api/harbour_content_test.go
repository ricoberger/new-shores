package api

import (
	"encoding/json"
	"slices"
	"testing"
)

// The content payload carries the harbour buildings of D-060: the
// trading pier's berths, the depot's fixed capacity and the quay's shallows flag,
// all in the Harbour group of the build menu (the quay is a road on the shallows).
func TestHarbourContentPayload(t *testing.T) {
	p := newContentPayload(shippedCatalogue(t), "en")
	byID := map[string]buildingJSON{}
	for _, b := range p.Buildings {
		byID[b.ID] = b
	}
	pier, depot, quay := byID["trading_pier"], byID["depot"], byID["quay"]
	if pier.Category != categoryHarbour || pier.Pier == nil || pier.Pier.Berths != 2 || pier.WaterRows != nil || pier.Placement != "shore" {
		t.Errorf("trading_pier = %+v", pier)
	}
	if depot.Category != categoryHarbour || depot.Depot == nil || depot.Depot.Capacity != 150_000 || depot.Placement != "shore" {
		t.Fatalf("depot = %+v", depot)
	}
	if quay.Category != categoryHarbour || quay.Road == nil || !quay.Road.Shallows || quay.Road.MsPerTile != 600 {
		t.Errorf("quay = %+v", quay)
	}
	// D-085: the jetty is a Settlers water road in the Harbour group; the
	// quay replaces it; the rural water-edge buildings stand on both, the
	// harbour buildings on the quay only.
	jetty := byID["jetty"]
	if jetty.Category != categoryHarbour || jetty.Tier != "settlers" || jetty.Road == nil || !jetty.Road.Shallows || jetty.Replaces != nil || jetty.StandsOn != nil ||
		jetty.Cost.Gold != 3_000 || len(jetty.Cost.Materials) != 1 || jetty.Cost.Materials["planks"] != 1_000 {
		t.Errorf("jetty = %+v", jetty)
	}
	if !slices.Equal(quay.Replaces, []string{"jetty"}) || !slices.Equal(byID["road_paved"].Replaces, []string{"road_dirt"}) {
		t.Errorf("replaces: quay %v, road_paved %v", quay.Replaces, byID["road_paved"].Replaces)
	}
	for id, want := range map[string][]string{
		"fisher": {"jetty", "quay"}, "salt_pans": {"jetty", "quay"}, "oyster_beds": {"jetty", "quay"},
		"trading_post": {"quay"}, "depot": {"quay"}, "trading_pier": {"quay"}, "shipyard": {"quay"}, "market": nil,
	} {
		if got := byID[id].StandsOn; !slices.Equal(got, want) {
			t.Errorf("%s stands_on %v, want %v", id, got, want)
		}
	}
	raw, err := json.Marshal(byID["market"])
	if err != nil {
		t.Fatal(err)
	}
	var m map[string]json.RawMessage
	if err := json.Unmarshal(raw, &m); err != nil {
		t.Fatal(err)
	}
	if _, ok := m["pier"]; ok {
		t.Error("market carries a pier block")
	}
	if _, ok := m["depot"]; ok {
		t.Error("market carries a depot block")
	}
}
