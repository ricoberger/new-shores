//go:build integration

package api

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/ricoberger/new-shores/server/internal/events"
	"github.com/ricoberger/new-shores/server/internal/sim"
	"github.com/ricoberger/new-shores/server/internal/store"
	"github.com/ricoberger/new-shores/server/internal/store/postgres"
	"github.com/ricoberger/new-shores/server/internal/testenv"
	"github.com/ricoberger/new-shores/server/internal/testworld"
)

// pgInstance is an API instance in front of the shared PostgreSQL store
// that serves one world (like a dev-mode server; the world resolution is
// the only difference to a session).
type pgInstance struct {
	t    *testing.T
	srv  *Server
	pub  *recordingPublisher
	spec *specValidator
}

func newPGInstance(t *testing.T, st *postgres.Store, id store.WorldID) *pgInstance {
	t.Helper()
	pub := &recordingPublisher{}
	srv, err := New(Config{
		Store: st, Catalogue: catalogue(t), Clock: WallClock{}, Publisher: pub,
		ResolveWorld: func(*http.Request) (store.WorldID, error) { return id, nil },
		Logger:       slog.New(slog.NewTextHandler(io.Discard, nil)),
	})
	if err != nil {
		t.Fatal(err)
	}
	return &pgInstance{t: t, srv: srv, pub: pub, spec: loadSpec(t)}
}

func (in *pgInstance) do(method, path, body string) worldJSON {
	in.t.Helper()
	req := httptest.NewRequestWithContext(context.Background(), method, path, strings.NewReader(body))
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	rec := httptest.NewRecorder()
	in.srv.ServeHTTP(rec, req)
	res := response{status: rec.Code, header: rec.Header(), body: rec.Body.Bytes()}
	in.spec.validate(in.t, method, path, body, res)
	if res.status != http.StatusOK {
		in.t.Fatalf("%s %s: %d %s", method, path, res.status, res.body)
	}
	var w worldJSON
	if err := json.Unmarshal(res.body, &w); err != nil {
		in.t.Fatal(err)
	}
	return w
}

func (in *pgInstance) get() (int64, questView) {
	in.t.Helper()
	w := in.do(http.MethodGet, "/api/v1/world", "")
	return w.Version, questDisplay(in.t, w.Display)
}

