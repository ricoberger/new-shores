package devworld

import (
	"errors"
	"fmt"
	"time"

	"github.com/ricoberger/new-shores/server/internal/content"
	"github.com/ricoberger/new-shores/server/internal/sim"
)

// FixtureCastleTown is the D-077 showcase on the patricians fixture: a
// castle near the street's end inside a walled quarter (a ring of city
// wall one tile out from the castle, arched where it crosses a land road,
// with a tower on two of its corners), the Kontor on the home island's
// coast and two warships — a balinger patrolling the home island and a
// war cog patrolling the quartz island — for shots and the owner's
// playtest (D-077 §2–§6).
const FixtureCastleTown = "castle-town"

// castleTownHistory: the patricians history plus both warships' builds,
// the castle, wall, towers and Kontor and a few minutes of patrol.
const castleTownHistory = patriciansHistory + 40*time.Minute

const (
	castleType   = "castle"
	kontorType   = "kontor"
	wallType     = "city_wall"
	towerType    = "tower"
	castlePatrol = 5 * time.Minute
)

// castleWarships are the fixture's warships: the type and the island it
// patrols (true: the home island, false: the quartz island).
var castleWarships = []struct {
	typ  string
	home bool
}{{"balinger", true}, {"war_cog", false}}

// castleTown builds the castle, its wall ring and towers, the Kontor and
// the patrolling warships on the patricians fixture.
func castleTown(f *fixture) {
	if f.err != nil {
		return
	}
	home := f.home()
	for _, id := range []string{castleType, kontorType, wallType, towerType} {
		if f.c.BuildingByID[id] == nil {
			f.err = fmt.Errorf("the %s fixture needs %s content", FixtureCastleTown, id)
			return
		}
	}
	castle := f.c.BuildingByID[castleType]
	f.grant(home, &castle.Cost)
	id := f.placeNear(home, castleType, f.streetEnd(home))
	if f.err != nil {
		return
	}
	b := f.w.Island(home).Building(id)
	walls := castleRing(f, home, b, castle)
	if f.err != nil {
		return
	}
	if walls == 0 {
		f.err = fmt.Errorf("the %s fixture placed no %s round the castle", FixtureCastleTown, wallType)
		return
	}
	f.grant(home, &f.c.BuildingByID[kontorType].Cost)
	f.placeNear(home, kontorType, f.tradingPostCentre(home))
	if f.err != nil {
		return
	}
	castleWarshipsOnPatrol(f, home)
}

// castleRing paints the city wall ring one tile out from the castle's
// footprint, with a tower on its north-west and south-east corners
// (where they fit); tiles the server refuses (buildings, water, quays)
// stay open. Returns the wall tiles placed.
func castleRing(f *fixture, island string, b *sim.Building, def *content.Building) int {
	w, h := def.Width, def.Height
	if b.Rotation == 90 || b.Rotation == 270 {
		w, h = h, w
	}
	x0, y0, x1, y1 := b.X-2, b.Y-2, b.X+w+1, b.Y+h+1
	tower := f.c.BuildingByID[towerType]
	for _, p := range []sim.Pos{{X: x0 - 1, Y: y0 - 1}, {X: x1, Y: y1}} {
		f.grant(island, &tower.Cost)
		f.try(sim.PlaceBuilding{IslandID: island, Type: towerType, X: p.X, Y: p.Y})
	}
	var ring []sim.Pos
	for x := x0; x <= x1; x++ {
		ring = append(ring, sim.Pos{X: x, Y: y0}, sim.Pos{X: x, Y: y1})
	}
	for y := y0 + 1; y < y1; y++ {
		ring = append(ring, sim.Pos{X: x0, Y: y}, sim.Pos{X: x1, Y: y})
	}
	is := f.w.Island(island)
	tiles := ring[:0]
	for _, p := range ring {
		if is.InBounds(p.X, p.Y) {
			tiles = append(tiles, p)
		}
	}
	wall := f.c.BuildingByID[wallType]
	for range tiles {
		f.grant(island, &wall.Cost)
	}
	f.try(sim.PlacePaint{IslandID: island, Type: wallType, Tiles: tiles})
	n := 0
	for _, b := range f.w.Island(island).Buildings {
		if b.Type == wallType {
			n++
		}
	}
	return n
}

// castleWarshipsOnPatrol builds the warships one after the other at the
// home island's shipyard and sends each on its patrol.
func castleWarshipsOnPatrol(f *fixture, home string) {
	var yard int64
	for _, b := range f.w.Island(home).Buildings {
		if b.Type == "shipyard" {
			yard = b.ID
			break
		}
	}
	if yard == 0 {
		f.err = errors.New("the castle-town fixture needs the patricians shipyard")
		return
	}
	quartz := f.nearestWithDeposit(home, patriciansDeposit)
	for _, ws := range castleWarships {
		ship := f.c.ShipByID[ws.typ]
		if ship == nil {
			f.err = fmt.Errorf("the %s fixture needs the %s ship", FixtureCastleTown, ws.typ)
			return
		}
		f.grant(home, &ship.Cost)
		f.apply(sim.OrderShip{IslandID: home, BuildingID: yard, ShipType: ws.typ})
		f.advance(time.Duration(ship.BuildMs)*time.Millisecond + 10*time.Second)
		if f.err != nil {
			return
		}
		last := f.w.Ships[len(f.w.Ships)-1]
		if last.Type != ws.typ || last.State != sim.ShipIdle {
			f.err = fmt.Errorf("the %s is not idle after its build time", ws.typ)
			return
		}
		target := home
		if !ws.home {
			target = quartz
		}
		f.apply(sim.StartPatrol{ShipID: last.ID, IslandID: target})
	}
	f.advance(castlePatrol)
}
