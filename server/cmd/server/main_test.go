package main

import (
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/ricoberger/new-shores/server/internal/content"
	"github.com/ricoberger/new-shores/server/internal/devworld"
	"github.com/ricoberger/new-shores/server/internal/sim"
)

func TestParseFlags(t *testing.T) {
	o, err := parseFlags([]string{"--dev", "--time-scale", "10", "--addr", ":9000"}, io.Discard)
	if err != nil || !o.dev || o.timeScale != 10 || o.addr != ":9000" || o.content != "../content/old_coast" ||
		!slices.Equal(o.corsOrigins, []string{"http://localhost:5173", "http://127.0.0.1:5173"}) {
		t.Fatalf("parseFlags = %+v, %v", o, err)
	}
	for _, args := range [][]string{
		{"--time-scale", "0"},
		{"--time-scale", "-1"},
		{"--time-scale", "NaN"},
		{"--log-format", "xml"},
		{"--unknown"},
		{"extra"},
		{"--cors-origin", "*"},
		{"--cors-origin", "localhost:5173"},
		{"--cors-origin", "http://localhost:5173/"},
		{"--cors-origin", "http://localhost:5173,ftp://x"},
	} {
		if _, err := parseFlags(args, io.Discard); err == nil {
			t.Errorf("parseFlags(%v) succeeded", args)
		}
	}
}

func TestParseOrigins(t *testing.T) {
	o, err := parseFlags([]string{"--cors-origin", " http://localhost:4174 , https://play.example.org "}, io.Discard)
	if err != nil || !slices.Equal(o.corsOrigins, []string{"http://localhost:4174", "https://play.example.org"}) {
		t.Fatalf("origins = %v, %v", o.corsOrigins, err)
	}
}

func TestParseConfigFromEnv(t *testing.T) {
	env := map[string]string{
		"LISTEN_ADDR": ":7000", "CONTENT_DIR": "/content", "ALLOWED_ORIGINS": "http://localhost:8000",
		"DATABASE_URL": "postgres://x", "REDIS_URL": "redis://y", "METRICS_ADDR": ":9999", "COOKIE_SECURE": "true",
		"SESSION_TTL": "720h", "FRESHNESS_INTERVAL": "1h", "MIGRATE_ON_START": "true",
		"TRUSTED_PROXIES": "10.0.0.0/8, 192.168.1.1", "PUBLIC_URL": "https://play.example.org", "INSTANCE_ID": "a", "LOG_FORMAT": "json",
	}
	o, err := parseConfig([]string{"--addr", ":7001"}, func(k string) string { return env[k] }, io.Discard)
	if err != nil {
		t.Fatal(err)
	}
	if o.addr != ":7001" || o.content != "/content" || !slices.Equal(o.corsOrigins, []string{"http://localhost:8000"}) ||
		o.databaseURL != "postgres://x" || o.redisURL != "redis://y" || o.metricsAddr != ":9999" || !o.cookieSecure ||
		o.sessionTTL.Hours() != 720 || o.freshness.Hours() != 1 || !o.migrateOnStart || len(o.trustedProxies) != 2 ||
		o.trustedProxies[1].String() != "192.168.1.1/32" || o.instance != "a" || o.logFormat != "json" {
		t.Fatalf("config %+v", o)
	}
	for k, v := range map[string]string{
		"FRESHNESS_INTERVAL": "59s", "SESSION_TTL": "1m", "COOKIE_SECURE": "maybe", "TRUSTED_PROXIES": "nope", "PUBLIC_URL": "ftp://x",
	} {
		bad := map[string]string{k: v}
		if _, err := parseConfig(nil, func(k string) string { return bad[k] }, io.Discard); err == nil {
			t.Errorf("%s=%s accepted", k, v)
		}
	}
}

// TestTimeScaleRequiresDev: world time is the database clock without --dev.
func TestTimeScaleRequiresDev(t *testing.T) {
	if _, err := parseFlags([]string{"--time-scale", "10"}, io.Discard); err == nil {
		t.Fatal("--time-scale accepted without --dev")
	}
	if _, err := parseFlags([]string{"--dev", "--time-scale", "10"}, io.Discard); err != nil {
		t.Fatal(err)
	}
}

// TestSeedFlag: --seed picks the dev archipelago (D-053); player worlds
// get a random seed, so it requires --dev.
func TestSeedFlag(t *testing.T) {
	if o, err := parseFlags([]string{"--dev"}, io.Discard); err != nil || o.seed != devworld.DevSeed {
		t.Fatalf("default seed = %d, %v (want %d)", o.seed, err, devworld.DevSeed)
	}
	if o, err := parseFlags([]string{"--dev", "--seed", "42"}, io.Discard); err != nil || o.seed != 42 {
		t.Fatalf("--seed 42 = %d, %v", o.seed, err)
	}
	for _, args := range [][]string{{"--seed", "42"}, {"--dev", "--seed", "0"}, {"--dev", "--seed", "9007199254740992"}, {"--dev", "--seed", "-1"}} {
		if _, err := parseFlags(args, io.Discard); err == nil {
			t.Errorf("parseFlags(%v) succeeded", args)
		}
	}
}