func dbNow(t *testing.T, st *postgres.Store) time.Time {
	t.Helper()
	var now time.Time
	if err := postgres.InTx(context.Background(), st.Pool(), func(tx pgx.Tx) error {
		var err error
		now, err = postgres.DBNow(context.Background(), tx)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	return now
}

func storedWorld(t *testing.T, st *postgres.Store, id store.WorldID) *sim.World {
	t.Helper()
	var out *sim.World
	if _, err := st.Update(context.Background(), id, func(w *sim.World, _ int64, _ time.Time) (bool, error) {
		out = w.Clone()
		return false, nil
	}); err != nil {
		t.Fatal(err)
	}
	return out
}

// TestAwaySummaryAcrossWorkerEvent (R17): last command at T0, the worker
// processes an advance_to event at T0 + 6 h (committing the advanced
// world), GET /world at T0 + 12 h: the summary starts at T0 and its goods
// totals cover the whole 12 hours.
func TestAwaySummaryAcrossWorkerEvent(t *testing.T) {
	_, pool := testenv.Database(t)
	c := catalogue(t)
	st := postgres.New(pool, c, slog.New(slog.NewTextHandler(io.Discard, nil)))
	t0 := dbNow(t, st).Add(-12 * time.Hour).Truncate(time.Millisecond)

	// The player's last commands at T0: a plank chain on the dev island.
	w, err := testworld.Founded(c, t0)
	if err != nil {
		t.Fatal(err)
	}
	var road []sim.Pos
	for x := 3; x <= 36; x++ {
		road = append(road, sim.Pos{X: x, Y: 4})
	}
	for _, cmd := range []sim.Command{
		sim.PlaceRoad{IslandID: "start", Type: "road_dirt", Tiles: road},
		sim.PlaceBuilding{IslandID: "start", Type: "house_settlers", X: 8, Y: 5, Rotation: 180},
		sim.PlaceBuilding{IslandID: "start", Type: "house_settlers", X: 10, Y: 5, Rotation: 180},
		sim.PlaceBuilding{IslandID: "start", Type: "lumberjack", X: 35, Y: 5, Rotation: 180},
		sim.PlaceField{IslandID: "start", FarmID: 4, Type: "tree_plot", X: 34, Y: 5},
		sim.PlaceBuilding{IslandID: "start", Type: "sawmill", X: 20, Y: 5, Rotation: 180},
	} {
		if err := sim.Apply(w, c, cmd); err != nil {
			t.Fatalf("%#v: %v", cmd, err)
		}
	}
	sim.MarkSeen(w)
	ref := w.Clone()
	id := testenv.StoreWorld(t, st, w)

	testenv.InsertEvent(t, st, t0.Add(6*time.Hour), events.KindAdvanceTo, []store.WorldID{id}, map[string]any{})
	worker := &events.Worker{
		Store: st, Registry: events.DefaultRegistry(48 * time.Hour), Catalogue: c,
		Logger: slog.New(slog.NewTextHandler(io.Discard, nil)), PollInterval: 50 * time.Millisecond,
	}
	for {
		n, err := worker.RunOnce(context.Background())
		if err != nil {
			t.Fatal(err)
		}
		if n == 0 {
			break
		}
	}
	mid := storedWorld(t, st, id)
	if !mid.LastEvaluatedAt.Equal(t0.Add(6*time.Hour)) || !mid.LastSeenAt.Equal(t0) || mid.PendingSummary != nil || len(mid.Away.Flows) == 0 {
		t.Fatalf("after the worker: evaluated %s, last seen %s, summary %v, flows %d", mid.LastEvaluatedAt, mid.LastSeenAt, mid.PendingSummary, len(mid.Away.Flows))
	}

	in := newPGInstance(t, st, id)
	_, v := in.get()
	if v.AwaySummary == nil || v.AwaySummary.From != t0.Format(apiTimeLayout) {
		t.Fatalf("summary %+v, want from %s", v.AwaySummary, t0.Format(apiTimeLayout))
	}
	to, err := time.Parse(apiTimeLayout, v.AwaySummary.To)
	if err != nil || to.Sub(t0) < 12*time.Hour {
		t.Fatalf("summary to %s (%v)", v.AwaySummary.To, err)
	}
	// The totals equal one advancement of the world from T0 to the end.
	l := sim.NewLedger()
	if _, err := sim.AdvanceWithLedger(ref, c, to, l); err != nil {
		t.Fatal(err)
	}
	stored := storedWorld(t, st, id)
	if stored.PendingSummary == nil {
		t.Fatal("the summary was not committed")
	}
	got := map[string]sim.AwayGood{}
	for _, is := range stored.PendingSummary.Islands {
		if is.ID == "start" {
			got = is.Goods
		}
	}
	for _, good := range []string{"wood", "planks", "fish"} {
		f := l.Flow("start", good)
		if g := got[good]; g.Produced != sim.FineToMilli(f.Produced) || g.Consumed != sim.FineToMilli(f.Consumed) {
			t.Errorf("%s: summary %+v, 12-hour ledger %+v", good, g, f)
		}
	}
	if got["planks"].Produced == 0 {
		t.Error("no planks produced in 12 hours")
	}
}

// TestAwaySummaryTwoInstances (R24): a summary produced on instance A is
// returned by instance B; a reload returns the identical summary; after
// ack_summary on B, instance A returns away_summary null.
func TestAwaySummaryTwoInstances(t *testing.T) {
	_, pool := testenv.Database(t)
	c := catalogue(t)
	st := postgres.New(pool, c, slog.New(slog.NewTextHandler(io.Discard, nil)))
	_, id := testenv.NewWorld(t, st, time.Hour)
	a, b := newPGInstance(t, st, id), newPGInstance(t, st, id)

	va, sa := a.get()
	if sa.AwaySummary == nil || va != 1 || a.pub.count() != 1 {
		t.Fatalf("instance A: summary %+v version %d published %d", sa.AwaySummary, va, a.pub.count())
	}
	vb, sb := b.get()
	if sb.AwaySummary == nil || sb.AwaySummary.ID != sa.AwaySummary.ID || vb != va || b.pub.count() != 0 {
		t.Fatalf("instance B: summary %+v version %d", sb.AwaySummary, vb)
	}
	if _, again := a.get(); again.AwaySummary == nil || again.AwaySummary.ID != sa.AwaySummary.ID {
		t.Fatalf("reload: %+v", again.AwaySummary)
	}
	b.do(http.MethodPost, "/api/v1/world/commands", fmt.Sprintf(`{"command":{"type":"ack_summary","summary_id":%d}}`, sa.AwaySummary.ID))
	if _, after := a.get(); after.AwaySummary != nil {
		t.Fatalf("after the ack on B, A returns %+v", after.AwaySummary)
	}
	if _, after := b.get(); after.AwaySummary != nil {
		t.Fatalf("after the ack, B returns %+v", after.AwaySummary)
	}
}
