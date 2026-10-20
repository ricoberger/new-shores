package api

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"unicode/utf8"

	"github.com/ricoberger/new-shores/server/internal/sim"
)

// maxBodyBytes limits request bodies (64 KiB).
const maxBodyBytes = 64 << 10

// Command types of POST /api/v1/world/commands (discriminator "type").
const (
	cmdPlaceBuilding = "place_building"
	cmdPlaceRoad     = "place_road"
	cmdDemolish      = "demolish"
	cmdDemolishRoad  = "demolish_road"
	cmdSetPaused     = "set_paused"
	cmdUpgradeHouse  = "upgrade_house"
	cmdMoveBuilding  = "move_building"

	cmdOrderShip       = "order_ship"
	cmdCancelShipOrder = "cancel_ship_order"
	cmdScrapShip       = "scrap_ship"
	cmdCreateRoute     = "create_route"
	cmdUpdateRoute     = "update_route"
	cmdDeleteRoute     = "delete_route"
	cmdAssignShip      = "assign_ship"
	cmdUnassignShip    = "unassign_ship"
	cmdManualShipment  = "manual_shipment"
	cmdFoundIsland     = "found_island"
)

// Body limits of the ship and route commands (API level, invalid_command).
const (
	maxRouteStops    = 8
	maxStopEntries   = 32
	maxCargoEntries  = 16
	maxRouteNameRune = 40
)

// commandRequest is the body of POST /api/v1/world/commands.
type commandRequest struct {
	// Version is the world version the client last saw (optional).
	Version *int64          `json:"version"`
	Command json.RawMessage `json:"command"`
}

type tileJSON struct {
	X *int `json:"x"`
	Y *int `json:"y"`
}

// Command bodies. Pointers distinguish missing fields from zero values.
type placeBuildingJSON struct {
	Type         string  `json:"type"`
	IslandID     *string `json:"island_id"`
	BuildingType *string `json:"building_type"`
	X            *int    `json:"x"`
	Y            *int    `json:"y"`
	Rotation     *int    `json:"rotation"`
}

type placeRoadJSON struct {
	Type     string     `json:"type"`
	IslandID *string    `json:"island_id"`
	RoadType *string    `json:"road_type"`
	Tiles    []tileJSON `json:"tiles"`
}

type demolishJSON struct {
	Type              string  `json:"type"`
	IslandID          *string `json:"island_id"`
	BuildingID        *int64  `json:"building_id"`
	AcceptSurplusLoss bool    `json:"accept_surplus_loss"`
}

type demolishRoadJSON struct {
	Type     string     `json:"type"`
	IslandID *string    `json:"island_id"`
	Tiles    []tileJSON `json:"tiles"`
}

type setPausedJSON struct {
	Type       string  `json:"type"`
	IslandID   *string `json:"island_id"`
	BuildingID *int64  `json:"building_id"`
	Paused     *bool   `json:"paused"`
}

type upgradeHouseJSON struct {
	Type       string  `json:"type"`
	IslandID   *string `json:"island_id"`
	BuildingID *int64  `json:"building_id"`
}

type moveBuildingJSON struct {
	Type       string  `json:"type"`
	IslandID   *string `json:"island_id"`
	BuildingID *int64  `json:"building_id"`
	X          *int    `json:"x"`
	Y          *int    `json:"y"`
	Rotation   *int    `json:"rotation"`
}

type orderShipJSON struct {
	Type       string  `json:"type"`
	IslandID   *string `json:"island_id"`
	BuildingID *int64  `json:"building_id"`
	ShipType   *string `json:"ship_type"`
}

type shipyardJSON struct {
	Type       string  `json:"type"`
	IslandID   *string `json:"island_id"`
	BuildingID *int64  `json:"building_id"`
}

type shipJSON struct {
	Type   string `json:"type"`
	ShipID *int64 `json:"ship_id"`
}

type loadRuleJSON struct {
	Good      *string `json:"good"`
	MaxAmount *int64  `json:"max_amount"`
}

