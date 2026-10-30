package sim

import (
	"fmt"
	"maps"
	"math"
	"strings"

	"github.com/ricoberger/new-shores/server/internal/content"
)

// Command is a player command applied with Apply.
type Command interface{ isCommand() }

// PlaceBuilding places a building. A building type with a road block is
// placed as a single road tile (see PlaceRoad). Placement never requires a
// road (D-042): a building without an adjacent road is not connected.
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

// UpgradeBuilding upgrades any upgradable building (D-056): a full house to
// the next tier's house (as UpgradeHouse); a Trading Post, Warehouse or
// public building with levels (market) to its next level, charged
// like a placement; a level may need a tier unlocked. UpgradeHouse,
// UpgradeWarehouse and UpgradeTradingPost are its deprecated aliases (the
// latter two keep their building-kind check).
type UpgradeBuilding struct {
	IslandID   string
	BuildingID int64
}

// UpgradeWarehouse raises a Warehouse (inland collector) to its next level
// (MECHANICS §5): the next level's cost is charged like a placement (gold
// from the world, materials from the island); throughput changes at once.
type UpgradeWarehouse struct {
	IslandID   string
	BuildingID int64
}

// UpgradeTradingPost raises the Trading Post to its next level (MECHANICS
// §5, §9.3): charged like UpgradeWarehouse; capacity, throughput and berths
// change at once (waiting ships may be granted a berth at once).
type UpgradeTradingPost struct {
	IslandID   string
	BuildingID int64
}

// MoveBuilding moves a building to another position and rotation on the
// same island, free of charge (MECHANICS §2, D-042). X, Y is the top-left
// tile of the rotated footprint. The building keeps its ID and all state;
// goods in transit keep arriving. Roads cannot be moved.
type MoveBuilding struct {
	IslandID   string
	BuildingID int64
	X, Y       int
	Rotation   int
}

func (PlaceBuilding) isCommand()      {}
func (MoveBuilding) isCommand()       {}
func (PlaceRoad) isCommand()          {}
func (Demolish) isCommand()           {}
func (DemolishRoad) isCommand()       {}
func (SetPaused) isCommand()          {}
func (UpgradeHouse) isCommand()       {}
func (UpgradeBuilding) isCommand()    {}
func (UpgradeWarehouse) isCommand()   {}
func (UpgradeTradingPost) isCommand() {}

// Apply validates and executes a command at w.LastEvaluatedAt (the caller
// advances the world first). Every command validates completely before it
// mutates anything: on error the world is unchanged.
func Apply(w *World, c *content.Catalogue, cmd Command) error {
	return ApplyWithLedger(w, c, cmd, nil)
}

// ApplyWithLedger is Apply that records goods movements in l (may be nil).
// Tier unlocks and quests are evaluated after every successful command.
// The effects of a successful command on gold, population and lost goods
// also go into the away summary accumulator (World.Away), so that a summary
// produced right after a command still reports the state at LastSeenAt.
func ApplyWithLedger(w *World, c *content.Catalogue, cmd Command, l *Ledger) error {
	_, err := ApplyWithResult(w, c, cmd, l)
	return err
}

// Result is the outcome of a successful command beyond the world change:
// the per-tile results of a batch command (PlaceFields, DemolishFields;
// nil for every other command). Unchanged is set when the command
// succeeded without changing the world (a PlaceFields or DemolishFields
// without a valid tile): there is nothing to commit or publish.
type Result struct {
	Tiles     []TileResult
	Unchanged bool
}

// ApplyWithResult is ApplyWithLedger that also returns the command's
// result (the per-tile outcome of batch commands).
func ApplyWithResult(w *World, c *content.Catalogue, cmd Command, l *Ledger) (Result, error) {
	gold, pop := w.goldFine(), worldPopulation(w, c)
	inner := NewLedger()
	res, err := applyCommand(w, c, cmd, inner)
	if err != nil {
		return Result{}, err
	}
	w.Away.GoldDeltaSub += w.goldFine() - gold
	delta := worldPopulation(w, c)
	for tier, n := range pop {
		delta[tier] -= n
	}
	w.Away.addPopulation(delta)
	w.Away.addLedger(inner)
	l.merge(inner)
	return res, nil
}

