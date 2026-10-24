package sim

import (
	"bytes"
	"fmt"
	"testing"
	"time"
)

// Property tests with ships (R-65): conservation across cargo and islands,
// capacity bounds after unloads, the single-location invariant, exact
// composition at random and deliberate split points (due moments, inside
// the handling time, departures, insolvency points) while ships are in
// flight and orders pending, determinism, and insolvency pauses/resumes
// of ships.

// shipPropWorld extends a town (island "main") with a settled island
// "isle" (shipyard, stock) and an unsettled island "wild", and adds idle
// sloops. With recovery set the town starts insolvent and recovers
// (recoveryWorld), so that ships are paused and resumed.
func (p *propCase) shipPropWorld(recovery bool) {
	switch {
	case recovery:
		p.w = p.recoveryWorld()
	case p.rng.IntN(2) == 0:
		p.w = p.townWorld()
	default:
		p.l = NewLedger()
		p.w = p.randomWorld()
	}
	w := p.w
	isle := islandFromRows("isle",
		"~~~~~~~~~~~~~~~~~~~~~~~~",
		"~~~~~~~~~~~~~~~~~~~~~~~~",
		"~~~~~~~~~~~~~~~~~~~~~~~~",
		"~......................~",
		"~......................~",
		"~......................~",
		"~......................~",
		"~~~~~~~~~~~~~~~~~~~~~~~~",
	)
	isle.X, isle.Y = 3+p.rng.IntN(10), 4+p.rng.IntN(10)
	wild := islandFromRows("wild",
		"~~~~~~~~~~~~",
		"~~~~~~~~~~~~",
		"~cccccccccc~",
		"~..........~",
		"~~~~~~~~~~~~",
	)
	wild.X, wild.Y = -5-p.rng.IntN(10), 2+p.rng.IntN(10)
	w.Islands = append(w.Islands, isle, wild)
	if err := PlaceFree(w, p.c, PlaceBuilding{IslandID: "isle", Type: "trading_post", X: 1, Y: 1}, p.l); err != nil {
		p.fail("isle trading post: %v", err)
	}
	var road []Pos
	for x := 1; x <= 20; x++ {
		road = append(road, Pos{x, 5})
	}
	if err := ApplyWithLedger(w, p.c, PlaceRoad{IslandID: "isle", Type: "road_dirt", Tiles: road}, p.l); err != nil {
		p.fail("isle road: %v", err)
	}
	if err := PlaceFree(w, p.c, PlaceBuilding{IslandID: "isle", Type: "shipyard", X: 6, Y: 1}, p.l); err != nil {
		p.fail("isle shipyard: %v", err)
	}
	for _, g := range p.c.Goods {
		if err := AddStock(w, p.c, "isle", g.ID, Qty(p.rng.IntN(200))*1000+Qty(p.rng.IntN(1000)), p.l); err != nil {
			p.fail("isle stock: %v", err)
		}
	}
	w.NextShipID = 1
	for range 1 + p.rng.IntN(3) {
		island := []string{"main", "isle"}[p.rng.IntN(2)]
		w.Ships = append(w.Ships, &Ship{ID: w.NextShipID, Type: "sloop", State: ShipIdle, IslandID: island})
		w.NextShipID++
	}
}

func (p *propCase) randomShip() *Ship {
	if len(p.w.Ships) == 0 {
		return nil
	}
	return p.w.Ships[p.rng.IntN(len(p.w.Ships))]
}

func (p *propCase) randomStops() []Stop {
	islands := []string{"main", "isle", "wild"}
	n := 2 + p.rng.IntN(3)
	var stops []Stop
	for i := range n {
		st := Stop{IslandID: islands[p.rng.IntN(len(islands))]}
		if i > 0 && st.IslandID == stops[i-1].IslandID {
			st.IslandID = islands[(p.rng.IntN(2)+1+indexOf(islands, st.IslandID))%len(islands)]
		}
		for _, g := range p.c.Goods {
			switch p.rng.IntN(6) {
			case 0:
				st.Load = append(st.Load, LoadRule{Good: g.ID, MaxAmount: Qty(1+p.rng.IntN(120)) * 1000})
			case 1:
				st.Unload = append(st.Unload, g.ID)
			}
		}
		stops = append(stops, st)
	}
	return stops
}

func indexOf(list []string, s string) int {
	for i, x := range list {
		if x == s {
			return i
		}
	}
	return 0
}

