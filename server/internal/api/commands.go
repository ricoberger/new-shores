package api

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"

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