func TestDefaultModeRequiresDatabaseAndRedis(t *testing.T) {
	for _, c := range []struct{ db, redis, want string }{
		{"", "", "DATABASE_URL and REDIS_URL are required"},
		{"postgres://x", "", "REDIS_URL is required"},
		{"", "redis://x", "DATABASE_URL is required"},
	} {
		err := runDefault(options{databaseURL: c.db, redisURL: c.redis}, nil)
		if err == nil || !strings.Contains(err.Error(), c.want) {
			t.Errorf("%+v: %v", c, err)
		}
	}
}

// TestFixtureAndSnapshotFlags (D-066): --fixture and --snapshot pick the
// dev start state; both need --dev, exclude each other, and --fixture is
// validated against devworld.Fixtures().
func TestFixtureAndSnapshotFlags(t *testing.T) {
	o, err := parseFlags([]string{"--dev", "--fixture", "settled"}, io.Discard)
	if err != nil || o.fixture != "settled" {
		t.Fatalf("--fixture settled = %+v, %v", o, err)
	}
	o, err = parseFlags([]string{"--dev", "--snapshot", "s.json", "--resume-now"}, io.Discard)
	if err != nil || o.snapshot != "s.json" || !o.resumeNow {
		t.Fatalf("--snapshot = %+v, %v", o, err)
	}
	for _, args := range [][]string{
		{"--fixture", "settled"},
		{"--snapshot", "s.json"},
		{"--resume-now"},
		{"--dev", "--resume-now"},
		{"--dev", "--fixture", "settled", "--snapshot", "s.json"},
	} {
		if _, err := parseFlags(args, io.Discard); err == nil {
			t.Errorf("parseFlags(%v) succeeded", args)
		}
	}
	_, err = parseFlags([]string{"--dev", "--fixture", "nope"}, io.Discard)
	if err == nil || !strings.Contains(err.Error(), "nope") {
		t.Fatalf("unknown fixture: %v", err)
	}
	for _, name := range devworld.Fixtures() {
		if !strings.Contains(err.Error(), name) {
			t.Errorf("error %q does not list the fixture %q", err, name)
		}
	}
}

// TestDevStartWorld: the start world is the fixture or the snapshot; a
// snapshot keeps its times unless --resume-now moves them to the start.
func TestDevStartWorld(t *testing.T) {
	cat, err := content.Load("../../../content/old_coast")
	if err != nil {
		t.Fatal(err)
	}
	logger := slog.New(slog.DiscardHandler)
	start := time.Date(2026, 3, 1, 12, 0, 0, 0, time.UTC)

	w, err := devStartWorld(options{fixture: "town", seed: devworld.DevSeed}, cat, start, logger)
	if err != nil || len(w.Islands[0].Buildings) == 0 || !w.LastEvaluatedAt.Equal(start) {
		t.Fatalf("--fixture town: %v (evaluated %v)", err, w)
	}

	data, err := sim.Encode(w, cat.Region.Version)
	if err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(t.TempDir(), "s.json")
	if err := os.WriteFile(file, data, 0o600); err != nil {
		t.Fatal(err)
	}
	later := start.Add(3 * time.Hour)
	kept, err := devStartWorld(options{snapshot: file}, cat, later, logger)
	if err != nil || !kept.LastEvaluatedAt.Equal(start) {
		t.Fatalf("--snapshot: %v, evaluated %v, want %v", err, kept.LastEvaluatedAt, start)
	}
	shifted, err := devStartWorld(options{snapshot: file, resumeNow: true}, cat, later, logger)
	if err != nil || !shifted.LastEvaluatedAt.Equal(later) {
		t.Fatalf("--snapshot --resume-now: %v, evaluated %v, want %v", err, shifted.LastEvaluatedAt, later)
	}

	if _, err := devStartWorld(options{snapshot: filepath.Join(t.TempDir(), "missing.json")}, cat, start, logger); err == nil {
		t.Error("missing snapshot file accepted")
	}
	bad := filepath.Join(t.TempDir(), "bad.json")
	if err := os.WriteFile(bad, []byte(`{"schema_version":999999,"content_version":"x","world":{}}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := devStartWorld(options{snapshot: bad}, cat, start, logger); err == nil {
		t.Error("snapshot of another schema version accepted")
	}
}
