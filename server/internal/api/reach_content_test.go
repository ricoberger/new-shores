package api

import "testing"

// The content payload carries the D-069 collector numbers per level: reach
// and upkeep for the Trading Post and the Warehouse, upkeep for a public
// building's levels.
func TestCollectorReachContentPayload(t *testing.T) {
	p := newContentPayload(shippedCatalogue(t), "en")
	byID := map[string]buildingJSON{}
	for _, b := range p.Buildings {
		byID[b.ID] = b
	}
	tp, wh, market := byID["trading_post"].TradingPost, byID["warehouse"].Warehouse, byID["market"].Service
	if tp == nil || wh == nil || market == nil {
		t.Fatal("trading_post, warehouse or market block missing")
	}
	var tpReach, whReach []int
	var tpUpkeep, whUpkeep, marketUpkeep []int64
	for _, l := range tp.Levels {
		tpReach, tpUpkeep = append(tpReach, l.Reach), append(tpUpkeep, l.UpkeepPerMin)
	}
	for _, l := range wh.Levels {
		whReach, whUpkeep = append(whReach, l.Reach), append(whUpkeep, l.UpkeepPerMin)
	}
	for _, l := range market.Levels {
		marketUpkeep = append(marketUpkeep, l.UpkeepPerMin)
	}
	c := shippedCatalogue(t)
	for i := range tpReach {
		if tpReach[i] != c.BuildingByID["trading_post"].ReachAt(i+1) || tpUpkeep[i] != c.BuildingByID["trading_post"].UpkeepAt(i+1) {
			t.Errorf("trading_post level %d: reach %d upkeep %d", i+1, tpReach[i], tpUpkeep[i])
		}
	}
	for i := range whReach {
		if whReach[i] != c.BuildingByID["warehouse"].ReachAt(i+1) || whUpkeep[i] != c.BuildingByID["warehouse"].UpkeepAt(i+1) {
			t.Errorf("warehouse level %d: reach %d upkeep %d", i+1, whReach[i], whUpkeep[i])
		}
	}
	for i := range marketUpkeep {
		if marketUpkeep[i] != c.BuildingByID["market"].UpkeepAt(i+1) {
			t.Errorf("market level %d: upkeep %d", i+1, marketUpkeep[i])
		}
	}
	if len(tpReach) != 4 || tpReach[0] == 0 || len(whReach) != 4 || whReach[0] == 0 || len(marketUpkeep) != 4 {
		t.Errorf("levels: trading post reach %v, warehouse reach %v, market upkeep %v", tpReach, whReach, marketUpkeep)
	}
}
