//go:build integration

// Package testenv provides PostgreSQL and Redis for integration tests
// (build tag integration). TEST_DATABASE_URL and TEST_REDIS_URL select
// running servers; when unset, containers are started with testcontainers
// if Docker is available. Without either the tests are skipped — except
// when CI is set, where a missing database or Redis fails the test.
package testenv

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"io"
	"log/slog"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/wait"

	"github.com/ricoberger/new-shores/server/internal/store/postgres"
)

var (
	pgOnce    sync.Once
	pgURL     string
	pgErr     error
	redisOnce sync.Once
	redisURL  string
	redisErr  error
)

// unavailable skips the test, or fails it in CI.
func unavailable(t testing.TB, what string, err error) {
	t.Helper()
	if os.Getenv("CI") != "" {
		t.Fatalf("%s unavailable in CI: %v", what, err)
	}
	t.Skipf("%s unavailable (set TEST_DATABASE_URL/TEST_REDIS_URL or start Docker): %v", what, err)
}

// PostgresURL returns the URL of a PostgreSQL server (admin database).
func PostgresURL(t testing.TB) string {
	t.Helper()
	pgOnce.Do(func() {
		if u := os.Getenv("TEST_DATABASE_URL"); u != "" {
			pgURL = u
			return
		}
		ctx := context.Background()
		c, err := testcontainers.GenericContainer(ctx, testcontainers.GenericContainerRequest{
			ContainerRequest: testcontainers.ContainerRequest{
				Image:        "postgres:16-alpine",
				ExposedPorts: []string{"5432/tcp"},
				Env:          map[string]string{"POSTGRES_USER": "test", "POSTGRES_PASSWORD": "test", "POSTGRES_DB": "test"},
				WaitingFor:   wait.ForLog("database system is ready to accept connections").WithOccurrence(2).WithStartupTimeout(2 * time.Minute),
			},
			Started: true,
		})
		if err != nil {
			pgErr = err
			return
		}
		host, err := c.Host(ctx)
		if err != nil {
			pgErr = err
			return
		}
		port, err := c.MappedPort(ctx, "5432/tcp")
		if err != nil {
			pgErr = err
			return
		}
		pgURL = fmt.Sprintf("postgres://test:test@%s:%s/test?sslmode=disable", host, port.Port())
	})
	if pgErr != nil {
		unavailable(t, "PostgreSQL", pgErr)
	}
	return pgURL
}

// RedisURL returns the URL of a Redis server.
func RedisURL(t testing.TB) string {
	t.Helper()
	redisOnce.Do(func() {
		if u := os.Getenv("TEST_REDIS_URL"); u != "" {
			redisURL = u
			return
		}
		ctx := context.Background()
		c, err := testcontainers.GenericContainer(ctx, testcontainers.GenericContainerRequest{
			ContainerRequest: testcontainers.ContainerRequest{
				Image:        "redis:7-alpine",
				ExposedPorts: []string{"6379/tcp"},
				WaitingFor:   wait.ForListeningPort("6379/tcp").WithStartupTimeout(time.Minute),
			},
			Started: true,
		})
		if err != nil {
			redisErr = err
			return
		}
		host, err := c.Host(ctx)
		if err != nil {
			redisErr = err
			return
		}
		port, err := c.MappedPort(ctx, "6379/tcp")
		if err != nil {
			redisErr = err
			return
		}
		redisURL = fmt.Sprintf("redis://%s:%s/0", host, port.Port())
	})
	if redisErr != nil {
		unavailable(t, "Redis", redisErr)
	}
	return redisURL
}

// Redis returns a client of the test Redis, closed at cleanup.
func Redis(t testing.TB) *redis.Client {
	t.Helper()
	opts, err := redis.ParseURL(RedisURL(t))
	if err != nil {
		t.Fatal(err)
	}
	c := redis.NewClient(opts)
	if err := c.Ping(context.Background()).Err(); err != nil {
		unavailable(t, "Redis", err)
	}
	t.Cleanup(func() { _ = c.Close() })
	return c
}

func randomName(prefix string) string {
	b := make([]byte, 6)
	_, _ = rand.Read(b)
	return prefix + hex.EncodeToString(b)
}

// Database creates a fresh, migrated database for the test (dropped at
// cleanup) and returns its URL and a pool.
func Database(t testing.TB) (string, *pgxpool.Pool) {
	t.Helper()
	ctx := context.Background()
	admin := PostgresURL(t)
	conn, err := pgx.Connect(ctx, admin)
	if err != nil {
		unavailable(t, "PostgreSQL", err)
	}
	name := randomName("ns_test_")
	if _, err := conn.Exec(ctx, "CREATE DATABASE "+name); err != nil {
		_ = conn.Close(ctx)
		t.Fatal(err)
	}
	u, err := url.Parse(admin)
	if err != nil {
		t.Fatal(err)
	}
	u.Path = "/" + name
	dbURL := u.String()
	pool, err := postgres.Open(ctx, dbURL)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := postgres.Migrate(ctx, pool, slog.New(slog.NewTextHandler(io.Discard, nil))); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		pool.Close()
		_, _ = conn.Exec(ctx, "DROP DATABASE IF EXISTS "+name+" WITH (FORCE)")
		_ = conn.Close(ctx)
	})
	return dbURL, pool
}

// EmptyDatabase creates a fresh database without migrations.
func EmptyDatabase(t testing.TB) (string, *pgxpool.Pool) {
	t.Helper()
	ctx := context.Background()
	admin := PostgresURL(t)
	conn, err := pgx.Connect(ctx, admin)
	if err != nil {
		unavailable(t, "PostgreSQL", err)
	}
	name := randomName("ns_empty_")
	if _, err := conn.Exec(ctx, "CREATE DATABASE "+name); err != nil {
		_ = conn.Close(ctx)
		t.Fatal(err)
	}
	u, _ := url.Parse(admin)
	u.Path = "/" + name
	pool, err := postgres.Open(ctx, u.String())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		pool.Close()
		_, _ = conn.Exec(ctx, "DROP DATABASE IF EXISTS "+name+" WITH (FORCE)")
		_ = conn.Close(ctx)
	})
	return u.String(), pool
}

// RepoRoot returns the repository root.
func RepoRoot() string {
	_, file, _, _ := runtime.Caller(0)
	return filepath.Join(filepath.Dir(file), "..", "..", "..")
}

// SyncBuffer is a goroutine-safe log sink.
type SyncBuffer struct {
	mu sync.Mutex
	b  strings.Builder
}

func (s *SyncBuffer) Write(p []byte) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.b.Write(p)
}

func (s *SyncBuffer) String() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.b.String()
}
