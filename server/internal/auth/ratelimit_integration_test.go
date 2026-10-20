//go:build integration

package auth

import (
	"bytes"
	"context"
	"fmt"
	"log/slog"
	"strings"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/ricoberger/new-shores/server/internal/testenv"
)

func TestRedisTokenBucket(t *testing.T) {
	client := testenv.Redis(t)
	now := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	l := &RedisLimiter{Client: client, Prefix: fmt.Sprintf("test:%s:%d:", t.Name(), time.Now().UnixNano()), Burst: 10, Rate: 10, Per: time.Minute,
		Logger: slog.New(slog.NewTextHandler(&bytes.Buffer{}, nil)), Now: func() time.Time { return now }}
	ctx := context.Background()
	for i := range 10 {
		if ok, _ := l.Allow(ctx, "k"); !ok {
			t.Fatalf("request %d limited", i)
		}
	}
	ok, retry := l.Allow(ctx, "k")
	if ok || retry <= 0 || retry > 6*time.Second {
		t.Fatalf("11th request: ok %v retry %s", ok, retry)
	}
	if ok, _ := l.Allow(ctx, "other"); !ok {
		t.Fatal("keys share a bucket")
	}
	now = now.Add(6 * time.Second) // one token refilled (10/min)
	if ok, _ := l.Allow(ctx, "k"); !ok {
		t.Fatal("no refill")
	}
	if ok, _ := l.Allow(ctx, "k"); ok {
		t.Fatal("refilled more than one token")
	}
}

// TestRateLimiterFailsOpen: without Redis the limiter allows requests and
// logs the outage once.
func TestRateLimiterFailsOpen(t *testing.T) {
	var logs bytes.Buffer
	client := redis.NewClient(&redis.Options{Addr: "127.0.0.1:1", MaxRetries: -1, DialTimeout: 100 * time.Millisecond})
	defer func() { _ = client.Close() }()
	l := &RedisLimiter{Client: client, Prefix: "x:", Burst: 1, Rate: 1, Per: time.Minute, Logger: slog.New(slog.NewTextHandler(&logs, nil))}
	for range 3 {
		if ok, _ := l.Allow(context.Background(), "k"); !ok {
			t.Fatal("limited without Redis")
		}
	}
	if n := strings.Count(logs.String(), "level=ERROR"); n != 1 {
		t.Fatalf("%d error lines, want 1:\n%s", n, logs.String())
	}
}
