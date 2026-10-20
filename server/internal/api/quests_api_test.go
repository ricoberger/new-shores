package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"testing"
	"time"

	"github.com/ricoberger/new-shores/server/internal/sim"
	"github.com/ricoberger/new-shores/server/internal/store"
)

// apiTimeLayout is the RFC 3339 layout of the display (UTC, ms).
const apiTimeLayout = "2006-01-02T15:04:05.000Z07:00"

// recordingPublisher counts the published world changes.
type recordingPublisher struct {
	mu sync.Mutex
	n  int
}

func (p *recordingPublisher) Publish(context.Context, store.WorldID) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.n++
}

func (p *recordingPublisher) count() int {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.n
}

// questView is the part of the display the quest and summary tests read.
type questView struct {
	Gold   int64 `json:"gold"`
	Quests struct {
		Active []struct {
			ID string `json:"id"`
		} `json:"active"`
		Claimable []string `json:"claimable"`
		Completed []struct {
			ID      string `json:"id"`
			Claimed bool   `json:"claimed"`
		} `json:"completed"`
	} `json:"quests"`
	AwaySummary *struct {
		ID   int64  `json:"id"`
		From string `json:"from"`
		To   string `json:"to"`
	} `json:"away_summary"`
	LastSeenAt string `json:"last_seen_at"`
	Islands    []struct {
		ID        string `json:"id"`
		Inventory map[string]struct {
			Stock int64 `json:"stock"`
		} `json:"inventory"`
	} `json:"islands"`
}

func questDisplay(t *testing.T, raw json.RawMessage) questView {
	t.Helper()
	var v questView
	if err := json.Unmarshal(raw, &v); err != nil {
		t.Fatal(err)
	}
	return v
}

func (ts *testServer) mustCommand(cmd string) worldJSON {
	ts.t.Helper()
	res := ts.command(cmd, nil)
	if res.status != http.StatusOK {
		ts.t.Fatalf("%s: %d %s", cmd, res.status, res.body)
	}
	var w worldJSON
	if err := json.Unmarshal(res.body, &w); err != nil {
		ts.t.Fatal(err)
	}
	return w
}

func (ts *testServer) expectCode(cmd string, status int, code string) {
	ts.t.Helper()
	res := ts.command(cmd, nil)
	if res.status != status || errorCode(ts.t, res) != code {
		ts.t.Fatalf("%s: %d %s, want %d %s", cmd, res.status, res.body, status, code)
	}
}

// expectUnvalidated sends a command that the spec rejects (a missing
// required field) without validating the request.
func (ts *testServer) expectUnvalidated(cmd string, status int, code string) {
	ts.t.Helper()
	res := ts.do(http.MethodPost, "/api/v1/world/commands", `{"command":`+cmd+`}`, false)
	if res.status != status || errorCode(ts.t, res) != code {
		ts.t.Fatalf("%s: %d %s, want %d %s", cmd, res.status, res.body, status, code)
	}
}

func roadTiles(fromX, toX, y int) string {
	s := ""
	for x := fromX; x <= toX; x++ {
		if s != "" {
			s += ","
		}
		s += fmt.Sprintf(`{"x":%d,"y":%d}`, x, y)
	}
	return s
}