type routeStopJSON struct {
	IslandID *string        `json:"island_id"`
	Load     []loadRuleJSON `json:"load"`
	Unload   []string       `json:"unload"`
}

type routeJSON struct {
	Type    string          `json:"type"`
	RouteID *int64          `json:"route_id"`
	Name    *string         `json:"name"`
	Stops   []routeStopJSON `json:"stops"`
}

type assignShipJSON struct {
	Type    string `json:"type"`
	ShipID  *int64 `json:"ship_id"`
	RouteID *int64 `json:"route_id"`
}

type cargoJSON struct {
	Good   *string `json:"good"`
	Amount *int64  `json:"amount"`
}

type manualShipmentJSON struct {
	Type       string      `json:"type"`
	ShipID     *int64      `json:"ship_id"`
	ToIslandID *string     `json:"to_island_id"`
	Cargo      []cargoJSON `json:"cargo"`
}

type foundIslandJSON struct {
	Type         string  `json:"type"`
	ShipID       *int64  `json:"ship_id"`
	IslandID     *string `json:"island_id"`
	BuildingType *string `json:"building_type"`
	X            *int    `json:"x"`
	Y            *int    `json:"y"`
	Rotation     *int    `json:"rotation"`
}

// decodeStrict decodes exactly one JSON value into v, rejecting unknown
// fields and trailing data.
func decodeStrict(data []byte, v any) error {
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		return badRequest(fmt.Sprintf("malformed JSON: %v", err))
	}
	if _, err := dec.Token(); !errors.Is(err, io.EOF) {
		return badRequest("malformed JSON: trailing data after the object")
	}
	return nil
}

func missing(field string) error {
	return fmt.Errorf("%w: missing field %q", sim.ErrInvalidCommand, field)
}

// decodeCommand parses a command object into a simulation command and
// returns its type for logging.
func decodeCommand(raw json.RawMessage) (string, sim.Command, error) {
	if len(raw) == 0 || string(raw) == "null" {
		return "", nil, missing("command")
	}
	var head struct {
		Type string `json:"type"`
	}
	if err := json.Unmarshal(raw, &head); err != nil {
		return "", nil, badRequest(fmt.Sprintf("malformed command: %v", err))
	}
	var (
		cmd sim.Command
		err error
	)
	switch head.Type {
	case cmdPlaceBuilding:
		cmd, err = decodePlaceBuilding(raw)
	case cmdPlaceRoad:
		cmd, err = decodePlaceRoad(raw)
	case cmdDemolish:
		cmd, err = decodeDemolish(raw)
	case cmdDemolishRoad:
		cmd, err = decodeDemolishRoad(raw)
	case cmdSetPaused:
		cmd, err = decodeSetPaused(raw)
	case cmdUpgradeHouse:
		cmd, err = decodeUpgradeHouse(raw)
	case cmdMoveBuilding:
		cmd, err = decodeMoveBuilding(raw)
	case cmdOrderShip:
		cmd, err = decodeOrderShip(raw)
	case cmdCancelShipOrder:
		cmd, err = decodeCancelShipOrder(raw)
	case cmdScrapShip, cmdUnassignShip:
		cmd, err = decodeShipCommand(raw, head.Type)
	case cmdCreateRoute, cmdUpdateRoute:
		cmd, err = decodeRoute(raw, head.Type)
	case cmdDeleteRoute:
		cmd, err = decodeDeleteRoute(raw)
	case cmdAssignShip:
		cmd, err = decodeAssignShip(raw)
	case cmdManualShipment:
		cmd, err = decodeManualShipment(raw)
	case cmdFoundIsland:
		cmd, err = decodeFoundIsland(raw)
	case "":
		return "", nil, missing("type")
	default:
		return "", nil, fmt.Errorf("%w: unknown command type %q", sim.ErrInvalidCommand, head.Type)
	}
	return head.Type, cmd, err
}

