package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"slices"
	"sync"
	"testing"
	"time"

	"github.com/ricoberger/new-shores/server/internal/sim"
	"github.com/ricoberger/new-shores/server/internal/sim/scenario"
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
		ID         int64  `json:"id"`
		From       string `json:"from"`
		To         string `json:"to"`
		GoldBefore int64  `json:"gold_before"`
		GoldAfter  int64  `json:"gold_after"`
		Population map[string]struct {
			Before int64 `json:"before"`
			After  int64 `json:"after"`
		} `json:"population"`
		Islands []struct {
			ID    string `json:"id"`
			Goods map[string]struct {
				Lost       int64 `json:"lost"`
				StockAfter int64 `json:"stock_after"`
			} `json:"goods"`
		} `json:"islands"`
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
	home, road, planks := c.Quests[0], c.Quests[1], c.Quests[2]
	if len(home.Rewards.Goods) != 0 || len(road.Rewards.Goods) != 0 || len(planks.Rewards.Goods) == 0 {
		t.Fatalf("the shipped chain changed: %s %s %s", home.ID, road.ID, planks.ID)
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
	// The founded start island completed the first quest (D-051).
	ts.mustCommand(claim(home.ID, ""))

	// The road from below the warehouse to the forest completes the road
	// quest at once.
	w := questDisplay(t, ts.mustCommand(`{"type":"place_road","island_id":"start","road_type":"road_dirt","tiles":[`+roadTiles(3, 36, 4)+`]}`).Display)
	if len(w.Quests.Claimable) != 1 || w.Quests.Claimable[0] != road.ID {
		t.Fatalf("claimable %v", w.Quests.Claimable)
	}
	gold := w.Gold
	w = questDisplay(t, ts.mustCommand(claim(road.ID, "")).Display)
	if w.Gold != gold+road.Rewards.Gold || len(w.Quests.Claimable) != 0 || !w.Quests.Completed[1].Claimed {
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
	w := ss.mustCommand(`{"type":"place_building","island_id":"start","building_type":"shipyard","x":5,"y":34,"rotation":180}`)
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

// TestAwaySummaryOfReturningCommand (R16-R18): when the returning command
// produces the summary, the summary still reports gold and population at
// the last command (the command's own effects belong to the interval) and
// the goods the command lost.
func TestAwaySummaryOfReturningCommand(t *testing.T) {
	gap := time.Duration(catalogue(t).Region.Rules.AwaySummaryMs) * time.Millisecond
	returning := func(t *testing.T, ts *testServer, cmd string) questView {
		t.Helper()
		ts.clock.Add(gap)
		v := questDisplay(t, ts.mustCommand(cmd).Display)
		if v.AwaySummary == nil {
			t.Fatalf("%s produced no summary", cmd)
		}
		return v
	}

	t.Run("purchase", func(t *testing.T) {
		ts := newTestServer(t, 1)
		start := questDisplay(t, ts.mustCommand(cmdRoad).Display)
		v := returning(t, ts, `{"type":"place_building","island_id":"start","building_type":"lumberjack","x":35,"y":5,"rotation":180}`)
		// The lumberjack's price and the start sloop's upkeep over the gap.
		cost := catalogue(t).BuildingByID["lumberjack"].Cost.Gold + catalogue(t).ShipByID["sloop"].UpkeepPerMin*int64(gap/time.Minute)
		if v.AwaySummary.GoldBefore != start.Gold || v.AwaySummary.GoldAfter != start.Gold-cost || v.Gold != start.Gold-cost {
			t.Fatalf("gold %d -> %d (display %d), want %d -> %d", v.AwaySummary.GoldBefore, v.AwaySummary.GoldAfter, v.Gold, start.Gold, start.Gold-cost)
		}
	})

	t.Run("house placement", func(t *testing.T) {
		ts := newTestServer(t, 1)
		ts.mustCommand(cmdRoad)
		v := returning(t, ts, `{"type":"place_building","island_id":"start","building_type":"house_settlers","x":8,"y":5,"rotation":180}`)
		if p := v.AwaySummary.Population["settlers"]; p.Before != 0 || p.After != 2_000 {
			t.Fatalf("settlers %+v, want 0 -> 2000", p)
		}
	})

	t.Run("goods-overflow claim", func(t *testing.T) {
		ts := newTestServer(t, 1)
		c := catalogue(t)
		ts.mustCommand(`{"type":"place_road","island_id":"start","road_type":"road_dirt","tiles":[` + roadTiles(3, 36, 4) + `]}`)
		ts.mustCommand(`{"type":"place_building","island_id":"start","building_type":"lumberjack","x":35,"y":5,"rotation":180}`)
		w := questDisplay(t, ts.mustCommand(`{"type":"place_building","island_id":"start","building_type":"sawmill","x":20,"y":5,"rotation":180}`).Display)
		planks := c.Quests[2]
		if len(w.Quests.Claimable) != 3 || w.Quests.Claimable[2] != planks.ID {
			t.Fatalf("claimable %v", w.Quests.Claimable)
		}
		// Fill the planks up to 10 below the capacity (a grant, not a
		// command). Nothing produces planks during the gap: the sawmill
		// has no workers.
		ts.mutateWorld(func(w *sim.World) {
			is := w.Island("start")
			free := int64(300_000) - is.Inventory.Stock["planks"] - 10_000
			if err := sim.AddStock(w, c, "start", "planks", free, nil); err != nil {
				t.Fatal(err)
			}
		})
		v := returning(t, ts, fmt.Sprintf(`{"type":"claim_quest","quest_id":%q,"island_id":"start"}`, planks.ID))
		var lost, stock int64 = -1, -1
		for _, is := range v.AwaySummary.Islands {
			if is.ID == "start" {
				lost, stock = is.Goods["planks"].Lost, is.Goods["planks"].StockAfter
			}
		}
		if want := planks.Rewards.Goods[0].Amount - 10_000; lost != want || stock != 300_000 {
			t.Fatalf("planks lost %d stock %d, want lost %d at capacity", lost, stock, want)
		}
	})
}

// TestAwaySummaryOfReturningUpgrade (R18): a house upgrade as the
// returning command moves residents between tiers inside the interval; the
// summary reports both tiers as they were at the last command.
func TestAwaySummaryOfReturningUpgrade(t *testing.T) {
	c := shippedCatalogue(t)
	s, err := scenario.Load(os.DirFS(filepath.Join(repoRoot(t), "server", "testdata", "scenarios")), "bootstrap_citizens.json")
	if err != nil {
		t.Fatal(err)
	}
	upgrade := slices.IndexFunc(s.Steps, func(st scenario.Step) bool { return st.Upgrade != nil })
	w, err := scenario.RunSteps(s, c, upgrade)
	if err != nil {
		t.Fatal(err)
	}
	house := w.Islands[0].BuildingAt(c, s.Steps[upgrade].Upgrade.X, s.Steps[upgrade].Upgrade.Y)
	sim.MarkSeen(w)
	ds, err := sim.Display(w, c, w.LastEvaluatedAt)
	if err != nil {
		t.Fatal(err)
	}
	var settlers int64
	for _, is := range ds.Islands {
		settlers += is.Population["settlers"]
	}
	ts := newTestServerWith(t, w, w.LastEvaluatedAt, 1, c)
	ts.clock.Add(time.Duration(c.Region.Rules.AwaySummaryMs) * time.Millisecond)
	v := questDisplay(t, ts.mustCommand(fmt.Sprintf(`{"type":"upgrade_house","island_id":%q,"building_id":%d}`, w.Islands[0].ID, house.ID)).Display)
	if v.AwaySummary == nil {
		t.Fatal("no summary")
	}
	if p := v.AwaySummary.Population["citizens"]; p.Before != 0 || p.After != 5_000 {
		t.Errorf("citizens %+v, want 0 -> 5000", p)
	}
	if p := v.AwaySummary.Population["settlers"]; p.Before != settlers || p.After >= p.Before {
		t.Errorf("settlers %+v, want before %d and fewer after", p, settlers)
	}
}
