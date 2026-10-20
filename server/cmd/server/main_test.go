package main

import (
	"io"
	"slices"
	"strings"
	"testing"
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
