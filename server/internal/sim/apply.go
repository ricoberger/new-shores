package sim

import (
	"fmt"

	"github.com/ricoberger/new-shores/server/internal/content"
)

// Command is a player command applied with Apply.
type Command interface{ isCommand() }

// PlaceBuilding places a building. A building type with a road block is
// placed as a single road tile (see PlaceRoad).
type PlaceBuilding struct {
	IslandID string
	Type     string
	X, Y     int
	Rotation int
}

// PlaceRoad places road tiles of one road type, all or nothing.
type PlaceRoad struct {
	IslandID string
	Type     string
	Tiles    []Pos
}

// Demolish removes a building. When removing a warehouse would leave more
// goods than the remaining capacity, the command fails with ErrSurplusLoss
// unless AcceptSurplusLoss is set.
type Demolish struct {
	IslandID          string
	BuildingID        int64
	AcceptSurplusLoss bool
}

// DemolishRoad removes road tiles, all or nothing.
type DemolishRoad struct {
	IslandID string
	Tiles    []Pos
}

// SetPaused pauses or resumes a building. Pausing is allowed for buildings
// whose pause_category is not never; resuming for every paused building,
// whatever the reason.
type SetPaused struct {
	IslandID   string
	BuildingID int64
	Paused     bool
}

// UpgradeHouse upgrades a full house to the next tier's house (MECHANICS
// §6.1).
type UpgradeHouse struct {
	IslandID   string
	BuildingID int64
}

func (PlaceBuilding) isCommand() {}
func (PlaceRoad) isCommand()     {}
func (Demolish) isCommand()      {}
func (DemolishRoad) isCommand()  {}
func (SetPaused) isCommand()     {}
func (UpgradeHouse) isCommand()  {}

// Apply validates and executes a command at w.LastEvaluatedAt (the caller
// advances the world first). Every command validates completely before it
// mutates anything: on error the world is unchanged.
func Apply(w *World, c *content.Catalogue, cmd Command) error {
	return ApplyWithLedger(w, c, cmd, nil)
}

// ApplyWithLedger is Apply that records goods movements in l (may be nil).
// Tier unlocks are evaluated after every successful command.
func ApplyWithLedger(w *World, c *content.Catalogue, cmd Command, l *Ledger) error {
	var err error
	switch cmd := cmd.(type) {
	case PlaceBuilding:
		err = placeBuilding(w, c, cmd, true, l)
	case PlaceRoad:
		err = placeRoad(w, c, cmd, l)
	case Demolish:
		err = demolish(w, c, cmd, l)
	case DemolishRoad:
		err = demolishRoad(w, c, cmd, l)
	case SetPaused:
		err = setPaused(w, c, cmd)
	case UpgradeHouse:
		err = upgradeHouse(w, c, cmd, l)
	case nil:
		return fmt.Errorf("%w: nil command", ErrInvalidCommand)
	default:
		return fmt.Errorf("%w: %T", ErrInvalidCommand, cmd)
	}
	if err != nil {
		return err
	}
	evaluateUnlocks(w, c)
	return nil
}

// PlaceFree places a building without charging its cost. It is meant for
// world creation and seeding (e.g. the first warehouse delivered by ship,
// test scenarios), never for player commands.
func PlaceFree(w *World, c *content.Catalogue, cmd PlaceBuilding, l *Ledger) error {
	return placeBuilding(w, c, cmd, false, l)
}

// AddStock grants goods to an island inventory from outside the simulation
// (seeding, tests). It fails with ErrOverCapacity when stock plus in-transit
// would exceed the capacity.
func AddStock(w *World, c *content.Catalogue, islandID, good string, qty Qty, l *Ledger) error {
	is := w.Island(islandID)
	if is == nil {
		return fmt.Errorf("%w: %q", ErrUnknownIsland, islandID)
	}
	if c.GoodByID[good] == nil {
		return fmt.Errorf("%w: unknown good %q", ErrInvalidCommand, good)
	}
	if qty < 0 {
		return fmt.Errorf("%w: negative quantity", ErrInvalidCommand)
	}
	now := w.LastEvaluatedAt.UnixMilli()
	// Compare in milli-units before scaling so that huge quantities cannot
	// overflow: qty*SubPerMilli <= free  <=>  qty <= free/SubPerMilli.
	free := capacityFine(is, c) - committedFine(is, good, now)
	if free < 0 || qty > free/SubPerMilli {
		return fmt.Errorf("%w: %s", ErrOverCapacity, good)
	}
	add := qty * SubPerMilli
	is.Inventory.setFine(good, is.Inventory.fine(good)+add)
	l.flow(is.ID, good).Granted += add
	clearRegimes(is)
	return nil
}

