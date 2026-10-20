//go:build integration

package main

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"

	"github.com/ricoberger/new-shores/server/internal/store"
	"github.com/ricoberger/new-shores/server/internal/store/postgres"
	"github.com/ricoberger/new-shores/server/internal/testenv"
)

const testOrigin = "http://localhost:5173"

func freeAddr(t *testing.T) string {
	t.Helper()
	l, err := (&net.ListenConfig{}).Listen(context.Background(), "tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = l.Close() }()
	return l.Addr().String()
}

type instance struct {
	name, addr, metrics string
	logs                *testenv.SyncBuffer
}

func (in *instance) url(path string) string { return "http://" + in.addr + path }

// startInstance runs the test binary in default mode.
func startInstance(t *testing.T, bin, name, dbURL, redisURL string) *instance {
	t.Helper()
	in := &instance{name: name, addr: freeAddr(t), metrics: freeAddr(t), logs: &testenv.SyncBuffer{}}
	cmd := exec.CommandContext(context.Background(), bin) // #nosec G204 -- test binary built by the test.
	cmd.Env = append(os.Environ(),
		"DATABASE_URL="+dbURL, "REDIS_URL="+redisURL, "LISTEN_ADDR="+in.addr, "METRICS_ADDR="+in.metrics,
		"CONTENT_DIR="+filepath.Join(testenv.RepoRoot(), "content", "old_coast"), "INSTANCE_ID="+name,
		"ALLOWED_ORIGINS="+testOrigin, "LOG_FORMAT=text", "FRESHNESS_INTERVAL=24h",
		// The test sends X-Forwarded-For so that its many guests do not
		// share one rate-limit bucket.
		"TRUSTED_PROXIES=127.0.0.1")
	cmd.Stdout = in.logs
	cmd.Stderr = in.logs
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = cmd.Process.Signal(os.Interrupt)
		done := make(chan struct{})
		go func() {
			_ = cmd.Wait()
			close(done)
		}()
		select {
		case <-done:
		case <-time.After(15 * time.Second):
			_ = cmd.Process.Kill()
			t.Errorf("instance %s did not shut down within 15 s", name)
		}
		if t.Failed() {
			t.Logf("logs of %s:\n%s", name, in.logs.String())
		}
	})
	deadline := time.Now().Add(30 * time.Second)
	for {
		res, err := httpGet(in.url("/healthz"), nil)
		if err == nil && res.status == 200 {
			var h struct {
				Instance string `json:"instance"`
				Postgres string `json:"postgres"`
			}
			_ = json.Unmarshal(res.body, &h)
			if h.Instance != name || h.Postgres != "ok" {
				t.Fatalf("healthz of %s: %s", name, res.body)
			}
			return in
		}
		if time.Now().After(deadline) {
			t.Fatalf("instance %s not healthy: %v\n%s", name, err, in.logs.String())
		}
		time.Sleep(100 * time.Millisecond)
	}
}

type httpResult struct {
	status int
	body   []byte
}

func httpDo(method, url, body string, header map[string]string) (httpResult, error) {
	req, err := http.NewRequestWithContext(context.Background(), method, url, strings.NewReader(body))
	if err != nil {
		return httpResult{}, err
	}
	for k, v := range header {
		req.Header.Set(k, v)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return httpResult{}, err
	}
	defer func() { _ = res.Body.Close() }()
	b, err := io.ReadAll(res.Body)
	return httpResult{status: res.StatusCode, body: b}, err
}

func httpGet(url string, header map[string]string) (httpResult, error) {
	return httpDo(http.MethodGet, url, "", header)
}

type worldView struct {
	Version int64 `json:"version"`
	Display struct {
		Islands []struct {
			Buildings []json.RawMessage `json:"buildings"`
			Roads     []json.RawMessage `json:"roads"`
			Inventory map[string]struct {
				Stock int64 `json:"stock"`
			} `json:"inventory"`
		} `json:"islands"`
	} `json:"display"`
}

func getWorld(t *testing.T, in *instance, token string) worldView {
	t.Helper()
	res, err := httpGet(in.url("/api/v1/world"), map[string]string{"Authorization": "Bearer " + token})
	if err != nil || res.status != 200 {
		t.Fatalf("GET /world on %s: %v %d %s", in.name, err, res.status, res.body)
	}
	var w worldView
	if err := json.Unmarshal(res.body, &w); err != nil {
		t.Fatal(err)
	}
	return w
}