func decodePlaceBuilding(raw json.RawMessage) (sim.Command, error) {
	var c placeBuildingJSON
	if err := decodeStrict(raw, &c); err != nil {
		return nil, err
	}
	switch {
	case c.IslandID == nil:
		return nil, missing("island_id")
	case c.BuildingType == nil:
		return nil, missing("building_type")
	case c.X == nil:
		return nil, missing("x")
	case c.Y == nil:
		return nil, missing("y")
	case c.Rotation == nil:
		return nil, missing("rotation")
	}
	return sim.PlaceBuilding{IslandID: *c.IslandID, Type: *c.BuildingType, X: *c.X, Y: *c.Y, Rotation: *c.Rotation}, nil
}

func decodeTiles(tiles []tileJSON) ([]sim.Pos, error) {
	if tiles == nil {
		return nil, missing("tiles")
	}
	out := make([]sim.Pos, 0, len(tiles))
	for i, t := range tiles {
		if t.X == nil || t.Y == nil {
			return nil, fmt.Errorf("%w: tile %d needs x and y", sim.ErrInvalidCommand, i)
		}
		out = append(out, sim.Pos{X: *t.X, Y: *t.Y})
	}
	return out, nil
}

func decodePlaceRoad(raw json.RawMessage) (sim.Command, error) {
	var c placeRoadJSON
	if err := decodeStrict(raw, &c); err != nil {
		return nil, err
	}
	switch {
	case c.IslandID == nil:
		return nil, missing("island_id")
	case c.RoadType == nil:
		return nil, missing("road_type")
	}
	tiles, err := decodeTiles(c.Tiles)
	if err != nil {
		return nil, err
	}
	return sim.PlaceRoad{IslandID: *c.IslandID, Type: *c.RoadType, Tiles: tiles}, nil
}

func decodeDemolish(raw json.RawMessage) (sim.Command, error) {
	var c demolishJSON
	if err := decodeStrict(raw, &c); err != nil {
		return nil, err
	}
	switch {
	case c.IslandID == nil:
		return nil, missing("island_id")
	case c.BuildingID == nil:
		return nil, missing("building_id")
	}
	return sim.Demolish{IslandID: *c.IslandID, BuildingID: *c.BuildingID, AcceptSurplusLoss: c.AcceptSurplusLoss}, nil
}

func decodeDemolishRoad(raw json.RawMessage) (sim.Command, error) {
	var c demolishRoadJSON
	if err := decodeStrict(raw, &c); err != nil {
		return nil, err
	}
	if c.IslandID == nil {
		return nil, missing("island_id")
	}
	tiles, err := decodeTiles(c.Tiles)
	if err != nil {
		return nil, err
	}
	return sim.DemolishRoad{IslandID: *c.IslandID, Tiles: tiles}, nil
}

func decodeSetPaused(raw json.RawMessage) (sim.Command, error) {
	var c setPausedJSON
	if err := decodeStrict(raw, &c); err != nil {
		return nil, err
	}
	switch {
	case c.IslandID == nil:
		return nil, missing("island_id")
	case c.BuildingID == nil:
		return nil, missing("building_id")
	case c.Paused == nil:
		return nil, missing("paused")
	}
	return sim.SetPaused{IslandID: *c.IslandID, BuildingID: *c.BuildingID, Paused: *c.Paused}, nil
}

func decodeUpgradeHouse(raw json.RawMessage) (sim.Command, error) {
	var c upgradeHouseJSON
	if err := decodeStrict(raw, &c); err != nil {
		return nil, err
	}
	switch {
	case c.IslandID == nil:
		return nil, missing("island_id")
	case c.BuildingID == nil:
		return nil, missing("building_id")
	}
	return sim.UpgradeHouse{IslandID: *c.IslandID, BuildingID: *c.BuildingID}, nil
}

