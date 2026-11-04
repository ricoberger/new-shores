package devworld

import (
	"errors"
	"fmt"
	"slices"

	"github.com/ricoberger/new-shores/server/internal/content"
	"github.com/ricoberger/new-shores/server/internal/layout"
	"github.com/ricoberger/new-shores/server/internal/sim"
)

// Plans of the played fixture (D-071): on the home island (the island
// with the most buildings) a planned merchants quarter in the open land
// nearest to the Trading Post — a planned street with its road from the
// network, a warehouse, a fire station and settler houses (later tiers
// only appear by upgrading) — a planned farm (playedPlannedFarms) with
// planned fields, and planned fields at the first real farm that has room for
// them. Sites are found like the fixtures' (the real placement check,
// nearest first); plans cost nothing and do not change the simulation.
var playedQuarter = []string{"warehouse", "fire_station", "house_settlers", "house_settlers", "house_settlers", "house_settlers", "house_settlers", "house_settlers"}

// playedPlannedFarms are the farm types tried for the planned farm, in
// order (the first whose fields the island's fertility allows).
var playedPlannedFarms = []string{"hop_farm", "woad_farm", "hemp_farm", "wheat_farm", "orchard"}

// planPlayed adds the played fixture's plans to w.
func planPlayed(c *content.Catalogue, w *sim.World) error {
	lp := &layout.Planner{C: c, W: w, SpareForest: true}
	var home *sim.Island
	for _, is := range w.Islands {
		if lp.TradingPost(is.ID) != nil && (home == nil || len(is.Buildings) > len(home.Buildings)) {
			home = is
		}
	}
	if home == nil {
		return nil // nothing settled (a test scenario): no plans
	}
	from := lp.TradingPostCentre(home.ID)
	v := lp.View(home)
	anchor := from
	for _, a := range [][2]int{{10, 380}, {9, 300}, {8, 220}, {7, 150}, {6, 110}, {5, 80}} {
		if anchor = lp.OpenAnchor(home.ID, from, a[0], a[1]); v.Open(anchor.X, anchor.Y) {
			break
		}
	}
	if !v.Open(anchor.X, anchor.Y) {
		return errors.New("no open land for the planned quarter")
	}

	// The street: a straight row through the anchor over the open
	// tiles around it, and the road from the network to it.
	street := []sim.Pos{anchor}
	for _, d := range []int{-1, 1} {
		for x := anchor.X + d; x >= 0 && x < home.Width && abs(x-anchor.X) <= 7 && v.Open(x, anchor.Y); x += d {
			street = append(street, sim.Pos{X: x, Y: anchor.Y})
		}
	}
	path, ok := lp.RoadPath(home.ID, anchor.X, anchor.Y, 1, 1)
	if ok {
		tiles := slices.Clone(street)
		for _, p := range path {
			if !slices.Contains(tiles, p) {
				tiles = append(tiles, p)
			}
		}
		if sim.Apply(w, c, sim.PlaceRoad{IslandID: home.ID, Type: "road_dirt", Tiles: tiles, Planned: true}) == nil {
			street = nil
		}
	}
	if street != nil {
		if err := sim.Apply(w, c, sim.PlaceRoad{IslandID: home.ID, Type: "road_dirt", Tiles: street, Planned: true}); err != nil {
			return fmt.Errorf("planned street: %w", err)
		}
	}
	for i, typ := range playedQuarter {
		// The warehouse is required; the rest only within the quarter.
		if _, err := planNear(c, w, home, typ, anchor, playedQuarterRadius); err != nil && i == 0 {
			return err
		}
	}
	planned := false
	for _, typ := range playedPlannedFarms {
		def := c.BuildingByID[typ]
		if def == nil || def.Fields == nil || c.FieldByType[def.Fields.Type] == nil {
			continue
		}
		field := c.FieldByType[def.Fields.Type]
		if f := field.Field.Fertility; f != "" && !slices.Contains(home.Fertilities, f) {
			continue
		}
		farm, err := planNear(c, w, home, typ, anchor, 3*playedQuarterRadius)
		if err != nil {
			continue
		}
		if planFields(c, w, home, farm, field.ID) > 0 {
			planned = true
			break
		}
		if err := sim.Apply(w, c, sim.Demolish{IslandID: home.ID, BuildingID: farm.ID}); err != nil {
			return err
		}
	}
	if !planned {
		return errors.New("no planned farm with planned fields")
	}
	// Planned fields at a real farm (the farm card's "build planned
	// fields"), where there is room.
	for _, b := range home.Buildings {
		def := c.BuildingByID[b.Type]
		if def == nil || def.Fields == nil || c.FieldByType[def.Fields.Type] == nil {
			continue
		}
		if planFields(c, w, home, b, c.FieldByType[def.Fields.Type].ID) > 0 {
			break
		}
	}
	return nil
}

func abs(x int) int {
	if x < 0 {
		return -x
	}
	return x
}

// playedQuarterRadius bounds the distance of a plan's centre from the
// quarter's anchor (tiles).
const playedQuarterRadius = 16

// planNear plans a building at the valid site nearest to anchor (its
// centre within radius tiles) and returns the plan.
func planNear(c *content.Catalogue, w *sim.World, is *sim.Island, typ string, anchor sim.Pos, radius int) (*sim.Building, error) {
	def := c.BuildingByID[typ]
	if def == nil {
		return nil, fmt.Errorf("unknown building %q", typ)
	}
	sc := sim.NewSiteChecker(is, c)
	for _, s := range layout.Candidates(is, def, anchor) {
		if s.D > 4*radius*radius {
			break
		}
		fw, fh := layout.Dims(def, s.Rot)
		if !sc.Valid(def, s.X, s.Y, s.Rot) || layout.CoversForest(is, s.X, s.Y, fw, fh) {
			continue
		}
		if sim.Apply(w, c, sim.PlaceBuilding{IslandID: is.ID, Type: typ, X: s.X, Y: s.Y, Rotation: s.Rot, Planned: true}) == nil {
			return is.Plans[len(is.Plans)-1], nil
		}
	}
	return nil, fmt.Errorf("no site for a planned %s", typ)
}

// planFields plans fields of typ around the farm (its ring and the ring
// around that) and returns how many were planned.
func planFields(c *content.Catalogue, w *sim.World, is *sim.Island, farm *sim.Building, typ string) int {
	def := c.BuildingByID[farm.Type]
	fw, fh := layout.Dims(def, farm.Rotation)
	tiles := append(layout.Ring(farm.X, farm.Y, fw, fh), layout.Ring(farm.X-1, farm.Y-1, fw+2, fh+2)...)
	var in []sim.Pos
	for _, p := range tiles {
		if is.InBounds(p.X, p.Y) {
			in = append(in, p)
		}
	}
	before := len(is.Plans)
	if _, err := sim.ApplyWithResult(w, c, sim.PlaceFields{IslandID: is.ID, FarmID: farm.ID, Type: typ, Tiles: in, Planned: true}, nil); err != nil {
		return 0
	}
	return len(is.Plans) - before
}