// randomShipCommand returns a random ship or route command; many are
// invalid.
func (p *propCase) randomShipCommand() Command {
	s := p.randomShip()
	var shipID int64 = 99
	if s != nil {
		shipID = s.ID
	}
	routeID := int64(1 + p.rng.IntN(max(len(p.w.Routes), 1)+1))
	if len(p.w.Routes) > 0 && p.rng.IntN(4) > 0 {
		routeID = p.w.Routes[p.rng.IntN(len(p.w.Routes))].ID
	}
	islands := []string{"main", "isle", "wild"}
	switch r := p.rng.IntN(100); {
	case r < 8:
		return OrderShip{IslandID: "isle", BuildingID: p.w.Island("isle").Buildings[1].ID, ShipType: "sloop"}
	case r < 11:
		return CancelShipOrder{IslandID: "isle", BuildingID: p.w.Island("isle").Buildings[1].ID}
	case r < 25:
		return CreateRoute{Name: fmt.Sprintf("r%d", p.rng.IntN(100)), Stops: p.randomStops()}
	case r < 30:
		return UpdateRoute{RouteID: routeID, Stops: p.randomStops()}
	case r < 33:
		return DeleteRoute{RouteID: routeID}
	case r < 50:
		return AssignShip{ShipID: shipID, RouteID: routeID}
	case r < 56:
		return UnassignShip{ShipID: shipID}
	case r < 80:
		var cargo []CargoAmount
		if s != nil {
			if is := p.w.Island(s.IslandID); is != nil {
				for _, g := range sortedKeys(is.Inventory.Stock) {
					if p.rng.IntN(3) == 0 {
						cargo = append(cargo, CargoAmount{Good: g, Amount: 1 + Qty(p.rng.Int64N(min(is.Inventory.Stock[g], 60_000)))})
					}
				}
			}
		}
		return ManualShipment{ShipID: shipID, ToIslandID: islands[p.rng.IntN(len(islands))], Cargo: cargo}
	case r < 92:
		return FoundIsland{ShipID: shipID, IslandID: "wild", BuildingType: "trading_post", X: 1 + p.rng.IntN(2), Y: 0}
	default:
		return ScrapShip{ShipID: shipID}
	}
}

// shipRun runs a random ship scenario and returns the encoded world and
// the boundaries.
func (p *propCase) shipRun(compose bool) ([]byte, []Boundary) {
	var bs []Boundary
	for range 20 + p.rng.IntN(20) {
		switch r := p.rng.IntN(10); {
		case r < 5:
			p.apply(p.randomShipCommand())
		case r < 7:
			p.apply(p.randomCommand())
		default:
			d := time.Duration(1+p.rng.IntN(5*60_000)) * time.Millisecond
			if p.rng.IntN(4) == 0 {
				d = p.randomDuration()
			}
			bs = append(bs, p.advance(d, compose)...)
		}
	}
	bs = append(bs, p.advance(p.randomDuration(), compose)...)
	data, err := Encode(p.w, "p")
	if err != nil {
		p.fail("encode: %v", err)
	}
	return data, bs
}

func TestPropertyShips(t *testing.T) {
	base := catalogue(t)
	// Without the upkeep of never-pausable buildings, towns recover from
	// insolvency, so that ships are resumed as well.
	cheap := withUpkeep(base, map[string]Qty{"trading_post": 0, "shipyard": 0})
	kinds := map[string]int{}
	splitKinds := map[string]int{}
	states := map[string]int{}
	for seed := range uint64(propertyCases) {
		c := base
		if seed%2 == 1 {
			c = cheap
		}
		p := newPropCase(t, c, 150_000+seed)
		p.maxPieces = 6
		p.shipPropWorld(seed%2 == 1)
		p.checkInvariants("initial")
		_, bs := p.shipRun(true)
		for _, b := range bs {
			k := b.Kind
			if b.ShipID != 0 && (k == BoundaryAutoPause || k == BoundaryAutoResume) {
				k = "ship_" + k
			}
			kinds[k]++
		}
		for k, n := range p.splitKinds {
			splitKinds[k] += n
		}
		for _, s := range p.w.Ships {
			states[s.State]++
		}
	}
	t.Logf("boundaries %v; deliberate splits %v; final ship states %v", kinds, splitKinds, states)
	for _, k := range []string{BoundaryShipBuilt, BoundaryShipArrived, "ship_" + BoundaryAutoPause, "ship_" + BoundaryAutoResume} {
		if kinds[k] < propertyCases/20 {
			t.Errorf("only %d %s boundaries", kinds[k], k)
		}
	}
	for _, k := range []string{BoundaryShipArrived, "handling"} {
		if splitKinds[k] < propertyCases/10 {
			t.Errorf("only %d splits at %s points", splitKinds[k], k)
		}
	}
}

func TestPropertyShipsDeterminism(t *testing.T) {
	c := catalogue(t)
	for seed := range uint64(propertyCases / 2) {
		run := func() ([]byte, []Boundary) {
			p := newPropCase(t, c, 170_000+seed)
			p.shipPropWorld(seed%2 == 1)
			return p.shipRun(false)
		}
		a, abs := run()
		b, bbs := run()
		if !bytes.Equal(a, b) || fmt.Sprint(abs) != fmt.Sprint(bbs) {
			t.Fatalf("seed %d: runs differ", seed)
		}
	}
}