// clientIPs gives every guest its own (documentation-range) client IP.
var clientIPs = func() chan string {
	c := make(chan string, 256)
	base := time.Now().UnixNano()
	for i := range 256 {
		c <- fmt.Sprintf("2001:db8:%x::%x", base&0xffff, i+1)
	}
	return c
}()

func newGuest(t *testing.T, in *instance) (token, playerID string) {
	t.Helper()
	res, err := httpDo(http.MethodPost, in.url("/api/v1/auth/guest"), `{"transport":"bearer"}`,
		map[string]string{"Content-Type": "application/json", "X-Forwarded-For": <-clientIPs})
	if err != nil || res.status != 200 {
		t.Fatalf("guest: %v %d %s", err, res.status, res.body)
	}
	var out struct {
		SessionToken string `json:"session_token"`
		Player       struct {
			ID string `json:"id"`
		} `json:"player"`
	}
	_ = json.Unmarshal(res.body, &out)
	return out.SessionToken, out.Player.ID
}

var processedRe = regexp.MustCompile(`(?m)^events_processed_total\{kind="test_credit",outcome="done"\} (\d+)$`)

func processed(t *testing.T, in *instance) int {
	t.Helper()
	res, err := httpGet("http://"+in.metrics+"/metrics", nil)
	if err != nil || res.status != 200 {
		t.Fatalf("metrics of %s: %v", in.name, err)
	}
	for _, name := range []string{"events_pending", "events_lag_seconds", "events_handler_duration_seconds", "events_processed_total", "http_request_duration_seconds"} {
		if !strings.Contains(string(res.body), name) {
			t.Errorf("metrics of %s lack %s", in.name, name)
		}
	}
	m := processedRe.FindSubmatch(res.body)
	if m == nil {
		return 0
	}
	n, _ := strconv.Atoi(string(m[1]))
	return n
}

