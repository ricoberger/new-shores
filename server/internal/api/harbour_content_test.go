package api

import (
	"encoding/json"
	"testing"
)

// The content payload carries the harbour buildings of D-060: the
// trading pier's berths, the depot's levels and the quay's shallows flag,
// all in the Harbour or Roads build tab.
func TestHarbourContentPayload(t *testing.T) {
	p := newContentPayload(shippedCatalogue(t))
	byID := map[string]buildingJSON{}
	for _, b := range p.Buildings {
		byID[b.ID] = b
	}
	pier, depot, quay := byID["trading_pier"], byID["depot"], byID["quay"]
	if pier.Category != categoryHarbour || pier.Pier == nil || pier.Pier.Berths != 2 || pier.WaterTiles != 3 {
		t.Errorf("trading_pier = %+v", pier)
	}
	if depot.Category != categoryHarbour || depot.Depot == nil || len(depot.Depot.Levels) != 2 {
		t.Fatalf("depot = %+v", depot)
	}
	if l := depot.Depot.Levels; l[0].Capacity != 150_000 || l[0].Cost != nil || l[0].Tier != "" ||
		l[1].Capacity != 300_000 || l[1].Tier != "merchants" || l[1].Cost == nil || l[1].Cost.Materials["bricks"] != 10_000 {
		t.Errorf("depot levels = %+v", l)
	}
	if quay.Category != categoryRoads || quay.Road == nil || !quay.Road.Shallows || quay.Road.MsPerTile != 600 {
		t.Errorf("quay = %+v", quay)
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