func lookupIsland(w *World, id string) (*Island, error) {
	is := w.Island(id)
	if is == nil {
		return nil, fmt.Errorf("%w: %q", ErrUnknownIsland, id)
	}
	return is, nil
}

// checkTiles validates that every tile is on the island, has buildable
// terrain and carries neither a building nor a road.
func checkTiles(is *Island, occ []int64, tiles []Pos) error {
	for _, p := range tiles {
		if !is.InBounds(p.X, p.Y) {
			return fmt.Errorf("%w: (%d,%d)", ErrOutOfBounds, p.X, p.Y)
		}
	}
	for _, p := range tiles {
		i := is.index(p.X, p.Y)
		if !buildableTerrain(is.Tiles[i].Terrain) {
			return fmt.Errorf("%w: (%d,%d) is %s", ErrTerrain, p.X, p.Y, is.Tiles[i].Terrain)
		}
		if occ[i] != 0 || is.Roads[i] != "" {
			return fmt.Errorf("%w: (%d,%d)", ErrOccupied, p.X, p.Y)
		}
	}
	return nil
}

// checkCost validates that gold and the island's materials cover n times the
// cost.
func checkCost(w *World, is *Island, cost content.Cost, n int64) error {
	if cost.Gold*n > w.Gold {
		return fmt.Errorf("%w: need %d, have %d milli-gold", ErrInsufficientGold, cost.Gold*n, w.Gold)
	}
	for _, m := range cost.Materials {
		if have := is.Inventory.Stock[m.Good]; m.Amount*n > have {
			return fmt.Errorf("%w: need %d %s, have %d (milli-units)", ErrInsufficientMaterials, m.Amount*n, m.Good, have)
		}
	}
	return nil
}

func chargeCost(w *World, is *Island, cost content.Cost, n int64, l *Ledger) {
	w.Gold -= cost.Gold * n
	for _, m := range cost.Materials {
		amount := m.Amount * n * SubPerMilli
		is.Inventory.setFine(m.Good, is.Inventory.fine(m.Good)-amount)
		l.flow(is.ID, m.Good).Spent += amount
	}
}

func placeBuilding(w *World, c *content.Catalogue, cmd PlaceBuilding, charge bool, l *Ledger) error {
	is, err := lookupIsland(w, cmd.IslandID)
	if err != nil {
		return err
	}
	def := c.BuildingByID[cmd.Type]
	if def == nil {
		return fmt.Errorf("%w: %q", ErrUnknownBuilding, cmd.Type)
	}
	if charge && !TierUnlocked(w, c, def.Tier) {
		return fmt.Errorf("%w: %s needs tier %s", ErrTierLocked, def.ID, def.Tier)
	}
	if def.Road != nil {
		if !charge {
			return fmt.Errorf("%w: roads cannot be placed free", ErrInvalidCommand)
		}
		return placeRoad(w, c, PlaceRoad{IslandID: cmd.IslandID, Type: cmd.Type, Tiles: []Pos{{cmd.X, cmd.Y}}}, l)
	}
	if !validRotation(cmd.Rotation) {
		return fmt.Errorf("%w: rotation %d", ErrInvalidCommand, cmd.Rotation)
	}

	fw, fh := footprint(def, cmd.Rotation)
	tiles := make([]Pos, 0, fw*fh)
	for y := cmd.Y; y < cmd.Y+fh; y++ {
		for x := cmd.X; x < cmd.X+fw; x++ {
			tiles = append(tiles, Pos{x, y})
		}
	}
	occ := is.occupancy(c)
	if err := checkTiles(is, occ, tiles); err != nil {
		return err
	}
	if def.Coastal {
		coastal := false
		for _, p := range tiles {
			if is.Tile(p.X, p.Y).Terrain == content.TerrainCoast {
				coastal = true
				break
			}
		}
		if !coastal {
			return fmt.Errorf("%w: %s at (%d,%d)", ErrNotCoastal, def.ID, cmd.X, cmd.Y)
		}
	}
	if def.RequiresRoad && len(is.roadsAt(entrance(def, cmd.X, cmd.Y, cmd.Rotation))) == 0 {
		e := entrance(def, cmd.X, cmd.Y, cmd.Rotation)
		return fmt.Errorf("%w: entrance (%d,%d)", ErrNoRoadAtEntrance, e.X, e.Y)
	}
	if def.WorkArea != nil && workAreaEfficiency(is, occ, def, cmd.X, cmd.Y, cmd.Rotation) == 0 {
		return fmt.Errorf("%w: %s at (%d,%d)", ErrNoWorkArea, def.ID, cmd.X, cmd.Y)
	}
	if charge {
		if err := checkCost(w, is, def.Cost, 1); err != nil {
			return err
		}
	}

	// Validation complete: mutate.
	if charge {
		chargeCost(w, is, def.Cost, 1, l)
	}
	if w.NextBuildingID < 1 {
		w.NextBuildingID = 1
	}
	b := &Building{ID: w.NextBuildingID, Type: def.ID, X: cmd.X, Y: cmd.Y, Rotation: cmd.Rotation, Efficiency: 1000}
	w.NextBuildingID++
	if def.Warehouse != nil {
		b.Level = 1
	}
	if def.House != nil {
		if tier := c.TierByID[def.House.Tier]; tier != nil {
			b.House = &HouseState{Residents: tier.ResidentsFloor}
		}
	}
	is.Buildings = append(is.Buildings, b)
	afterChange(is, c)
	return nil
}