func applyCommand(w *World, c *content.Catalogue, cmd Command, l *Ledger) (Result, error) {
	var (
		err error
		res Result
	)
	switch cmd := cmd.(type) {
	case PlaceBuilding:
		err = placeBuilding(w, c, cmd, true, l)
	case MoveBuilding:
		err = moveBuilding(w, c, cmd)
	case PlaceRoad:
		err = placeRoad(w, c, cmd, l)
	case Demolish:
		err = demolish(w, c, cmd, l)
	case DemolishRoad:
		err = demolishRoad(w, c, cmd, l)
	case PlaceField:
		err = placeField(w, c, cmd, true, l)
	case PlaceFields:
		res.Tiles, err = placeFields(w, c, cmd, true, l)
		res.Unchanged = err == nil && noTileApplied(res.Tiles)
	case DemolishFields:
		res.Tiles, err = demolishFields(w, c, cmd, l)
		res.Unchanged = err == nil && noTileApplied(res.Tiles)
	case SetPaused:
		err = setPaused(w, c, cmd)
	case UpgradeHouse:
		err = upgradeHouse(w, c, cmd, l)
	case UpgradeBuilding:
		err = upgradeBuilding(w, c, cmd, l)
	case UpgradeWarehouse:
		err = upgradeCollector(w, c, cmd.IslandID, cmd.BuildingID, false, l)
	case UpgradeTradingPost:
		err = upgradeCollector(w, c, cmd.IslandID, cmd.BuildingID, true, l)
	case OrderShip:
		err = orderShip(w, c, cmd, l)
	case CancelShipOrder:
		err = cancelShipOrder(w, c, cmd, l)
	case FoundIsland:
		err = foundIsland(w, c, cmd, l)
	case AssignShip:
		err = assignShip(w, c, cmd, l)
	case UnassignShip:
		err = unassignShip(w, cmd)
	case ManualShipment:
		err = manualShipment(w, c, cmd, l)
	case ScrapShip:
		err = scrapShip(w, c, cmd, l)
	case RenameShip:
		err = renameShip(w, c, cmd)
	case SailShip:
		err = sailShip(w, c, cmd)
	case CreateRoute:
		err = createRoute(w, c, cmd)
	case UpdateRoute:
		err = updateRoute(w, c, cmd)
	case DeleteRoute:
		err = deleteRoute(w, cmd)
	case ClaimQuest:
		err = claimQuest(w, c, cmd, l)
	case AckSummary:
		ackSummary(w, cmd)
	case RerollArchipelago:
		err = rerollArchipelago(w, c, cmd)
	case RenameIsland:
		err = renameIsland(w, c, cmd)
	case nil:
		return res, fmt.Errorf("%w: nil command", ErrInvalidCommand)
	default:
		return res, fmt.Errorf("%w: %T", ErrInvalidCommand, cmd)
	}
	if err != nil {
		return Result{}, err
	}
	now := w.LastEvaluatedAt.UnixMilli()
	// Due moments a command creates at this instant (a berth granted to
	// an assigned ship, a queue served by an upgraded Trading Post).
	applyDue(w, c, now, l)
	normalizeShips(w, now)
	evaluateUnlocks(w, c)
	evaluateQuests(w, c, now, nil)
	return res, nil
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

// GrantWorkforce adds qty milli-residents (whole residents) of a tier to an
// island's workforce pool without creating population. Like PlaceFree and
// AddStock it is meant for world creation and test seeding only and is not
// a player command. The grant does not count for unlocks, taxes, needs or
// population displays.
func GrantWorkforce(w *World, c *content.Catalogue, islandID, tier string, qty Qty) error {
	is := w.Island(islandID)
	if is == nil {
		return fmt.Errorf("%w: %q", ErrUnknownIsland, islandID)
	}
	if c.TierByID[tier] == nil {
		return fmt.Errorf("%w: unknown tier %q", ErrInvalidCommand, tier)
	}
	if qty < 0 || qty%content.MilliPerUnit != 0 {
		return fmt.Errorf("%w: workforce %d is not a whole number of residents >= 0", ErrInvalidCommand, qty)
	}
	if qty == 0 {
		return nil
	}
	if qty > math.MaxInt64-is.WorkforceGrant[tier] {
		return fmt.Errorf("%w: workforce grant of %s overflows", ErrInvalidCommand, tier)
	}
	if is.WorkforceGrant == nil {
		is.WorkforceGrant = map[string]Qty{}
	}
	is.WorkforceGrant[tier] += qty
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

// Extra terrain a checkTiles caller allows besides the buildable terrain.
const (
	allowNone     = ""
	allowMountain = content.TerrainMountain // deposit buildings
	allowRiver    = content.TerrainRiver    // roads: a road on a river is a bridge (D-058)
)

// checkTiles validates that every tile is on the island, has buildable
// terrain (or the extra terrain also, e.g. mountain for deposit buildings,
// river for roads) and carries neither a building nor a road.
func checkTiles(is *Island, occ []int64, tiles []Pos, also string) error {
	for _, p := range tiles {
		if !is.InBounds(p.X, p.Y) {
			return fmt.Errorf("%w: (%d,%d)", ErrOutOfBounds, p.X, p.Y)
		}
	}
	for _, p := range tiles {
		i := is.index(p.X, p.Y)
		if t := is.Tiles[i].Terrain; !buildableTerrain(t) && (also == allowNone || t != also) {
			return fmt.Errorf("%w: (%d,%d) is %s", ErrTerrain, p.X, p.Y, is.Tiles[i].Terrain)
		}
		if occ[i] != 0 || is.Roads[i] != "" {
			return fmt.Errorf("%w: (%d,%d)", ErrOccupied, p.X, p.Y)
		}
	}
	return nil
}

// checkBridges validates the bridges of a road placement (D-058 part 3):
// every river tile with a road afterwards — the new tiles and the bridges
// next to them — must be a straight crossing: along one axis the river
// run through it is at most two tiles long with buildable land at both
// ends, and the road does not continue sideways from it (no road on the
// river, or along it, off that axis). A bad bridge is an ErrTerrain (no
// API error code of its own).
func checkBridges(is *Island, tiles []Pos) error {
	added := map[Pos]bool{}
	for _, p := range tiles {
		added[p] = true
	}
	road := func(x, y int) bool {
		return is.InBounds(x, y) && (added[Pos{X: x, Y: y}] || is.Roads[is.index(x, y)] != "")
	}
	river := func(x, y int) bool {
		return is.InBounds(x, y) && is.Tiles[is.index(x, y)].Terrain == content.TerrainRiver
	}
	land := func(x, y int) bool {
		return is.InBounds(x, y) && buildableTerrain(is.Tiles[is.index(x, y)].Terrain)
	}
	straight := func(x, y int) bool {
		for _, ax := range [2][2]int{{1, 0}, {0, 1}} {
			a, b := 0, 0
			for river(x-(a+1)*ax[0], y-(a+1)*ax[1]) && a < 2 {
				a++
			}
			for river(x+(b+1)*ax[0], y+(b+1)*ax[1]) && b < 2 {
				b++
			}
			if a+b+1 > 2 || !land(x-(a+1)*ax[0], y-(a+1)*ax[1]) || !land(x+(b+1)*ax[0], y+(b+1)*ax[1]) {
				continue
			}
			if !road(x+ax[1], y+ax[0]) && !road(x-ax[1], y-ax[0]) {
				return true
			}
		}
		return false
	}
	check := map[Pos]bool{}
	for _, p := range tiles {
		for _, d := range [5][2]int{{0, 0}, {0, -1}, {1, 0}, {0, 1}, {-1, 0}} {
			q := Pos{X: p.X + d[0], Y: p.Y + d[1]}
			if river(q.X, q.Y) && road(q.X, q.Y) {
				check[q] = true
			}
		}
	}
	for _, p := range tiles { // command order: the first bad tile is reported
		for _, d := range [5][2]int{{0, 0}, {0, -1}, {1, 0}, {0, 1}, {-1, 0}} {
			q := Pos{X: p.X + d[0], Y: p.Y + d[1]}
			if check[q] && !straight(q.X, q.Y) {
				return fmt.Errorf("%w: (%d,%d) is a river a bridge crosses only straight over at most two tiles", ErrTerrain, q.X, q.Y)
			}
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
	// Houses of a later tier only appear by upgrading (MECHANICS §6.1).
	if charge && def.House != nil && def.House.Tier != c.Tiers[0].ID {
		return fmt.Errorf("%w: %s (upgrade a full house of the previous tier)", ErrUpgradeOnly, def.ID)
	}
	if charge && !TierUnlocked(w, c, def.Tier) {
		return fmt.Errorf("%w: %s needs tier %s", ErrTierLocked, def.ID, def.Tier)
	}
	// Only FoundIsland (and seeding) places the Trading Post of an island
	// (MECHANICS §8), at most one per island.
	if charge && !settled(is, c) {
		return fmt.Errorf("%w: %q", ErrIslandNotSettled, is.ID)
	}
	if def.TradingPost != nil && settled(is, c) {
		return fmt.Errorf("%w: %q has a trading post", ErrIslandAlreadySettled, is.ID)
	}
	if charge && def.TradingPost != nil {
		return fmt.Errorf("%w: a trading post is placed by found_island", ErrInvalidCommand)
	}
	if def.Field != nil {
		return fmt.Errorf("%w: %s is placed from its %s (place_field)", ErrFieldNeedsFarm, def.ID, strings.Join(def.Field.Farms, " or "))
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

	if err := checkSite(is, c, is.occupancy(c), def, cmd.X, cmd.Y, cmd.Rotation, true); err != nil {
		return err
	}
	if berths := def.InitialBerths(); berths > 0 {
		at := &Building{ID: -1, Type: def.ID, X: cmd.X, Y: cmd.Y, Rotation: cmd.Rotation, Berths: berths}
		if err := checkHarbourAfter(is, c, def, at, -1); err != nil {
			return err
		}
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
	if def.Collector() || def.Depot != nil {
		b.Level = 1
	}
	b.Berths = def.InitialBerths()
	if def.House != nil {
		if tier := c.TierByID[def.House.Tier]; tier != nil {
			b.House = &HouseState{Residents: tier.ResidentsFloor}
		}
	}
	is.Buildings = append(is.Buildings, b)
	clearQuay(is, c, def, b)
	afterChange(is, c)
	return nil
}

// CheckSite validates a site for a building on the island as placement
// does (rotation, bounds, terrain, occupancy, water rows, coast, deposit,
// fertility and work area; checkSite), without cost, tier, settlement or
// field rules. The archipelago generator uses it to verify Trading Post
// and shipyard sites on fresh islands (D-053).
func CheckSite(is *Island, c *content.Catalogue, def *content.Building, x, y, rotation int) error {
	if !validRotation(rotation) {
		return fmt.Errorf("%w: rotation %d", ErrInvalidCommand, rotation)
	}
	return checkSite(is, c, is.occupancy(c), def, x, y, rotation, true)
}

// SiteChecker is CheckSite for many sites of one unchanged island: the
// occupancy is computed once (the archipelago generator and the dev
// fixture planner scan every anchor of an island, D-053).
type SiteChecker struct {
	is  *Island
	c   *content.Catalogue
	occ []int64
}

// NewSiteChecker returns a checker of the island in its current state; it
// must not be used after the island changed.
func NewSiteChecker(is *Island, c *content.Catalogue) *SiteChecker {
	return &SiteChecker{is: is, c: c, occ: is.occupancy(c)}
}

// Valid reports whether CheckSite accepts the site. Footprints that fail
// on bounds, terrain or occupancy are rejected by a scan without
// allocation (most anchors of a scan); the others get the full check.
func (s *SiteChecker) Valid(def *content.Building, x, y, rotation int) bool {
	if !validRotation(rotation) {
		return false
	}
	is := s.is
	fw, fh := footprint(def, rotation)
	if fw < 1 || fh < 1 || x < 0 || y < 0 || x > is.Width-fw || y > is.Height-fh {
		return false
	}
	mountain := def.RequiresDeposit != ""
	for ty := y; ty < y+fh; ty++ {
		for tx := x; tx < x+fw; tx++ {
			i := is.index(tx, ty)
			t := is.Tiles[i].Terrain
			switch {
			case s.occ[i] != 0:
				return false
			case WaterTile(def, x, y, rotation, tx, ty):
				if t != content.TerrainWater || is.Roads[i] != "" {
					return false
				}
			case standsOnQuay(def) && quayAt(is, s.c, i):
				// A quay counts as coast (D-060).
			case is.Roads[i] != "" || (!buildableTerrain(t) && (!mountain || t != content.TerrainMountain)):
				return false
			}
		}
	}
	return checkSite(is, s.c, s.occ, def, x, y, rotation, true) == nil
}

// checkSite validates a building site, in this order: the footprint is on
// the island, on buildable terrain (a deposit building may also cover
// mountain tiles) and free (per occ and roads) except the front rows of a
// water-edge building, which must be free water tiles; a coastal building touches
// the coast; a deposit building covers at least one tile with a deposit of
// its kind; the island has the fertility of a work-area building; and,
// with workArea set, a work-area building without a fields block has
// efficiency > 0 (a farm with fields starts at 0 fields, D-049). A road is
// never required (D-042). Fields are not sites of this check (fields.go).
func checkSite(is *Island, c *content.Catalogue, occ []int64, def *content.Building, x, y, rotation int, workArea bool) error {
	fw, fh := footprint(def, rotation)
	// Overflow-safe bounds check of the whole footprint before any tile
	// arithmetic: x+fw could wrap for extreme anchors.
	if fw < 1 || fh < 1 || x < 0 || y < 0 || x > is.Width-fw || y > is.Height-fh {
		return fmt.Errorf("%w: %s footprint at (%d,%d)", ErrOutOfBounds, def.ID, x, y)
	}
	tiles := make([]Pos, 0, fw*fh)
	var water, quay []Pos
	for ty := y; ty < y+fh; ty++ {
		for tx := x; tx < x+fw; tx++ {
			if WaterTile(def, x, y, rotation, tx, ty) {
				water = append(water, Pos{tx, ty})
				continue
			}
			// A coastal or water-edge building may stand on a quay: it
			// counts as coast and is replaced (D-060).
			if standsOnQuay(def) && quayAt(is, c, is.index(tx, ty)) {
				quay = append(quay, Pos{tx, ty})
				continue
			}
			tiles = append(tiles, Pos{tx, ty})
		}
	}
	also := allowNone
	if def.RequiresDeposit != "" {
		also = allowMountain
	}
	if err := checkTiles(is, occ, tiles, also); err != nil {
		return err
	}
	for _, p := range quay {
		if occ[is.index(p.X, p.Y)] != 0 {
			return fmt.Errorf("%w: (%d,%d)", ErrOccupied, p.X, p.Y)
		}
	}
	// Water-edge buildings (D-051): the front rows stand on free water
	// (no quay either).
	for _, p := range water {
		i := is.index(p.X, p.Y)
		if is.Tiles[i].Terrain != content.TerrainWater {
			return fmt.Errorf("%w: %s at (%d,%d): front tile (%d,%d) is %s", ErrNotOnWater, def.ID, x, y, p.X, p.Y, is.Tiles[i].Terrain)
		}
		if occ[i] != 0 || is.Roads[i] != "" {
			return fmt.Errorf("%w: (%d,%d)", ErrOccupied, p.X, p.Y)
		}
	}
	if def.Coastal {
		coastal := len(quay) > 0
		for _, p := range tiles {
			if is.Tile(p.X, p.Y).Terrain == content.TerrainCoast {
				coastal = true
				break
			}
		}
		if !coastal {
			return fmt.Errorf("%w: %s at (%d,%d)", ErrNotCoastal, def.ID, x, y)
		}
	}
	if kind := def.RequiresDeposit; kind != "" {
		found := false
		for _, p := range tiles {
			if d := is.Tile(p.X, p.Y).Deposit; d != nil && d.Kind == kind {
				found = true
				break
			}
		}
		if !found {
			return fmt.Errorf("%w: %s at (%d,%d) must cover a %s deposit", ErrNoDeposit, def.ID, x, y, kind)
		}
	}
	if wa := def.WorkArea; wa != nil {
		if err := checkFertility(is, def.ID, wa.Fertility); err != nil {
			return err
		}
	}
	if workArea && def.WorkArea != nil && def.Fields == nil && workAreaEfficiency(is, occ, def, x, y, rotation) == 0 {
		return fmt.Errorf("%w: %s at (%d,%d)", ErrNoWorkArea, def.ID, x, y)
	}
	return nil
}

// moveBuilding moves a building. The building's own current footprint
// counts as free land for the target (so a one-tile shift is valid, and the
// identical position is a valid no-op). A target with the same footprint
// rectangle as the current one skips the work-area check: it cannot change
// the efficiency, and an existing building may legitimately have dropped to
// 0. Nothing is charged or refunded.
func moveBuilding(w *World, c *content.Catalogue, cmd MoveBuilding) error {
	is, err := lookupIsland(w, cmd.IslandID)
	if err != nil {
		return err
	}
	b := is.Building(cmd.BuildingID)
	if b == nil {
		return fmt.Errorf("%w: building %d on island %q", ErrBuildingNotFound, cmd.BuildingID, cmd.IslandID)
	}
	if !validRotation(cmd.Rotation) {
		return fmt.Errorf("%w: rotation %d", ErrInvalidCommand, cmd.Rotation)
	}
	def := c.BuildingByID[b.Type]
	if def == nil {
		return fmt.Errorf("%w: %q", ErrUnknownBuilding, b.Type)
	}
	if def.Road != nil {
		return fmt.Errorf("%w: roads cannot be moved", ErrInvalidCommand)
	}
	if def.Field != nil {
		return fmt.Errorf("%w: fields cannot be moved (demolish and place again)", ErrInvalidCommand)
	}
	occ := is.occupancy(c)
	for i, id := range occ {
		if id == b.ID {
			occ[i] = 0
		}
	}
	w0, h0 := footprint(def, b.Rotation)
	w1, h1 := footprint(def, cmd.Rotation)
	sameRect := cmd.X == b.X && cmd.Y == b.Y && w0 == w1 && h0 == h1
	if err := checkSite(is, c, occ, def, cmd.X, cmd.Y, cmd.Rotation, !sameRect); err != nil {
		return err
	}

	if b.Berths > 0 {
		at := &Building{ID: b.ID, Type: b.Type, X: cmd.X, Y: cmd.Y, Rotation: cmd.Rotation, Berths: b.Berths}
		if err := checkHarbourAfter(is, c, def, at, b.ID); err != nil {
			return err
		}
	}

	// Validation complete: mutate.
	b.X, b.Y, b.Rotation = cmd.X, cmd.Y, cmd.Rotation
	clearQuay(is, c, def, b)
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
	if !settled(is, c) {
		return fmt.Errorf("%w: %q", ErrIslandNotSettled, is.ID)
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
	if def.Road.Shallows {
		// A quay (D-060) stands on free shallows and keeps the harbour
		// open (quay.go).
		if err := checkQuayTiles(is, is.occupancy(c), cmd.Tiles); err != nil {
			return err
		}
		tmp := *is
		tmp.Roads = maps.Clone(is.Roads)
		if tmp.Roads == nil {
			tmp.Roads = map[int]string{}
		}
		for _, p := range cmd.Tiles {
			tmp.Roads[is.index(p.X, p.Y)] = def.ID
		}
		if !harbourRoutable(c, &tmp) {
			return fmt.Errorf("%w: the quay would close the harbour of %q", ErrHarbourBlocked, is.ID)
		}
	} else {
		if err := checkTiles(is, is.occupancy(c), cmd.Tiles, allowRiver); err != nil {
			return err
		}
		if err := checkBridges(is, cmd.Tiles); err != nil {
			return err
		}
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

	// The Trading Post may only go when nothing but roads remains: it
	// unsettles the island (R-35, D-051).
	if def.TradingPost != nil && len(is.Buildings) > 1 {
		return fmt.Errorf("%w: %q has %d other buildings", ErrLastTradingPost, is.ID, len(is.Buildings)-1)
	}

	// Capacity after demolition: the Trading Post and the depots hold
	// capacity (D-060). The demolished building's own in-transit goods
	// are delivered, which leaves committed quantities unchanged.
	newCap := capacityFine(is, c) - def.CapacityAt(b.Level)*SubPerMilli
	if def.TradingPost != nil {
		newCap = 0
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
	// An upgraded Trading Post, Warehouse or depot also refunds the paid levels
	// (D-019).
	for lvl := 2; lvl <= b.Level; lvl++ {
		if lc := def.LevelCost(lvl); lc != nil {
			refund(is, c, *lc, 1, l, now)
		}
	}
	if b.Order != nil {
		refundOrder(is, c, b.Order, l, now)
	}
	// Demolishing a farm demolishes its fields, one refund per field
	// (D-043, D-051 part 4).
	if def.Fields != nil {
		for _, f := range farmFieldsOf(is, c, b.ID) {
			removeBuilding(is, f.ID)
			refund(is, c, c.BuildingByID[f.Type].Cost, 1, l, now)
		}
	}
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
		b.Paused, b.PausedReason, b.PauseSeq, b.PausedAtMs = true, PausedReasonPlayer, 0, 0
	case b.Paused:
		// Resuming is allowed for any paused building, player or unpaid
		// (MECHANICS §14). An unpaid building resumed while the balance is
		// still negative is paused again at the next settle.
		b.Paused, b.PausedReason, b.PauseSeq, b.PausedAtMs = false, "", 0, 0
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
	nextDef, next, err := checkHouseUpgrade(w, c, is, b, func() *content.Need { return unmetRequiredNeed(w, c, is, b.ID) })
	if err != nil {
		return err
	}

	// Validation complete: mutate.
	chargeCost(w, is, nextDef.Cost, 1, l)
	b.Type = nextDef.ID
	b.House = &HouseState{Residents: next.ResidentsFloor}
	afterChange(is, c)
	return nil
}

// checkHouseUpgrade is the upgrade gate of a house (MECHANICS §6.1): it
// returns the house definition and the tier of the next tier, or the first failing
// condition as a typed error, in this order: a next-tier house exists
// (ErrUpgradeUnavailable), its tier is unlocked (ErrTierLocked), the house
// is full (ErrHouseNotFull), no required need is below the gate
// (ErrNeedsUnmet; unmet returns the failing need, nil when none), the
// footprints match (ErrUpgradeUnavailable) and the cost is covered
// (ErrInsufficientGold / ErrInsufficientMaterials). The upgrade command and
// the display's upgrade block (upgradeDisplay) share it.
func checkHouseUpgrade(w *World, c *content.Catalogue, is *Island, b *Building, unmet func() *content.Need) (*content.Building, *content.Tier, error) {
	def := c.BuildingByID[b.Type]
	tier := houseTier(b, c)
	if def == nil || tier == nil {
		return nil, nil, fmt.Errorf("%w: %s", ErrNotAHouse, b.Type)
	}
	next, nextDef := nextHouse(c, b)
	if next == nil {
		return nil, nil, fmt.Errorf("%w: no house of the next tier after %s", ErrUpgradeUnavailable, tier.ID)
	}
	if !TierUnlocked(w, c, next.ID) {
		return nil, nil, fmt.Errorf("%w: %s", ErrTierLocked, next.ID)
	}
	if b.House.Residents < tier.ResidentsMax {
		return nil, nil, fmt.Errorf("%w: %d of %d milli-residents", ErrHouseNotFull, b.House.Residents, tier.ResidentsMax)
	}
	if need := unmet(); need != nil {
		return nil, nil, fmt.Errorf("%w: %s", ErrNeedsUnmet, need.ID)
	}
	if nextDef.Width != def.Width || nextDef.Height != def.Height {
		return nil, nil, fmt.Errorf("%w: footprint of %s differs", ErrUpgradeUnavailable, nextDef.ID)
	}
	if err := checkCost(w, is, nextDef.Cost, 1); err != nil {
		return nil, nil, err
	}
	return nextDef, next, nil
}

// nextHouse returns the next tier of a house and that tier's house
// definition (nil, nil when the tier is the last or has no house yet).
func nextHouse(c *content.Catalogue, b *Building) (*content.Tier, *content.Building) {
	tier := houseTier(b, c)
	if tier == nil || tier.Index+1 >= len(c.Tiers) {
		return nil, nil
	}
	next := c.Tiers[tier.Index+1]
	if next.House == "" || c.BuildingByID[next.House] == nil {
		return nil, nil
	}
	return next, c.BuildingByID[next.House]
}

// upgradeBuilding upgrades a house to the next tier or another building to
// its next level (D-056).
func upgradeBuilding(w *World, c *content.Catalogue, cmd UpgradeBuilding, l *Ledger) error {
	is, b, def, err := lookupUpgrade(w, c, cmd.IslandID, cmd.BuildingID)
	if err != nil {
		return err
	}
	if def.House != nil {
		return upgradeHouse(w, c, UpgradeHouse(cmd), l)
	}
	return upgradeLevel(w, c, is, b, def, l)
}

// lookupUpgrade resolves the island, building and definition of an
// upgrade command.
func lookupUpgrade(w *World, c *content.Catalogue, islandID string, id int64) (*Island, *Building, *content.Building, error) {
	is, err := lookupIsland(w, islandID)
	if err != nil {
		return nil, nil, nil, err
	}
	b := is.Building(id)
	if b == nil {
		return nil, nil, nil, fmt.Errorf("%w: building %d on island %q", ErrBuildingNotFound, id, islandID)
	}
	def := c.BuildingByID[b.Type]
	if def == nil {
		return nil, nil, nil, fmt.Errorf("%w: %q", ErrUnknownBuilding, b.Type)
	}
	return is, b, def, nil
}

// upgradeCollector upgrades a Trading Post (tradingPost set) or a
// Warehouse; the other kind of building fails with ErrUpgradeUnavailable
// (the deprecated aliases of upgrade_building).
func upgradeCollector(w *World, c *content.Catalogue, islandID string, id int64, tradingPost bool, l *Ledger) error {
	is, b, def, err := lookupUpgrade(w, c, islandID, id)
	if err != nil {
		return err
	}
	switch {
	case tradingPost && def.TradingPost == nil:
		return fmt.Errorf("%w: %s is not a trading post", ErrUpgradeUnavailable, b.Type)
	case !tradingPost && def.Warehouse == nil:
		return fmt.Errorf("%w: %s is not a warehouse", ErrUpgradeUnavailable, b.Type)
	}
	return upgradeLevel(w, c, is, b, def, l)
}

// upgradeLevel raises a building with levels (Trading Post, Warehouse,
// public building) to its next level: the level's tier must be unlocked
// and its cost is charged like a placement.
func upgradeLevel(w *World, c *content.Catalogue, is *Island, b *Building, def *content.Building, l *Ledger) error {
	level := max(b.Level, 1)
	if !def.Upgradable() {
		return fmt.Errorf("%w: %s has no levels", ErrUpgradeUnavailable, def.ID)
	}
	if level >= def.LevelCount() {
		return fmt.Errorf("%w: %s is at its last level %d", ErrUpgradeUnavailable, def.ID, level)
	}
	if t := def.LevelTier(level + 1); t != "" && !TierUnlocked(w, c, t) {
		return fmt.Errorf("%w: level %d of %s needs tier %s", ErrTierLocked, level+1, def.ID, t)
	}
	cost := def.LevelCost(level + 1)
	if cost == nil {
		return fmt.Errorf("%w: level %d of %s has no cost", ErrUpgradeUnavailable, level+1, def.ID)
	}
	if err := checkCost(w, is, *cost, 1); err != nil {
		return err
	}

	// Validation complete: mutate. Capacity, throughput and service radius
	// are derived from the level; the next settle recomputes all rates.
	chargeCost(w, is, *cost, 1, l)
	b.Level = level + 1
	b.Berths = def.BerthsAt(b.Level)
	clearRegimes(is)
	return nil
}

// upgradeGatePPM is the upgrade gate (D-056 §4): every required category
// of the house must be covered to at least 0.6.
const upgradeGatePPM = 600_000

// unmetRequiredNeed returns the first required need of the house below the
// upgrade gate at this instant (nil when all pass); see unmetNeed. It
// settles a copy of the world, so the world itself is not changed.
func unmetRequiredNeed(w *World, c *content.Catalogue, is *Island, id int64) *content.Need {
	cw := w.Clone()
	wr, _ := settleWorld(cw, c, cw.LastEvaluatedAt.UnixMilli())
	for i, cis := range cw.Islands {
		if cis.ID != is.ID {
			continue
		}
		for _, h := range wr.islands[i].houses {
			if h.b.ID == id {
				return unmetNeed(h)
			}
		}
	}
	return nil
}

// unmetNeed returns the first required need of a settled house below the
// upgrade gate: fulfilment >= 0.6, or the most its alternatives can cover
// together (needCap) when that is less. The carried needs of lower tiers
// count like the own ones. Nil when all pass.
func unmetNeed(h *houseCalc) *content.Need {
	for _, n := range h.needs {
		if n.need.Kind != content.NeedOptional && n.fulfilment < needGate(n.need) {
			return n.need
		}
	}
	return nil
}

// needGate is the fulfilment (ppm) a required need must reach for an
// upgrade: the gate, or the most the need's alternatives can cover when that
// is less.
func needGate(n *content.Need) int64 { return min(upgradeGatePPM, needCap(n)) }

// needCap is the highest fulfilment (ppm) a need can reach: the sum of the
// shares of all its alternatives, at most 1 (D-056).
func needCap(n *content.Need) int64 {
	var sum int64
	for _, g := range n.Goods {
		sum += g.Share
	}
	for _, nb := range n.Buildings {
		sum += nb.Share
	}
	return min(sum, ppm)
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