func decodeMoveBuilding(raw json.RawMessage) (sim.Command, error) {
	var c moveBuildingJSON
	if err := decodeStrict(raw, &c); err != nil {
		return nil, err
	}
	switch {
	case c.IslandID == nil:
		return nil, missing("island_id")
	case c.BuildingID == nil:
		return nil, missing("building_id")
	case c.X == nil:
		return nil, missing("x")
	case c.Y == nil:
		return nil, missing("y")
	case c.Rotation == nil:
		return nil, missing("rotation")
	}
	return sim.MoveBuilding{IslandID: *c.IslandID, BuildingID: *c.BuildingID, X: *c.X, Y: *c.Y, Rotation: *c.Rotation}, nil
}

func decodeOrderShip(raw json.RawMessage) (sim.Command, error) {
	var c orderShipJSON
	if err := decodeStrict(raw, &c); err != nil {
		return nil, err
	}
	switch {
	case c.IslandID == nil:
		return nil, missing("island_id")
	case c.BuildingID == nil:
		return nil, missing("building_id")
	case c.ShipType == nil:
		return nil, missing("ship_type")
	}
	return sim.OrderShip{IslandID: *c.IslandID, BuildingID: *c.BuildingID, ShipType: *c.ShipType}, nil
}

func decodeCancelShipOrder(raw json.RawMessage) (sim.Command, error) {
	var c shipyardJSON
	if err := decodeStrict(raw, &c); err != nil {
		return nil, err
	}
	switch {
	case c.IslandID == nil:
		return nil, missing("island_id")
	case c.BuildingID == nil:
		return nil, missing("building_id")
	}
	return sim.CancelShipOrder{IslandID: *c.IslandID, BuildingID: *c.BuildingID}, nil
}

func decodeShipCommand(raw json.RawMessage, typ string) (sim.Command, error) {
	var c shipJSON
	if err := decodeStrict(raw, &c); err != nil {
		return nil, err
	}
	if c.ShipID == nil {
		return nil, missing("ship_id")
	}
	if typ == cmdScrapShip {
		return sim.ScrapShip{ShipID: *c.ShipID}, nil
	}
	return sim.UnassignShip{ShipID: *c.ShipID}, nil
}

func decodeStops(stops []routeStopJSON) ([]sim.Stop, error) {
	if stops == nil {
		return nil, missing("stops")
	}
	if len(stops) > maxRouteStops {
		return nil, fmt.Errorf("%w: %d stops, at most %d", sim.ErrInvalidCommand, len(stops), maxRouteStops)
	}
	out := make([]sim.Stop, 0, len(stops))
	for i, st := range stops {
		switch {
		case st.IslandID == nil:
			return nil, fmt.Errorf("%w: stop %d needs island_id", sim.ErrInvalidCommand, i)
		case st.Load == nil || st.Unload == nil:
			return nil, fmt.Errorf("%w: stop %d needs load and unload", sim.ErrInvalidCommand, i)
		case len(st.Load) > maxStopEntries || len(st.Unload) > maxStopEntries:
			return nil, fmt.Errorf("%w: stop %d has more than %d load or unload entries", sim.ErrInvalidCommand, i, maxStopEntries)
		}
		stop := sim.Stop{IslandID: *st.IslandID, Unload: append([]string(nil), st.Unload...)}
		for j, lr := range st.Load {
			if lr.Good == nil || lr.MaxAmount == nil {
				return nil, fmt.Errorf("%w: stop %d load %d needs good and max_amount", sim.ErrInvalidCommand, i, j)
			}
			stop.Load = append(stop.Load, sim.LoadRule{Good: *lr.Good, MaxAmount: *lr.MaxAmount})
		}
		out = append(out, stop)
	}
	return out, nil
}

func decodeRoute(raw json.RawMessage, typ string) (sim.Command, error) {
	var c routeJSON
	if err := decodeStrict(raw, &c); err != nil {
		return nil, err
	}
	name := ""
	if c.Name != nil {
		name = *c.Name
	}
	if utf8.RuneCountInString(name) > maxRouteNameRune {
		return nil, fmt.Errorf("%w: name longer than %d characters", sim.ErrInvalidCommand, maxRouteNameRune)
	}
	if typ == cmdUpdateRoute && c.RouteID == nil {
		return nil, missing("route_id")
	}
	if typ == cmdCreateRoute && c.RouteID != nil {
		return nil, badRequest("malformed JSON: create_route has no route_id")
	}
	stops, err := decodeStops(c.Stops)
	if err != nil {
		return nil, err
	}
	if typ == cmdCreateRoute {
		return sim.CreateRoute{Name: name, Stops: stops}, nil
	}
	return sim.UpdateRoute{RouteID: *c.RouteID, Name: name, Stops: stops}, nil
}