func placeRoad(w *World, c *content.Catalogue, cmd PlaceRoad, l *Ledger) error {
	is, err := lookupIsland(w, cmd.IslandID)
	if err != nil {
		return err
	}
	def := c.BuildingByID[cmd.Type]
	if def == nil {
		return fmt.Errorf("%w: %q", ErrUnknownBuilding, cmd.Type)
	}
	if def.Road == nil {
		return fmt.Errorf("%w: %q is not a road", ErrInvalidCommand, cmd.Type)
	}
	if !TierUnlocked(w, c, def.Tier) {
		return fmt.Errorf("%w: %s needs tier %s", ErrTierLocked, def.ID, def.Tier)
	}
	if len(cmd.Tiles) == 0 {
		return fmt.Errorf("%w: no tiles", ErrInvalidCommand)
	}
	seen := map[Pos]bool{}
	for _, p := range cmd.Tiles {
		if seen[p] {
			return fmt.Errorf("%w: duplicate tile (%d,%d)", ErrInvalidCommand, p.X, p.Y)
		}
		seen[p] = true
	}
	if err := checkTiles(is, is.occupancy(c), cmd.Tiles); err != nil {
		return err
	}
	n := int64(len(cmd.Tiles))
	if err := checkCost(w, is, def.Cost, n); err != nil {
		return err
	}

	chargeCost(w, is, def.Cost, n, l)
	if is.Roads == nil {
		is.Roads = map[int]string{}
	}
	for _, p := range cmd.Tiles {
		is.Roads[is.index(p.X, p.Y)] = def.ID
	}
	afterChange(is, c)
	return nil
}

// refundAmount is the demolition refund of a material: 50 % of the cost,
// rounded down to whole units (D-019).
func refundAmount(cost Qty) Qty {
	return cost / 2 / content.MilliPerUnit * content.MilliPerUnit
}

// refund adds the demolition refund to the island inventory, clamped to the
// free committed capacity; the clamped excess is lost.
func refund(is *Island, c *content.Catalogue, cost content.Cost, n int64, l *Ledger, now int64) {
	for _, m := range cost.Materials {
		amount := refundAmount(m.Amount) * n * SubPerMilli
		if amount == 0 {
			continue
		}
		free := max(capacityFine(is, c)-committedFine(is, m.Good, now), 0)
		take := min(amount, free)
		is.Inventory.setFine(m.Good, is.Inventory.fine(m.Good)+take)
		f := l.flow(is.ID, m.Good)
		f.Refunded += amount
		f.Lost += amount - take
	}
}