// TestClaimQuestOverHTTP: claim_quest succeeds once per completed quest
// (gold and goods credited) and fails with 400 bad_request, 404
// quest_not_found / unknown_island and 409 quest_not_completed /
// quest_already_claimed / island_not_settled, validated against
// openapi.yaml.
func TestClaimQuestOverHTTP(t *testing.T) {
	ts := newTestServer(t, 1)
	c := catalogue(t)
	road, planks := c.Quests[0], c.Quests[1]
	if len(road.Rewards.Goods) != 0 || len(planks.Rewards.Goods) == 0 {
		t.Fatalf("the shipped chain changed: %s %s", road.ID, planks.ID)
	}
	claim := func(id, island string) string {
		if island == "" {
			return fmt.Sprintf(`{"type":"claim_quest","quest_id":%q}`, id)
		}
		return fmt.Sprintf(`{"type":"claim_quest","quest_id":%q,"island_id":%q}`, id, island)
	}
	ts.expectCode(claim("no_such_quest", ""), http.StatusNotFound, "quest_not_found")
	ts.expectCode(claim(road.ID, ""), http.StatusConflict, "quest_not_completed")
	ts.expectUnvalidated(`{"type":"claim_quest"}`, http.StatusBadRequest, "invalid_command")

	// The road from below the warehouse to the forest completes the road
	// quest at once.
	w := questDisplay(t, ts.mustCommand(`{"type":"place_road","island_id":"start","road_type":"road_dirt","tiles":[`+roadTiles(3, 36, 4)+`]}`).Display)
	if len(w.Quests.Claimable) != 1 || w.Quests.Claimable[0] != road.ID {
		t.Fatalf("claimable %v", w.Quests.Claimable)
	}
	gold := w.Gold
	w = questDisplay(t, ts.mustCommand(claim(road.ID, "")).Display)
	if w.Gold != gold+road.Rewards.Gold || len(w.Quests.Claimable) != 0 || !w.Quests.Completed[0].Claimed {
		t.Fatalf("after claim: gold %d (was %d) %+v", w.Gold, gold, w.Quests)
	}
	ts.expectCode(claim(road.ID, ""), http.StatusConflict, "quest_already_claimed")

	// Lumberjack and sawmill on the road complete the planks quest, which
	// rewards goods: the island is required, known and settled.
	ts.mustCommand(`{"type":"place_building","island_id":"start","building_type":"lumberjack","x":35,"y":5,"rotation":180}`)
	w = questDisplay(t, ts.mustCommand(`{"type":"place_building","island_id":"start","building_type":"sawmill","x":20,"y":5,"rotation":180}`).Display)
	if len(w.Quests.Claimable) != 1 || w.Quests.Claimable[0] != planks.ID {
		t.Fatalf("claimable %v", w.Quests.Claimable)
	}
	ts.expectCode(claim(planks.ID, ""), http.StatusBadRequest, "bad_request")
	ts.expectCode(claim(planks.ID, "atlantis"), http.StatusNotFound, "unknown_island")
	ts.expectCode(claim(planks.ID, "island2"), http.StatusConflict, "island_not_settled")
	before := w.Islands[0].Inventory["planks"].Stock
	w = questDisplay(t, ts.mustCommand(claim(planks.ID, "start")).Display)
	if got := w.Islands[0].Inventory["planks"].Stock; got != before+planks.Rewards.Goods[0].Amount {
		t.Errorf("planks %d -> %d, reward %d", before, got, planks.Rewards.Goods[0].Amount)
	}
	ts.expectCode(claim(planks.ID, "start"), http.StatusConflict, "quest_already_claimed")
}

