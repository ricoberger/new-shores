package store

import (
	"encoding/json"
	"strconv"
	"time"

	"github.com/ricoberger/new-shores/server/internal/sim"
)

// Due moments of the simulation (sim.DueEvents) are mirrored by scheduled
// events of the same kind, one pending event per due moment (R-49): the
// event makes sure that an offline world is evaluated at the due time,
// published and given its follow-up events. The payload identifies the
// due moment within its world.

// ShipBuiltPayload is the payload of a ship_built event.
type ShipBuiltPayload struct {
	IslandID   string `json:"island_id"`
	BuildingID int64  `json:"building_id"`
}

// ShipArrivedPayload is the payload of a ship_arrived event.
type ShipArrivedPayload struct {
	ShipID int64 `json:"ship_id"`
}

// DuePayload returns the event payload of a due moment.
func DuePayload(ev sim.DueEvent) json.RawMessage {
	var v any
	switch ev.Kind {
	case sim.DueShipBuilt:
		v = ShipBuiltPayload{IslandID: ev.IslandID, BuildingID: ev.BuildingID}
	default:
		v = ShipArrivedPayload{ShipID: ev.ShipID}
	}
	data, _ := json.Marshal(v) // plain structs never fail
	return data
}

// IsDueKind reports whether events of the kind mirror due moments.
func IsDueKind(kind string) bool {
	return kind == sim.DueShipBuilt || kind == sim.DueShipArrived
}

// DueKey is the identity of a due moment: kind, payload identity and due
// time (ms). ok is false for other kinds or malformed payloads.
func DueKey(kind string, payload json.RawMessage, due time.Time) (string, bool) {
	ms := strconv.FormatInt(due.UTC().Truncate(time.Millisecond).UnixMilli(), 10)
	switch kind {
	case sim.DueShipBuilt:
		var p ShipBuiltPayload
		if json.Unmarshal(payload, &p) != nil {
			return "", false
		}
		return kind + "/" + p.IslandID + "/" + strconv.FormatInt(p.BuildingID, 10) + "@" + ms, true
	case sim.DueShipArrived:
		var p ShipArrivedPayload
		if json.Unmarshal(payload, &p) != nil {
			return "", false
		}
		return kind + "/" + strconv.FormatInt(p.ShipID, 10) + "@" + ms, true
	}
	return "", false
}

// DueEventKey is DueKey of a due moment.
func DueEventKey(ev sim.DueEvent) string {
	k, _ := DueKey(ev.Kind, DuePayload(ev), ev.At)
	return k
}

// MissingDueEvents returns the due moments of w without an entry in
// pending (keys from DueKey/DueEventKey), in due order.
func MissingDueEvents(w *sim.World, pending map[string]bool) []sim.DueEvent {
	var out []sim.DueEvent
	for _, ev := range sim.DueEvents(w) {
		if !pending[DueEventKey(ev)] {
			out = append(out, ev)
		}
	}
	return out
}