func demolish(w *World, c *content.Catalogue, cmd Demolish, l *Ledger) error {
	is, err := lookupIsland(w, cmd.IslandID)
	if err != nil {
		return err
	}
	b := is.Building(cmd.BuildingID)
	if b == nil {
		return fmt.Errorf("%w: building %d on island %q", ErrBuildingNotFound, cmd.BuildingID, cmd.IslandID)
	}
	def := c.BuildingByID[b.Type]
	if def == nil {
		return fmt.Errorf("%w: %q", ErrUnknownBuilding, b.Type)
	}
	now := w.LastEvaluatedAt.UnixMilli()

	// Capacity after demolition. The demolished building's own in-transit
	// goods are delivered, which leaves committed quantities unchanged.
	newCap := capacityFine(is, c)
	if def.Warehouse != nil {
		newCap -= warehouseLevel(def, b).Capacity * SubPerMilli
	}
	var surplus []string
	for _, good := range goodsOnIsland(is) {
		if committedFine(is, good, now) > newCap {
			surplus = append(surplus, good)
		}
	}
	if len(surplus) > 0 && !cmd.AcceptSurplusLoss {
		return fmt.Errorf("%w: %v", ErrSurplusLoss, surplus)
	}

	// Validation complete: mutate.
	for _, good := range transitGoods(b) {
		amount := b.transitFine(good, now)
		is.Inventory.setFine(good, is.Inventory.fine(good)+amount)
	}
	b.Transit = nil
	for _, good := range sortedKeys(b.Buffer, b.BufferSub) {
		l.flow(is.ID, good).Lost += b.bufferFine(good)
	}
	removeBuilding(is, b.ID)

	for _, good := range surplus {
		// Accepted surplus loss: deliver the good's remaining transit
		// immediately, then clamp the stock to the new capacity.
		for _, ob := range is.Buildings {
			amount := ob.transitFine(good, now)
			is.Inventory.setFine(good, is.Inventory.fine(good)+amount)
			ob.Transit = dropTransit(ob.Transit, good)
		}
		if stock := is.Inventory.fine(good); stock > newCap {
			is.Inventory.setFine(good, newCap)
			l.flow(is.ID, good).Lost += stock - newCap
		}
	}
	refund(is, c, def.Cost, 1, l, now)
	afterChange(is, c)
	return nil
}

func demolishRoad(w *World, c *content.Catalogue, cmd DemolishRoad, l *Ledger) error {
	is, err := lookupIsland(w, cmd.IslandID)
	if err != nil {
		return err
	}
	if len(cmd.Tiles) == 0 {
		return fmt.Errorf("%w: no tiles", ErrInvalidCommand)
	}
	seen := map[Pos]bool{}
	count := map[string]int64{}
	for _, p := range cmd.Tiles {
		if !is.InBounds(p.X, p.Y) {
			return fmt.Errorf("%w: (%d,%d)", ErrOutOfBounds, p.X, p.Y)
		}
		if seen[p] {
			return fmt.Errorf("%w: duplicate tile (%d,%d)", ErrInvalidCommand, p.X, p.Y)
		}
		seen[p] = true
		rt := is.RoadAt(p.X, p.Y)
		if rt == "" {
			return fmt.Errorf("%w: (%d,%d)", ErrNoRoad, p.X, p.Y)
		}
		count[rt]++
	}

	now := w.LastEvaluatedAt.UnixMilli()
	for _, p := range cmd.Tiles {
		delete(is.Roads, is.index(p.X, p.Y))
	}
	if len(is.Roads) == 0 {
		is.Roads = nil
	}
	for _, rt := range sortedKeys(count) {
		if def := c.BuildingByID[rt]; def != nil {
			refund(is, c, def.Cost, count[rt], l, now)
		}
	}
	afterChange(is, c)
	return nil
}

func setPaused(w *World, c *content.Catalogue, cmd SetPaused) error {
	is, err := lookupIsland(w, cmd.IslandID)
	if err != nil {
		return err
	}
	b := is.Building(cmd.BuildingID)
	if b == nil {
		return fmt.Errorf("%w: building %d on island %q", ErrBuildingNotFound, cmd.BuildingID, cmd.IslandID)
	}
	def := c.BuildingByID[b.Type]
	pausable := def != nil && pauseRank(def.PauseCategory) > 0
	switch {
	case cmd.Paused && !pausable:
		return fmt.Errorf("%w: %s", ErrNotPausable, b.Type)
	case cmd.Paused:
		b.Paused, b.PausedReason, b.PauseSeq = true, PausedReasonPlayer, 0
	case b.Paused:
		// Resuming is allowed for any paused building, player or unpaid
		// (MECHANICS §14). An unpaid building resumed while the balance is
		// still negative is paused again at the next settle.
		b.Paused, b.PausedReason, b.PauseSeq = false, "", 0
	case !pausable:
		return fmt.Errorf("%w: %s", ErrNotPausable, b.Type)
	}
	clearRegimes(is)
	return nil
}