// TestAwaySummaryOverHTTP: a GET after at least away_summary_minutes of
// world time since the last command returns a summary from that command,
// commits it (version + 1, published); further reads return the same
// summary without a new version; ack_summary with a stale id changes
// nothing but last_seen_at, with the matching id it clears the summary.
// last_seen_at moves only with successful commands.
func TestAwaySummaryOverHTTP(t *testing.T) {
	ts := newTestServer(t, 1)
	pub := &recordingPublisher{}
	ts.srv.cfg.Publisher = pub
	gap := time.Duration(catalogue(t).Region.Rules.AwaySummaryMs) * time.Millisecond

	first := ts.getWorld()
	start := questDisplay(t, first.Display)
	if start.AwaySummary != nil || start.LastSeenAt != testStart.Format(apiTimeLayout) || first.Version != 0 {
		t.Fatalf("initial: %+v version %d", start, first.Version)
	}
	ts.clock.Add(time.Minute)
	cmdAt := testStart.Add(time.Minute)
	w := ts.mustCommand(cmdRoad)
	if v := questDisplay(t, w.Display); v.LastSeenAt != cmdAt.Format(apiTimeLayout) || w.Version != 1 {
		t.Fatalf("after command: last seen %s version %d", v.LastSeenAt, w.Version)
	}
	published := pub.count()

	// A failed command and reads do not move last_seen_at.
	ts.clock.Add(gap - time.Millisecond)
	ts.expectCode(cmdOnWater, http.StatusConflict, "terrain")
	r := ts.getWorld()
	if v := questDisplay(t, r.Display); v.AwaySummary != nil || v.LastSeenAt != cmdAt.Format(apiTimeLayout) || r.Version != 1 || pub.count() != published {
		t.Fatalf("below the threshold: %+v version %d", v, r.Version)
	}

	// At the threshold the read produces and commits the summary.
	ts.clock.Add(time.Millisecond)
	r = ts.getWorld()
	v := questDisplay(t, r.Display)
	if v.AwaySummary == nil || v.AwaySummary.From != cmdAt.Format(apiTimeLayout) || v.AwaySummary.To != cmdAt.Add(gap).Format(apiTimeLayout) ||
		r.Version != 2 || pub.count() != published+1 || v.LastSeenAt != cmdAt.Format(apiTimeLayout) {
		t.Fatalf("summary %+v version %d published %d", v.AwaySummary, r.Version, pub.count()-published)
	}
	id := v.AwaySummary.ID
	ts.clock.Add(time.Minute)
	r = ts.getWorld()
	if again := questDisplay(t, r.Display); again.AwaySummary == nil || again.AwaySummary.ID != id || r.Version != 2 || pub.count() != published+1 {
		t.Fatalf("reload: %+v version %d", again.AwaySummary, r.Version)
	}

	// A stale ack changes nothing but last_seen_at; the matching one clears.
	ackAt := cmdAt.Add(gap + time.Minute)
	w = ts.mustCommand(fmt.Sprintf(`{"type":"ack_summary","summary_id":%d}`, id-1))
	if v := questDisplay(t, w.Display); v.AwaySummary == nil || v.AwaySummary.ID != id || v.LastSeenAt != ackAt.Format(apiTimeLayout) {
		t.Fatalf("stale ack: %+v %s", v.AwaySummary, v.LastSeenAt)
	}
	w = ts.mustCommand(fmt.Sprintf(`{"type":"ack_summary","summary_id":%d}`, id))
	if v := questDisplay(t, w.Display); v.AwaySummary != nil {
		t.Fatalf("ack did not clear: %+v", v.AwaySummary)
	}
	w = ts.mustCommand(fmt.Sprintf(`{"type":"ack_summary","summary_id":%d}`, id))
	if v := questDisplay(t, w.Display); v.AwaySummary != nil {
		t.Fatalf("second ack: %+v", v.AwaySummary)
	}
	ts.expectUnvalidated(`{"type":"ack_summary"}`, http.StatusBadRequest, "invalid_command")
	if v := questDisplay(t, ts.getWorld().Display); v.AwaySummary != nil {
		t.Fatalf("summary after ack: %+v", v.AwaySummary)
	}
}

// TestAwaySummaryCoversWorkerEvents (R17, in-memory store): a scheduled
// event processed by the dev scheduler inside the gap neither moves
// last_seen_at nor consumes the gap; the summary starts at the last
// command and counts the ship built in between.
func TestAwaySummaryCoversWorkerEvents(t *testing.T) {
	ss := newShipServer(t)
	tiles := ""
	for y := 4; y <= 34; y++ {
		tiles += fmt.Sprintf(`{"x":2,"y":%d},`, y)
	}
	ss.mustCommand(`{"type":"place_road","island_id":"start","road_type":"road_dirt","tiles":[` + tiles + `{"x":3,"y":34},{"x":4,"y":34}]}`)
	w := ss.mustCommand(`{"type":"place_building","island_id":"start","building_type":"shipyard","x":5,"y":34,"rotation":0}`)
	shipyard := buildingIDs(t, w.Display, "shipyard")[0]
	ordered := ss.mustCommand(fmt.Sprintf(`{"type":"order_ship","island_id":"start","building_id":%d,"ship_type":"sloop"}`, shipyard))
	cmdAt := questDisplay(t, ordered.Display).LastSeenAt

	// The scheduler builds the ship at +2 min (ship_built) and commits.
	ss.advance(3 * time.Minute)
	var ships int
	var lastSeen string
	var pending bool
	if _, err := ss.sched.Store.Update(context.Background(), testWorld, func(w *sim.World, _ int64, _ time.Time) (bool, error) {
		ships, lastSeen, pending = len(w.Ships), w.LastSeenAt.Format(apiTimeLayout), w.PendingSummary != nil
		return false, nil
	}); err != nil {
		t.Fatal(err)
	}
	if ships != 1 || lastSeen != cmdAt || pending {
		t.Fatalf("after the scheduler: ships %d last seen %s pending summary %v", ships, lastSeen, pending)
	}
	ss.advance(time.Hour)
	v := questDisplay(t, ss.getWorld().Display)
	if v.AwaySummary == nil || v.AwaySummary.From != cmdAt || v.LastSeenAt != cmdAt {
		t.Fatalf("summary %+v last seen %s, want from %s", v.AwaySummary, v.LastSeenAt, cmdAt)
	}
}
