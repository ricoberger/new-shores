package sim

import (
	"cmp"
	"fmt"
	"maps"
	"slices"

	"github.com/ricoberger/new-shores/server/internal/content"
)

// MoveGroup moves everything whose footprint lies fully inside a
// rectangle of an island by one offset, optionally turned (D-074 §5,
// MECHANICS §2): buildings, fields, paint tiles, plans, road and planned
// road tiles. X0, Y0, X1, Y1 are the rectangle's inclusive corners (any
// order); DX, DY the offset of its top-left corner; Rotation (0, 90, 180
// or 270, clockwise like a building's) turns the group about the
// rectangle, whose turned top-left lands at (min X + DX, min Y + DY).
// All or nothing, free of charge like MoveBuilding: every piece must be
// valid at its new site with the pieces that stay and the other moved
// ones (tiles vacated by the move count as free), else the move fails
// with the first failing piece's error (GroupMoveError). Buildings keep
// their IDs and state, fields their farm; paint tiles keep rotation 0.
// Pieces only partly inside the rectangle stay where they are.
type MoveGroup struct {
	IslandID       string
	X0, Y0, X1, Y1 int
	DX, DY         int
	Rotation       int
}

func (MoveGroup) isCommand() {}

// GroupMoveError is the error of a rejected MoveGroup: the first failing
// piece — a building or plan (BuildingID, its new top-left X, Y) or a
// road tile (BuildingID 0, the tile's new position) — and the rule's
// sentinel error (Unwrap).
type GroupMoveError struct {
	BuildingID int64
	X, Y       int
	Err        error
}

func (e *GroupMoveError) Error() string {
	if e.BuildingID == 0 {
		return fmt.Sprintf("group move: road at (%d,%d): %v", e.X, e.Y, e.Err)
	}
	return fmt.Sprintf("group move: building %d at (%d,%d): %v", e.BuildingID, e.X, e.Y, e.Err)
}

func (e *GroupMoveError) Unwrap() error { return e.Err }

// groupFrame maps the rectangle's tiles to the target (rotation-aware).
type groupFrame struct {
	x0, y0, w, h int // the source rectangle
	tx, ty, rot  int // the target's top-left and the turn
}

// rect maps a tile rectangle (x, y, w, h) inside the source to the target.
func (f groupFrame) rect(x, y, w, h int) (int, int) {
	u, v := x-f.x0, y-f.y0
	switch f.rot {
	case 90:
		u, v = f.h-v-h, u
	case 180:
		u, v = f.w-u-w, f.h-v-h
	case 270:
		u, v = v, f.w-u-w
	}
	return f.tx + u, f.ty + v
}

// inside reports whether the tile rectangle lies fully inside the source.
func (f groupFrame) inside(x, y, w, h int) bool {
	return x >= f.x0 && y >= f.y0 && x+w <= f.x0+f.w && y+h <= f.y0+f.h
}

// groupPiece is a moved building or plan: the original and its copy at
// the new site.
type groupPiece struct {
	orig, at *Building
	def      *content.Building
	plan     bool
}