// TestMultiInstance (8.3): two server processes share one PostgreSQL and
// Redis: a command on A is visible on B, a WebSocket on B receives the push
// of a command on A within 1 s, and both drain one event queue without
// duplicate processing.
func TestMultiInstance(t *testing.T) {
	dbURL, pool := testenv.Database(t)
	redisURL := testenv.RedisURL(t)
	testenv.Redis(t) // skip when Redis is unreachable

	bin := filepath.Join(t.TempDir(), "server")
	build := exec.CommandContext(context.Background(), "go", "build", "-tags", "testevents", "-o", bin, ".") // #nosec G204 -- fixed arguments.
	build.Dir = filepath.Join(testenv.RepoRoot(), "server", "cmd", "server")
	if out, err := build.CombinedOutput(); err != nil {
		t.Fatalf("build: %v\n%s", err, out)
	}
	a := startInstance(t, bin, "a", dbURL, redisURL)
	b := startInstance(t, bin, "b", dbURL, redisURL)

	// A guest created on A; its WebSocket is on B.
	token, _ := newGuest(t, a)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	conn, resp, err := websocket.Dial(ctx, "ws://"+b.addr+"/api/v1/ws", &websocket.DialOptions{
		HTTPHeader: http.Header{"Authorization": {"Bearer " + token}},
	})
	if err != nil {
		t.Fatalf("ws dial on B: %v", err)
	}
	if resp != nil && resp.Body != nil {
		_ = resp.Body.Close()
	}
	defer func() { _ = conn.CloseNow() }()
	// Give B's hub a moment to confirm its Redis subscription.
	time.Sleep(300 * time.Millisecond)

	cmd := `{"command":{"type":"place_road","island_id":"start","road_type":"road_dirt","tiles":[{"x":3,"y":4},{"x":4,"y":4}]}}`
	sent := time.Now()
	res, err := httpDo(http.MethodPost, a.url("/api/v1/world/commands"), cmd, map[string]string{"Authorization": "Bearer " + token, "Content-Type": "application/json"})
	if err != nil || res.status != 200 {
		t.Fatalf("command on A: %v %d %s", err, res.status, res.body)
	}
	// The 1 s budget starts when the command is sent, not when it returns.
	readCtx, readCancel := context.WithDeadline(ctx, sent.Add(time.Second))
	_, msg, err := conn.Read(readCtx)
	readCancel()
	elapsed := time.Since(sent)
	if err != nil {
		t.Fatalf("no push on B within 1 s of sending a command to A (%s): %v", elapsed, err)
	}
	if elapsed > time.Second {
		t.Fatalf("push arrived %s after the command was sent, want <= 1 s", elapsed)
	}
	t.Logf("command sent on A -> push received on B: %s", elapsed)
	var m struct {
		Type    string `json:"type"`
		WorldID string `json:"world_id"`
	}
	if err := json.Unmarshal(msg, &m); err != nil || m.Type != "world_changed" || m.WorldID == "" {
		t.Fatalf("message %s", msg)
	}

	// The command is visible on B with the same version and layout.
	wa, wb := getWorld(t, a, token), getWorld(t, b, token)
	ja, _ := json.Marshal(wa.Display.Islands[0].Buildings)
	jb, _ := json.Marshal(wb.Display.Islands[0].Buildings)
	if wa.Version != 1 || wb.Version != 1 || string(ja) != string(jb) || len(wb.Display.Islands[0].Roads) != 2 {
		t.Fatalf("A version %d, B version %d, roads on B %d", wa.Version, wb.Version, len(wb.Display.Islands[0].Roads))
	}

	// Shared event queue: 200 test_credit events over 10 worlds, drained
	// by both instances.
	st := postgres.New(pool, testenv.Catalogue(t).Region.Version, slog.New(slog.DiscardHandler))
	type guest struct {
		token string
		world store.WorldID
	}
	var guests []guest
	for i := range 10 {
		in := a
		if i%2 == 1 {
			in = b
		}
		tok, pid := newGuest(t, in)
		wid, err := postgres.WorldOfPlayer(context.Background(), pool, pid, "old_coast")
		if err != nil {
			t.Fatal(err)
		}
		guests = append(guests, guest{tok, wid})
	}
	var newest time.Time
	_ = pool.QueryRow(context.Background(), "SELECT max(last_evaluated_at) FROM worlds").Scan(&newest)
	time.Sleep(time.Second)
	const total = 200
	for i := range total {
		g := guests[i%len(guests)]
		// test_credit (compiled into the binary with -tags testevents).
		testenv.InsertEvent(t, st, newest.Add(time.Duration(i)*time.Millisecond), "test_credit", []store.WorldID{g.world},
			map[string]any{"credits": []map[string]any{{"world_id": g.world, "island_id": "start", "good": "wood", "amount_milli": 1000}}})
	}
	deadline := time.Now().Add(60 * time.Second)
	for {
		var pending int
		_ = pool.QueryRow(context.Background(), "SELECT count(*) FROM scheduled_events WHERE kind = 'test_credit' AND status <> 'done'").Scan(&pending)
		if pending == 0 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("%d test_credit events not done", pending)
		}
		time.Sleep(100 * time.Millisecond)
	}
	for _, g := range guests {
		w := getWorld(t, a, g.token)
		if got := w.Display.Islands[0].Inventory["wood"].Stock; got != total/int64(len(guests))*1000 {
			t.Errorf("world %s: wood %d milli, want %d", g.world, got, total/int64(len(guests))*1000)
		}
	}
	pa, pb := processed(t, a), processed(t, b)
	t.Logf("events processed: A %d, B %d", pa, pb)
	if pa+pb != total {
		t.Fatalf("processed %d + %d, want %d (duplicates)", pa, pb, total)
	}
	if pa == 0 || pb == 0 {
		t.Fatalf("one instance processed nothing (A %d, B %d)", pa, pb)
	}
	scanForSecrets(t, token, a, b)
}

// scanForSecrets: session tokens never reach the logs.
func scanForSecrets(t *testing.T, token string, ins ...*instance) {
	t.Helper()
	for _, in := range ins {
		sc := bufio.NewScanner(strings.NewReader(in.logs.String()))
		for sc.Scan() {
			if strings.Contains(sc.Text(), token) {
				t.Fatalf("token in the logs of %s: %s", in.name, sc.Text())
			}
		}
	}
}