func decodeDeleteRoute(raw json.RawMessage) (sim.Command, error) {
	var c struct {
		Type    string `json:"type"`
		RouteID *int64 `json:"route_id"`
	}
	if err := decodeStrict(raw, &c); err != nil {
		return nil, err
	}
	if c.RouteID == nil {
		return nil, missing("route_id")
	}
	return sim.DeleteRoute{RouteID: *c.RouteID}, nil
}

func decodeAssignShip(raw json.RawMessage) (sim.Command, error) {
	var c assignShipJSON
	if err := decodeStrict(raw, &c); err != nil {
		return nil, err
	}
	switch {
	case c.ShipID == nil:
		return nil, missing("ship_id")
	case c.RouteID == nil:
		return nil, missing("route_id")
	}
	return sim.AssignShip{ShipID: *c.ShipID, RouteID: *c.RouteID}, nil
}

func decodeManualShipment(raw json.RawMessage) (sim.Command, error) {
	var c manualShipmentJSON
	if err := decodeStrict(raw, &c); err != nil {
		return nil, err
	}
	switch {
	case c.ShipID == nil:
		return nil, missing("ship_id")
	case c.ToIslandID == nil:
		return nil, missing("to_island_id")
	case c.Cargo == nil:
		return nil, missing("cargo")
	case len(c.Cargo) > maxCargoEntries:
		return nil, fmt.Errorf("%w: %d cargo entries, at most %d", sim.ErrInvalidCommand, len(c.Cargo), maxCargoEntries)
	}
	cargo := make([]sim.CargoAmount, 0, len(c.Cargo))
	for i, ca := range c.Cargo {
		if ca.Good == nil || ca.Amount == nil {
			return nil, fmt.Errorf("%w: cargo %d needs good and amount", sim.ErrInvalidCommand, i)
		}
		cargo = append(cargo, sim.CargoAmount{Good: *ca.Good, Amount: *ca.Amount})
	}
	return sim.ManualShipment{ShipID: *c.ShipID, ToIslandID: *c.ToIslandID, Cargo: cargo}, nil
}

func decodeFoundIsland(raw json.RawMessage) (sim.Command, error) {
	var c foundIslandJSON
	if err := decodeStrict(raw, &c); err != nil {
		return nil, err
	}
	switch {
	case c.ShipID == nil:
		return nil, missing("ship_id")
	case c.IslandID == nil:
		return nil, missing("island_id")
	case c.BuildingType == nil:
		return nil, missing("building_type")
	case c.X == nil:
		return nil, missing("x")
	case c.Y == nil:
		return nil, missing("y")
	case c.Rotation == nil:
		return nil, missing("rotation")
	}
	return sim.FoundIsland{ShipID: *c.ShipID, IslandID: *c.IslandID, BuildingType: *c.BuildingType, X: *c.X, Y: *c.Y, Rotation: *c.Rotation}, nil
}

// checkTileCount rejects tile lists longer than the island area. Unknown
// islands are left to the simulation (unknown_island).
func checkTileCount(w *sim.World, cmd sim.Command) error {
	var island string
	var n int
	switch c := cmd.(type) {
	case sim.PlaceRoad:
		island, n = c.IslandID, len(c.Tiles)
	case sim.DemolishRoad:
		island, n = c.IslandID, len(c.Tiles)
	default:
		return nil
	}
	if is := w.Island(island); is != nil && n > is.Width*is.Height {
		return fmt.Errorf("%w: %d tiles exceed the island area of %d", sim.ErrInvalidCommand, n, is.Width*is.Height)
	}
	return nil
}