func moveGroup(w *World, c *content.Catalogue, cmd MoveGroup) error {
	is, err := lookupIsland(w, cmd.IslandID)
	if err != nil {
		return err
	}
	if !validRotation(cmd.Rotation) {
		return fmt.Errorf("%w: rotation %d", ErrInvalidCommand, cmd.Rotation)
	}
	x0, x1 := min(cmd.X0, cmd.X1), max(cmd.X0, cmd.X1)
	y0, y1 := min(cmd.Y0, cmd.Y1), max(cmd.Y0, cmd.Y1)
	if x0 < 0 || y0 < 0 || x1 >= is.Width || y1 >= is.Height {
		return fmt.Errorf("%w: rectangle (%d,%d)-(%d,%d)", ErrOutOfBounds, x0, y0, x1, y1)
	}
	// Bound the offset so that tile arithmetic cannot overflow; anything
	// beyond the island fails the footprint checks anyway.
	if cmd.DX < -is.Width || cmd.DX > is.Width || cmd.DY < -is.Height || cmd.DY > is.Height {
		return fmt.Errorf("%w: offset (%d,%d)", ErrOutOfBounds, cmd.DX, cmd.DY)
	}
	f := groupFrame{x0: x0, y0: y0, w: x1 - x0 + 1, h: y1 - y0 + 1, tx: x0 + cmd.DX, ty: y0 + cmd.DY, rot: cmd.Rotation}

	// The group: pieces fully inside the rectangle, road tiles in it.
	after := *is
	after.Buildings, after.Plans = nil, nil
	var pieces []groupPiece
	for _, plan := range []bool{false, true} {
		list := is.Buildings
		if plan {
			list = is.Plans
		}
		for _, b := range list {
			def := c.BuildingByID[b.Type]
			bw, bh := 1, 1
			if def != nil {
				bw, bh = footprint(def, b.Rotation)
			}
			if def == nil || def.Road != nil || !f.inside(b.X, b.Y, bw, bh) {
				if plan {
					after.Plans = append(after.Plans, b)
				} else {
					after.Buildings = append(after.Buildings, b)
				}
				continue
			}
			at := *b
			at.X, at.Y = f.rect(b.X, b.Y, bw, bh)
			if def.PaintFamily == nil {
				at.Rotation = (b.Rotation + cmd.Rotation) % 360
			}
			pieces = append(pieces, groupPiece{orig: b, at: &at, def: def, plan: plan})
		}
	}
	type roadTile struct {
		to      Pos
		typ     string
		planned bool
	}
	var roads []roadTile
	after.Roads, after.PlannedRoads = maps.Clone(is.Roads), maps.Clone(is.PlannedRoads)
	for _, planned := range []bool{false, true} {
		src := is.Roads
		dst := after.Roads
		if planned {
			src, dst = is.PlannedRoads, after.PlannedRoads
		}
		for _, i := range slices.Sorted(maps.Keys(src)) {
			x, y := i%is.Width, i/is.Width
			if !f.inside(x, y, 1, 1) {
				continue
			}
			tx, ty := f.rect(x, y, 1, 1)
			roads = append(roads, roadTile{to: Pos{tx, ty}, typ: src[i], planned: planned})
			delete(dst, i)
		}
	}
	if len(pieces) == 0 && len(roads) == 0 {
		return fmt.Errorf("%w: nothing to move in (%d,%d)-(%d,%d)", ErrInvalidCommand, x0, y0, x1, y1)
	}
	fail := func(b *Building, err error) error {
		return &GroupMoveError{BuildingID: b.ID, X: b.X, Y: b.Y, Err: err}
	}
	failRoad := func(p Pos, err error) error {
		return &GroupMoveError{X: p.X, Y: p.Y, Err: err}
	}

	// The moved buildings and plans stand at their new sites; the moved
	// roads are checked against them and what stays.
	for _, p := range pieces {
		if p.plan {
			after.Plans = append(after.Plans, p.at)
		} else {
			after.Buildings = append(after.Buildings, p.at)
		}
	}
	byID := func(a, b *Building) int { return cmp.Compare(a.ID, b.ID) }
	slices.SortFunc(after.Buildings, byID)
	slices.SortFunc(after.Plans, byID)
	occ := after.roadOccupancy(c)
	byType := map[string][]Pos{}
	var quays []Pos
	for _, r := range roads {
		def := c.BuildingByID[r.typ]
		if def == nil || def.Road == nil {
			return failRoad(r.to, fmt.Errorf("%w: %q", ErrUnknownBuilding, r.typ))
		}
		var err error
		if def.Road.Shallows {
			err = checkQuayTiles(&after, occ, []Pos{r.to})
		} else {
			err = checkTiles(&after, occ, []Pos{r.to}, allowRiver)
		}
		if err != nil {
			return failRoad(r.to, err)
		}
		if def.Road.Shallows {
			quays = append(quays, r.to)
		}
		if !r.planned {
			byType[r.typ] = append(byType[r.typ], r.to)
		}
	}
	for _, r := range roads {
		m := &after.Roads
		if r.planned {
			m = &after.PlannedRoads
		}
		if *m == nil {
			*m = map[int]string{}
		}
		(*m)[after.index(r.to.X, r.to.Y)] = r.typ
	}
	for _, typ := range slices.Sorted(maps.Keys(byType)) {
		if c.BuildingByID[typ].Road.Shallows {
			continue
		}
		if err := checkBridges(&after, byType[typ]); err != nil {
			return failRoad(byType[typ][0], err)
		}
	}

	// Every moved building and plan at its new site, in ID order: its own
	// tiles count as free, the rest of the group as placed.
	slices.SortFunc(pieces, func(a, b groupPiece) int { return cmp.Compare(a.orig.ID, b.orig.ID) })
	for _, p := range pieces {
		occ := after.occupancy(c)
		for i, id := range occ {
			if id == p.at.ID {
				occ[i] = 0
			}
		}
		var err error
		if p.def.Field != nil {
			err = checkGroupField(&after, occ, p.def, p.at)
		} else {
			err = checkSite(&after, c, occ, p.def, p.at.X, p.at.Y, p.at.Rotation)
		}
		if err == nil {
			err = checkHarbourLane(&after, c, p.def, p.at.X, p.at.Y, p.at.Rotation, p.at.ID)
		}
		if err != nil {
			return fail(p.at, err)
		}
	}
	if err := checkQuayLane(&after, c, quays); err != nil {
		return failRoad(quays[0], err)
	}
	// A building on a quay replaces it (D-060).
	for _, p := range pieces {
		if !p.plan {
			clearQuay(&after, c, p.def, p.at)
		}
	}
	// The harbour stays open (D-060, D-077 §8) and every quay anchored.
	if harbourRoutable(c, is) && !harbourRoutable(c, &after) {
		err := fmt.Errorf("%w: the group move would close the harbour of %q", ErrHarbourBlocked, is.ID)
		for _, p := range pieces {
			if p.orig.Berths > 0 || p.def.Shore() {
				return fail(p.at, err)
			}
		}
		if len(quays) > 0 {
			return failRoad(quays[0], err)
		}
		return err
	}
	if len(quays) > 0 {
		if err := checkQuaysConnected(&after, c, after.Roads, quays); err != nil {
			return failRoad(quays[0], err)
		}
	}
	if err := checkQuaysStay(is, &after, c); err != nil {
		return err
	}

	// Validation complete: mutate. The buildings keep their identity.
	for _, p := range pieces {
		p.orig.X, p.orig.Y, p.orig.Rotation = p.at.X, p.at.Y, p.at.Rotation
	}
	is.Roads, is.PlannedRoads = after.Roads, after.PlannedRoads
	if len(is.Roads) == 0 {
		is.Roads = nil
	}
	if len(is.PlannedRoads) == 0 {
		is.PlannedRoads = nil
	}
	for _, p := range pieces {
		if !p.plan {
			clearQuay(is, c, p.def, p.orig)
		}
	}
	afterChange(is, c)
	return nil
}

// checkGroupField validates a field moved with a group at its new site:
// on the island, on the field's terrain, free (occ, roads) and with the
// island's fertility. It keeps its farm; whether its chain still reaches
// the farm is derived state (Inactive), as after any change.
func checkGroupField(is *Island, occ []int64, def *content.Building, b *Building) error {
	w, h := footprint(def, b.Rotation)
	if b.X < 0 || b.Y < 0 || b.X > is.Width-w || b.Y > is.Height-h {
		return fmt.Errorf("%w: %s footprint at (%d,%d)", ErrOutOfBounds, def.ID, b.X, b.Y)
	}
	for ty := b.Y; ty < b.Y+h; ty++ {
		for tx := b.X; tx < b.X+w; tx++ {
			i := is.index(tx, ty)
			if t := is.Tiles[i].Terrain; !def.Field.MatchesTerrain(t) {
				return fmt.Errorf("%w: %s at (%d,%d) cannot stand on %s", ErrTerrain, def.ID, tx, ty, t)
			}
			if occ[i] != 0 || is.roadOrPlan(i) {
				return fmt.Errorf("%w: (%d,%d)", ErrOccupied, tx, ty)
			}
		}
	}
	return checkFertility(is, def.ID, def.Field.Fertility)
}