func upgradeHouse(w *World, c *content.Catalogue, cmd UpgradeHouse, l *Ledger) error {
	is, err := lookupIsland(w, cmd.IslandID)
	if err != nil {
		return err
	}
	b := is.Building(cmd.BuildingID)
	if b == nil {
		return fmt.Errorf("%w: building %d on island %q", ErrBuildingNotFound, cmd.BuildingID, cmd.IslandID)
	}
	def := c.BuildingByID[b.Type]
	tier := houseTier(b, c)
	if def == nil || tier == nil {
		return fmt.Errorf("%w: %s", ErrNotAHouse, b.Type)
	}
	var next *content.Tier
	if tier.Index+1 < len(c.Tiers) {
		next = c.Tiers[tier.Index+1]
	}
	if next == nil || next.House == "" || c.BuildingByID[next.House] == nil {
		return fmt.Errorf("%w: no house of the next tier after %s", ErrUpgradeUnavailable, tier.ID)
	}
	nextDef := c.BuildingByID[next.House]
	if !TierUnlocked(w, c, next.ID) {
		return fmt.Errorf("%w: %s", ErrTierLocked, next.ID)
	}
	if b.House.Residents < tier.ResidentsMax {
		return fmt.Errorf("%w: %d of %d milli-residents", ErrHouseNotFull, b.House.Residents, tier.ResidentsMax)
	}
	if need := unmetRequiredNeed(w, c, is, b.ID); need != "" {
		return fmt.Errorf("%w: %s", ErrNeedsUnmet, need)
	}
	if nextDef.Width != def.Width || nextDef.Height != def.Height {
		return fmt.Errorf("%w: footprint of %s differs", ErrUpgradeUnavailable, nextDef.ID)
	}
	if err := checkCost(w, is, nextDef.Cost, 1); err != nil {
		return err
	}

	// Validation complete: mutate.
	chargeCost(w, is, nextDef.Cost, 1, l)
	b.Type = nextDef.ID
	b.House = &HouseState{Residents: next.ResidentsFloor}
	afterChange(is, c)
	return nil
}

// unmetRequiredNeed returns the ID of the first required need of the house
// that is not fully met at this instant ("" when all are met). It settles a
// copy of the world, so the world itself is not changed.
func unmetRequiredNeed(w *World, c *content.Catalogue, is *Island, id int64) string {
	cw := w.Clone()
	wr, _ := settleWorld(cw, c, cw.LastEvaluatedAt.UnixMilli())
	for i, cis := range cw.Islands {
		if cis.ID != is.ID {
			continue
		}
		for _, h := range wr.islands[i].houses {
			if h.b.ID != id {
				continue
			}
			for _, n := range h.needs {
				if n.need.Kind != content.NeedOptional && n.fulfilment < ppm {
					return n.need.ID
				}
			}
		}
	}
	return ""
}

// afterChange recomputes derived placement state after a map change.
func afterChange(is *Island, c *content.Catalogue) {
	recomputeEfficiency(is, c)
	recomputeConnectivity(is, c)
	clearRegimes(is)
}

// clearRegimes resets the starved/full regimes of an island. Every command
// can change capacities, stocks or rates discontinuously, so the regimes are
// re-derived from the state by the next Advance or Display.
func clearRegimes(is *Island) {
	is.Inventory.Starved = nil
	is.Inventory.Full = nil
}

func removeBuilding(is *Island, id int64) {
	out := is.Buildings[:0]
	for _, b := range is.Buildings {
		if b.ID != id {
			out = append(out, b)
		}
	}
	if len(out) == 0 {
		out = nil
	}
	is.Buildings = out
}

func transitGoods(b *Building) []string {
	set := map[string]bool{}
	for _, s := range b.Transit {
		set[s.Good] = true
	}
	return sortedKeys(set)
}

func dropTransit(segs []TransitSegment, good string) []TransitSegment {
	var out []TransitSegment
	for _, s := range segs {
		if s.Good != good {
			out = append(out, s)
		}
	}
	return out
}

// goodsOnIsland returns the goods with stock or in-transit on the island.
func goodsOnIsland(is *Island) []string {
	set := map[string]bool{}
	for g := range is.Inventory.Stock {
		set[g] = true
	}
	for g := range is.Inventory.StockSub {
		set[g] = true
	}
	for _, b := range is.Buildings {
		for _, s := range b.Transit {
			set[s.Good] = true
		}
	}
	return sortedKeys(set)
}
