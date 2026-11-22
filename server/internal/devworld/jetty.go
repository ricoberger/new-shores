package devworld

import (
	"fmt"
	"slices"

	"github.com/ricoberger/new-shores/server/internal/content"
	"github.com/ricoberger/new-shores/server/internal/layout"
	"github.com/ricoberger/new-shores/server/internal/sim"
)

// The settled fixture's jetty (D-085): a row of jetty tiles along the home
// island's coast with a fisher standing on it — the fisher's water rows
// on the open water in front, its land part on the jetty and the coast
// behind (the placement replaces the jetty under its footprint) — and the
// row running on jettyReach tiles to each side, so the boards show
// beside the fisher.
const (
	jettyType    = "jetty"
	jettyFisher  = "fisher"
	jettyReach   = 3
	jettyMaxRows = 3
	// jettySites is the number of fitting sites nearest the anchor among which the longest row is chosen.
	jettySites = 40
)

// jettyRow places the jetty row and its fisher on the island at a site
// near anchor (the longest row beside the fisher among the jettySites
// nearest) that a road connects and a warehouse reaches, where the fisher's land part needs between one and
// jettyMaxRows jetty rows (the same in every column), and connects the
// fisher by road. Every placement's cost is granted first. Content
// without the jetty (before 0.25.0) gets no row.
func jettyRow(f *fixture, island string, anchor sim.Pos) {
	if f.err != nil {
		return
	}
	jetty := f.c.BuildingByID[jettyType]
	fisher := f.c.BuildingByID[jettyFisher]
	if jetty == nil || fisher == nil || fisher.WaterRows == nil || !fisher.StandsOnRoad(jettyType) {
		return // content before D-085 (the API tests' testdata): no jetty row
	}
	is := f.w.Island(island)
	occ := is.Occupancy(f.c)
	free := func(p sim.Pos) bool {
		return is.InBounds(p.X, p.Y) && sim.Shallow(is, p.X, p.Y) && is.RoadAt(p.X, p.Y) == "" && is.PlannedRoadAt(p.X, p.Y) == "" && occ[p.Y*is.Width+p.X] == 0
	}
	land := func(p sim.Pos) bool {
		return is.InBounds(p.X, p.Y) && ownLand(is.Tile(p.X, p.Y).Terrain) && is.Tile(p.X, p.Y).Terrain != content.TerrainMountain
	}
	front := fisher.WaterRows.Min
	// The sites that fit, by the length of the row beside the fisher (the longest first), then by distance.
	type site struct {
		s     layout.Site
		tiles []sim.Pos
		side  int
	}
	var sites []site
	for _, s := range layout.Candidates(is, fisher, anchor) {
		rows := jettyRows(fisher, s, front, free, land)
		if rows == 0 {
			continue
		}
		// The jetty under the fisher's land part, then the landward row on to each side.
		var tiles []sim.Pos
		for col := range fisher.Width {
			for r := front; r < front+rows; r++ {
				tiles = append(tiles, waterPos(fisher, s.X, s.Y, s.Rot, col, r))
			}
		}
		last := front + rows - 1
		side := 0
		for _, dir := range []struct{ from, step int }{{-1, -1}, {fisher.Width, 1}} {
			for k, col := 0, dir.from; k < jettyReach; k, col = k+1, col+dir.step {
				p := waterPos(fisher, s.X, s.Y, s.Rot, col, last)
				if !free(p) {
					break
				}
				tiles = append(tiles, p)
				side++
			}
		}
		sites = append(sites, site{s, tiles, side})
		if len(sites) >= jettySites {
			break
		}
	}
	slices.SortStableFunc(sites, func(a, b site) int { return b.side - a.side })
	for _, st := range sites {
		s, tiles := st.s, st.tiles
		// The road from the street, found before the jetty is laid (a jetty is a road, but not yet a connected one).
		w, h := layout.Dims(fisher, s.Rot)
		path, ok := f.roadPath(island, s.X, s.Y, w, h)
		if !ok {
			continue
		}
		backup := f.w
		for range tiles {
			f.grant(island, &jetty.Cost)
		}
		f.grant(island, &fisher.Cost)
		if !f.try(sim.PlaceRoad{IslandID: island, Type: jettyType, Tiles: tiles}) {
			f.w = backup
			continue
		}
		if !f.try(sim.PlaceBuilding{IslandID: island, Type: jettyFisher, X: s.X, Y: s.Y, Rotation: s.Rot}) ||
			(len(path) > 0 && !f.try(sim.PlaceRoad{IslandID: island, Type: fixtureRoad, Tiles: path})) {
			f.w = backup
			continue
		}
		// A fisher no warehouse reaches (D-069) would stand idle: the next site.
		if b := f.w.Island(island).BuildingAt(f.c, s.X, s.Y); b == nil || b.OutOfReach {
			f.w = backup
			continue
		}
		return
	}
	f.err = fmt.Errorf("no site for the %s fixture's %s on a %s row on %s", FixtureSettled, jettyFisher, jettyType, island)
}

// jettyRows returns the number of jetty rows a fisher site needs (0: the
// site does not fit): in every column the front rows are free water, then
// the same number (1..jettyMaxRows) of free shallows, then land to the
// back.
func jettyRows(def *content.Building, s layout.Site, front int, free, land func(sim.Pos) bool) int {
	rows := -1
	for col := range def.Width {
		r := 0
		for ; r < front; r++ {
			if !free(waterPos(def, s.X, s.Y, s.Rot, col, r)) {
				return 0
			}
		}
		for r < def.Height && free(waterPos(def, s.X, s.Y, s.Rot, col, r)) {
			r++
		}
		n := r - front
		if n < 1 || n > jettyMaxRows || (rows >= 0 && n != rows) {
			return 0
		}
		rows = n
		for ; r < def.Height; r++ {
			if !land(waterPos(def, s.X, s.Y, s.Rot, col, r)) {
				return 0
			}
		}
	}
	return rows
}

// waterPos maps a column and a row from the front of a water-edge
// building to an island tile (sim's waterPosition: rotation 0 faces
// north, 90 east, 180 south, 270 west).
func waterPos(def *content.Building, x, y, rotation, column, row int) sim.Pos {
	switch rotation {
	case 90:
		return sim.Pos{X: x + def.Height - 1 - row, Y: y + column}
	case 180:
		return sim.Pos{X: x + column, Y: y + def.Height - 1 - row}
	case 270:
		return sim.Pos{X: x + row, Y: y + column}
	default:
		return sim.Pos{X: x + column, Y: y + row}
	}
}
