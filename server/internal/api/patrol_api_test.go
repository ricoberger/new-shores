package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"testing"

	"github.com/ricoberger/new-shores/server/internal/testworld"
)

// TestPatrolCommand (D-077 §6): patrol sends the idle start ship round its
// island; the display carries the patrol; unassign_ship ends it; a body
// without the island is invalid.
func TestPatrolCommand(t *testing.T) {
	c := shippedCatalogue(t)
	w, err := testworld.Founded(c, testStart)
	if err != nil {
		t.Fatal(err)
	}
	s := w.Ships[0]
	island := s.IslandID
	ts := newTestServerWith(t, w, testStart, 1, c)
	res := ts.command(fmt.Sprintf(`{"type":"patrol","ship_id":%d,"island_id":%q}`, s.ID, island), nil)
	if res.status != http.StatusOK {
		t.Fatalf("patrol: %d %s", res.status, res.body)
	}
	var body struct {
		Display struct {
			Ships []struct {
				State  string `json:"state"`
				Patrol *struct {
					IslandID string            `json:"island_id"`
					Loop     []json.RawMessage `json:"loop"`
					LoopMs   int64             `json:"loop_ms"`
				} `json:"patrol"`
			} `json:"ships"`
		} `json:"display"`
	}
	if err := json.Unmarshal(res.body, &body); err != nil {
		t.Fatal(err)
	}
	if sh := body.Display.Ships[0]; sh.State != "patrolling" || sh.Patrol == nil || sh.Patrol.IslandID != island || len(sh.Patrol.Loop) < 3 || sh.Patrol.LoopMs <= 0 {
		t.Fatalf("ship %+v", sh)
	}
	res = ts.command(fmt.Sprintf(`{"type":"unassign_ship","ship_id":%d}`, s.ID), nil)
	if res.status != http.StatusOK {
		t.Fatalf("unassign: %d %s", res.status, res.body)
	}
	res = ts.do(http.MethodPost, "/api/v1/world/commands", fmt.Sprintf(`{"command":{"type":"patrol","ship_id":%d}}`, s.ID), false)
	if res.status != http.StatusBadRequest || errorCode(t, res) != "invalid_command" {
		t.Fatalf("missing island_id: %d %s", res.status, res.body)
	}
}
