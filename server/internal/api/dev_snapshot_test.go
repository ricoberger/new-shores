package api

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/ricoberger/new-shores/server/internal/devworld"
	"github.com/ricoberger/new-shores/server/internal/sim"
	"github.com/ricoberger/new-shores/server/internal/store"
)

// newSnapshotServer is a dev-mode test server with the reset and snapshot
// routes wired like cmd/server. worldNow is the world time.
func newSnapshotServer(t *testing.T) (ts *testServer, worldNow func() time.Time) {
	t.Helper()
	ts = newTestServer(t, 1)
	c := catalogue(t)
	worldNow = func() time.Time { return TimeScale{Start: testStart, Scale: 1}.At(ts.clock.Now()) }
	srv, err := New(Config{
		Store:        ts.mem,
		Catalogue:    c,
		Clock:        ts.clock,
		ResolveWorld: func(*http.Request) (store.WorldID, error) { return testWorld, nil },
		CORSOrigins:  []string{testOrigin},
		Logger:       slog.New(slog.NewTextHandler(&syncWriter{w: ts.logs}, nil)),
		DevReset: func(ctx context.Context, fixture string) (int64, error) {
			w, err := devworld.NewFixture(c, fixture, devworld.DevSeed, worldNow())
			if err != nil {
				return 0, err
			}
			return ts.mem.Reset(ctx, w)
		},
		DevFixtures: devworld.Fixtures(),
		DevSnapshotLoad: func(ctx context.Context, w *sim.World, resumeNow bool) (int64, error) {
			if resumeNow {
				store.ResumeAt(w, worldNow())
			}
			return ts.mem.Reset(ctx, w)
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	ts.srv = srv
	return ts, worldNow
}

func (ts *testServer) snapshot() response {
	ts.t.Helper()
	res := ts.do(http.MethodGet, "/api/v1/dev/snapshot", "", false)
	if res.status != http.StatusOK {
		ts.t.Fatalf("GET /dev/snapshot: %d %s", res.status, res.body)
	}
	return res
}

type pendingKey struct {
	DueAt   time.Time
	Kind    string
	Payload string
}

// pendingKeys is store.Pending() without the event IDs.
func (ts *testServer) pendingKeys() []pendingKey {
	var out []pendingKey
	for _, e := range ts.mem.Pending() {
		out = append(out, pendingKey{e.DueAt, e.Kind, string(e.Payload)})
	}
	return out
}

func snapshotErrorCode(t *testing.T, res response) string {
	t.Helper()
	var e errorBody
	if err := json.Unmarshal(res.body, &e); err != nil {
		t.Fatalf("error body %q: %v", res.body, err)
	}
	return e.Error.Code
}

// TestDevSnapshotRoundTrip (D-066): export, reset to another fixture,
// import: the world (compared as its Encode output, which includes the
// scheduled events' sources) and the pending events are restored.
func TestDevSnapshotRoundTrip(t *testing.T) {
	ts, _ := newSnapshotServer(t)
	if _, status := ts.reset(`{"fixture":"settled"}`); status != http.StatusOK {
		t.Fatalf("reset settled: %d", status)
	}
	ts.clock.Add(time.Minute)
	saved := ts.snapshot()
	if ct := saved.header.Get("Content-Type"); ct != "application/json" {
		t.Errorf("Content-Type = %q", ct)
	}
	if cd := saved.header.Get("Content-Disposition"); !strings.HasPrefix(cd, fmt.Sprintf(`attachment; filename="snapshot-%d-`, devworld.DevSeed)) || !strings.HasSuffix(cd, `.json"`) {
		t.Errorf("Content-Disposition = %q", cd)
	}
	if cc := saved.header.Get("Cache-Control"); cc != "no-store" {
		t.Errorf("Cache-Control = %q", cc)
	}
	pending := ts.pendingKeys()
	if len(pending) == 0 {
		t.Fatal("the settled fixture has no pending event")
	}
	versionBefore := ts.getWorld().Version

	if _, status := ts.reset(`{"fixture":"default"}`); status != http.StatusOK {
		t.Fatal("reset default failed")
	}
	if bytes.Equal(ts.snapshot().body, saved.body) || len(ts.mem.Pending()) != 0 && reflect.DeepEqual(ts.pendingKeys(), pending) {
		t.Fatal("the reset did not change the world")
	}

	res := ts.do(http.MethodPost, "/api/v1/dev/snapshot", string(saved.body), false)
	if res.status != http.StatusOK {
		t.Fatalf("POST /dev/snapshot: %d %s", res.status, res.body)
	}
	var out devSnapshotResponse
	if err := json.Unmarshal(res.body, &out); err != nil {
		t.Fatal(err)
	}
	if out.Seed != devworld.DevSeed || !out.LastEvaluatedAt.Equal(testStart.Add(time.Minute)) || out.WorldVersion <= versionBefore {
		t.Errorf("response %+v (version before %d)", out, versionBefore)
	}
	if got := ts.getWorld().Version; got != out.WorldVersion {
		t.Errorf("GET /world version %d, snapshot answered %d", got, out.WorldVersion)
	}
	if got := ts.snapshot().body; !bytes.Equal(got, saved.body) {
		t.Errorf("the restored world encodes differently (%d vs %d bytes)", len(got), len(saved.body))
	}
	if got := ts.pendingKeys(); !reflect.DeepEqual(got, pending) {
		t.Errorf("pending after load %v, want %v", got, pending)
	}
}

// TestDevSnapshotRejected: a schema or content version the server cannot
// load is 409 with a code, malformed input 400; the world stays.
func TestDevSnapshotRejected(t *testing.T) {
	ts, _ := newSnapshotServer(t)
	saved := ts.snapshot().body
	var env map[string]json.RawMessage
	if err := json.Unmarshal(saved, &env); err != nil {
		t.Fatal(err)
	}
	with := func(key, value string) string {
		e := maps(env)
		e[key] = json.RawMessage(value)
		b, err := json.Marshal(e)
		if err != nil {
			t.Fatal(err)
		}
		return string(b)
	}
	version := ts.getWorld().Version

	for _, c := range []struct {
		name, body, query, code string
		status                  int
	}{
		{"newer schema", with("schema_version", fmt.Sprint(sim.SchemaVersion+1)), "", CodeSnapshotSchemaMismatch, http.StatusConflict},
		{"unbridged schema", with("schema_version", "1"), "", CodeSnapshotSchemaMismatch, http.StatusConflict},
		{"content version", with("content_version", `"other"`), "", CodeSnapshotContentMismatch, http.StatusConflict},
		{"garbage", "not json", "", CodeBadRequest, http.StatusBadRequest},
		{"truncated", string(saved[:len(saved)/2]), "", CodeBadRequest, http.StatusBadRequest},
		{"bad resume", string(saved), "?resume=later", CodeBadRequest, http.StatusBadRequest},
	} {
		res := ts.do(http.MethodPost, "/api/v1/dev/snapshot"+c.query, c.body, false)
		if res.status != c.status || snapshotErrorCode(t, res) != c.code {
			t.Errorf("%s: %d %s, want %d %s", c.name, res.status, res.body, c.status, c.code)
		}
	}
	if got := ts.getWorld().Version; got != version {
		t.Errorf("version %d after rejected loads, want %d", got, version)
	}
}

func maps(m map[string]json.RawMessage) map[string]json.RawMessage {
	out := make(map[string]json.RawMessage, len(m))
	for k, v := range m {
		out[k] = v
	}
	return out
}

// TestDevSnapshotResumeNow: ?resume=now moves LastEvaluatedAt to the
// world time and every due moment with it (relative distances stay); the
// plain load keeps the times.
func TestDevSnapshotResumeNow(t *testing.T) {
	ts, worldNow := newSnapshotServer(t)
	if _, status := ts.reset(`{"fixture":"settled"}`); status != http.StatusOK {
		t.Fatalf("reset: %d", status)
	}
	saved := ts.snapshot()
	savedEvaluated := worldNow()
	due := ts.pendingKeys()
	if len(due) == 0 {
		t.Fatal("no due moments in the settled fixture")
	}
	ts.clock.Add(3 * time.Hour)

	res := ts.do(http.MethodPost, "/api/v1/dev/snapshot?resume=now", string(saved.body), false)
	if res.status != http.StatusOK {
		t.Fatalf("resume=now: %d %s", res.status, res.body)
	}
	var out devSnapshotResponse
	if err := json.Unmarshal(res.body, &out); err != nil {
		t.Fatal(err)
	}
	now := worldNow()
	if !out.LastEvaluatedAt.Equal(now) {
		t.Errorf("last_evaluated_at %s, want now %s", out.LastEvaluatedAt, now)
	}
	got := ts.pendingKeys()
	if len(got) != len(due) {
		t.Fatalf("pending %v, want %d events", got, len(due))
	}
	for i := range got {
		if want := due[i].DueAt.Add(now.Sub(savedEvaluated)); !got[i].DueAt.Equal(want) || got[i].Kind != due[i].Kind {
			t.Errorf("pending %d due %s, want %s", i, got[i].DueAt, want)
		}
	}
	if seen, summary := ts.seenAndSummary(); !seen.Equal(now) || summary {
		t.Errorf("resume=now: last_seen_at %s (want %s), away summary %v (want none)", seen, now, summary)
	}

	// Without resume the times stay and the load plays "while you were away".
	res = ts.do(http.MethodPost, "/api/v1/dev/snapshot", string(saved.body), false)
	if res.status != http.StatusOK {
		t.Fatalf("plain load: %d %s", res.status, res.body)
	}
	if err := json.Unmarshal(res.body, &out); err != nil || !out.LastEvaluatedAt.Equal(savedEvaluated) {
		t.Errorf("plain load: last_evaluated_at %s (%v), want %s", out.LastEvaluatedAt, err, savedEvaluated)
	}
	if got := ts.pendingKeys(); !reflect.DeepEqual(got, due) {
		t.Errorf("pending after plain load %v, want %v", got, due)
	}
	// The player was last seen when the snapshot was taken, 3 h ago: the
	// next read plays "while you were away" from there.
	if seen, _ := ts.seenAndSummary(); !seen.Equal(savedEvaluated) {
		t.Errorf("plain load: last_seen_at %s, want %s", seen, savedEvaluated)
	}
}

// seenAndSummary is the display's last_seen_at and whether it carries an
// away summary.
func (ts *testServer) seenAndSummary() (time.Time, bool) {
	ts.t.Helper()
	var d struct {
		LastSeenAt  time.Time        `json:"last_seen_at"`
		AwaySummary *json.RawMessage `json:"away_summary"`
	}
	if err := json.Unmarshal(ts.getWorld().Display, &d); err != nil {
		ts.t.Fatal(err)
	}
	return d.LastSeenAt, d.AwaySummary != nil
}

// durationKeys are _ms fields that are durations, not times.
var durationKeys = map[string]bool{"transfer_delay_ms": true, "loop_ms": true}

// TestResumeAtShiftsEveryTime guards store.ResumeAt against a new absolute
// time field of the world: every nonzero *_ms / *_at field of the encoded
// world (but durations and the away state) must move by the same delta.
func TestResumeAtShiftsEveryTime(t *testing.T) {
	c := catalogue(t)
	for _, name := range []string{devworld.FixtureSettled, devworld.FixtureCitizens} {
		t.Run(name, func(t *testing.T) {
			w, err := devworld.NewFixture(c, name, devworld.DevSeed, testStart)
			if err != nil {
				t.Fatal(err)
			}
			w.Away, w.PendingSummary = sim.AwayLog{}, nil
			// Fields the fixtures leave unset.
			base := testStart.UnixMilli()
			w.LastTrialMs = base - 1000
			w.Islands[0].Buildings[0].PausedAtMs = base - 2000
			for _, s := range w.Ships {
				s.PausedAtMs, s.QueuedAtMs, s.BerthUntilMs = base-3000, base-4000, base+5000
			}
			before := generic(t, w)
			delta := 5*time.Hour + 123*time.Millisecond
			store.ResumeAt(w, testStart.Add(delta))
			after := generic(t, w)
			n := 0
			compareTimes(t, "world", before, after, delta, &n)
			if n == 0 {
				t.Error("no time field found: the guard checks nothing")
			}
			t.Logf("%d time fields shifted", n)
		})
	}
}

func generic(t *testing.T, w *sim.World) any {
	t.Helper()
	b, err := json.Marshal(w)
	if err != nil {
		t.Fatal(err)
	}
	var v any
	if err := json.Unmarshal(b, &v); err != nil {
		t.Fatal(err)
	}
	return v
}

func compareTimes(t *testing.T, path string, before, after any, delta time.Duration, n *int) {
	t.Helper()
	switch b := before.(type) {
	case map[string]any:
		a := after.(map[string]any)
		for k, bv := range b {
			if k == "away" || k == "pending_summary" {
				continue
			}
			av, ok := a[k]
			if !ok {
				t.Errorf("%s.%s vanished", path, k)
				continue
			}
			p := path + "." + k
			switch {
			case strings.HasSuffix(k, "_ms") && !durationKeys[k]:
				bn, _ := bv.(float64)
				an, _ := av.(float64)
				if bn != 0 {
					*n++
					if an-bn != float64(delta.Milliseconds()) {
						t.Errorf("%s: %v -> %v, want +%d ms", p, bn, an, delta.Milliseconds())
					}
				}
			case strings.HasSuffix(k, "_at"):
				bs, _ := bv.(string)
				as, _ := av.(string)
				bt, err1 := time.Parse(time.RFC3339Nano, bs)
				at, err2 := time.Parse(time.RFC3339Nano, as)
				if err1 != nil || err2 != nil {
					t.Errorf("%s: not a time: %v %v", p, bv, av)
					continue
				}
				*n++
				// last_seen_at is the present, everything else moves by delta.
				if k != "last_seen_at" && at.Sub(bt) != delta {
					t.Errorf("%s: %s -> %s, want +%s", p, bs, as, delta)
				}
				if k == "last_seen_at" && !at.Equal(bt.Add(delta)) {
					t.Errorf("%s: %s -> %s, want the new world time", p, bs, as)
				}
			default:
				compareTimes(t, p, bv, av, delta, n)
			}
		}
	case []any:
		a := after.([]any)
		for i := range b {
			compareTimes(t, fmt.Sprintf("%s[%d]", path, i), b[i], a[i], delta, n)
		}
	}
}
