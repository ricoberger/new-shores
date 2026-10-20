// Command server is the New Shores game server.
//
//	server --dev        one in-memory world, scaled wall clock, no
//	                    PostgreSQL or Redis (docs/FIRST_PLAYABLE.md, M1b)
//	server              default mode: PostgreSQL (DATABASE_URL) is the
//	                    source of truth, Redis (REDIS_URL) carries push and
//	                    rate limits; accounts, sessions, the scheduled-
//	                    events worker and WebSocket push are enabled
//	server migrate      applies the embedded database migrations and exits
//
// Configuration comes from flags and environment variables (README.md);
// an explicitly set flag wins over the environment.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/netip"
	"net/url"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/ricoberger/new-shores/server/internal/api"
	"github.com/ricoberger/new-shores/server/internal/auth"
	"github.com/ricoberger/new-shores/server/internal/content"
	"github.com/ricoberger/new-shores/server/internal/devworld"
	"github.com/ricoberger/new-shores/server/internal/events"
	"github.com/ricoberger/new-shores/server/internal/sim"
	"github.com/ricoberger/new-shores/server/internal/store"
	"github.com/ricoberger/new-shores/server/internal/store/postgres"
	"github.com/ricoberger/new-shores/server/internal/telemetry"
	"github.com/ricoberger/new-shores/server/internal/ws"
)

// version is overridden at build time via -ldflags "-X main.version=...".
var version = "dev"

// devWorldID is the ID of the single world of the dev server.
const devWorldID store.WorldID = "dev"

// Defaults of default mode.
const (
	defaultSessionTTL = 30 * 24 * time.Hour
	defaultFreshness  = 24 * time.Hour
	minFreshness      = time.Minute
	shutdownTimeout   = 10 * time.Second
)

type options struct {
	dev         bool
	addr        string
	content     string
	corsOrigins []string
	timeScale   float64
	logFormat   string

	// Default mode (environment only).
	databaseURL    string
	redisURL       string
	metricsAddr    string
	cookieSecure   bool
	sessionTTL     time.Duration
	freshness      time.Duration
	migrateOnStart bool
	trustedProxies []netip.Prefix
	smtpURL        string
	mailFrom       string
	publicURL      string
	instance       string
}

// parseFlags parses flags without environment variables (tests).
func parseFlags(args []string, stderr io.Writer) (options, error) {
	return parseConfig(args, func(string) string { return "" }, stderr)
}

func envOr(getenv func(string) string, key, def string) string {
	if v := getenv(key); v != "" {
		return v
	}
	return def
}

// parseConfig reads flags and environment variables. Flags default to the
// environment, so an explicitly set flag wins.
func parseConfig(args []string, getenv func(string) string, stderr io.Writer) (options, error) {
	var o options
	fs := flag.NewFlagSet("server", flag.ContinueOnError)
	fs.SetOutput(stderr)
	fs.BoolVar(&o.dev, "dev", false, "serve one in-memory world (no persistence; restarting resets it)")
	fs.StringVar(&o.addr, "addr", envOr(getenv, "LISTEN_ADDR", ":8080"), "listen address (env LISTEN_ADDR)")
	fs.StringVar(&o.content, "content", envOr(getenv, "CONTENT_DIR", "../content/old_coast"), "region content directory (env CONTENT_DIR)")
	corsOrigin := fs.String("cors-origin", envOr(getenv, "ALLOWED_ORIGINS", defaultCORSOrigins),
		"comma-separated browser origins allowed to call /api/ (scheme://host[:port]); also the CSRF and WebSocket origin list (env ALLOWED_ORIGINS)")
	fs.Float64Var(&o.timeScale, "time-scale", 1, "world seconds per wall-clock second (> 0; --dev only)")
	fs.StringVar(&o.logFormat, "log-format", envOr(getenv, "LOG_FORMAT", "text"), "log format: text or json (env LOG_FORMAT)")
	if err := fs.Parse(args); err != nil {
		return o, err
	}
	origins, err := parseOrigins(*corsOrigin)
	if err != nil {
		return o, fmt.Errorf("--cors-origin: %w", err)
	}
	o.corsOrigins = origins
	if fs.NArg() > 0 {
		return o, fmt.Errorf("unexpected arguments: %v", fs.Args())
	}
	if !(o.timeScale > 0) || o.timeScale > 1e6 {
		return o, fmt.Errorf("--time-scale must be > 0 and <= 1e6, got %v", o.timeScale)
	}
	if !o.dev {
		timeScaleSet := false
		fs.Visit(func(f *flag.Flag) { timeScaleSet = timeScaleSet || f.Name == "time-scale" })
		if timeScaleSet {
			return o, errors.New("--time-scale requires --dev (world time is the database clock)")
		}
	}
	if o.logFormat != "text" && o.logFormat != "json" {
		return o, fmt.Errorf("--log-format must be text or json, got %q", o.logFormat)
	}

	o.databaseURL = getenv("DATABASE_URL")
	o.redisURL = getenv("REDIS_URL")
	o.metricsAddr = envOr(getenv, "METRICS_ADDR", ":9090")
	o.smtpURL = getenv("SMTP_URL")
	o.mailFrom = getenv("MAIL_FROM")
	o.publicURL = envOr(getenv, "PUBLIC_URL", "http://localhost:8000")
	o.instance = getenv("INSTANCE_ID")
	if o.cookieSecure, err = envBool(getenv, "COOKIE_SECURE", false); err != nil {
		return o, err
	}
	if o.migrateOnStart, err = envBool(getenv, "MIGRATE_ON_START", false); err != nil {
		return o, err
	}
	if o.sessionTTL, err = envDuration(getenv, "SESSION_TTL", defaultSessionTTL); err != nil {
		return o, err
	}
	if o.sessionTTL < time.Hour {
		return o, fmt.Errorf("SESSION_TTL must be at least 1h, got %s", o.sessionTTL)
	}
	if o.freshness, err = envDuration(getenv, "FRESHNESS_INTERVAL", defaultFreshness); err != nil {
		return o, err
	}
	if o.freshness < minFreshness {
		return o, fmt.Errorf("FRESHNESS_INTERVAL must be at least %s, got %s", minFreshness, o.freshness)
	}
	if o.trustedProxies, err = parseProxies(getenv("TRUSTED_PROXIES")); err != nil {
		return o, err
	}
	if u, err := url.Parse(o.publicURL); err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return o, fmt.Errorf("PUBLIC_URL must be an http(s) URL, got %q", o.publicURL)
	}
	return o, nil
}

func envBool(getenv func(string) string, key string, def bool) (bool, error) {
	v := getenv(key)
	if v == "" {
		return def, nil
	}
	b, err := strconv.ParseBool(v)
	if err != nil {
		return false, fmt.Errorf("%s must be true or false, got %q", key, v)
	}
	return b, nil
}

func envDuration(getenv func(string) string, key string, def time.Duration) (time.Duration, error) {
	v := getenv(key)
	if v == "" {
		return def, nil
	}
	d, err := time.ParseDuration(v)
	if err != nil {
		return 0, fmt.Errorf("%s must be a Go duration like 24h, got %q", key, v)
	}
	return d, nil
}

// parseProxies parses TRUSTED_PROXIES: comma-separated IPs or CIDRs.
func parseProxies(list string) ([]netip.Prefix, error) {
	var out []netip.Prefix
	for _, raw := range strings.Split(list, ",") {
		s := strings.TrimSpace(raw)
		if s == "" {
			continue
		}
		if !strings.Contains(s, "/") {
			a, err := netip.ParseAddr(s)
			if err != nil {
				return nil, fmt.Errorf("TRUSTED_PROXIES: %q is not an IP or CIDR", s)
			}
			out = append(out, netip.PrefixFrom(a, a.BitLen()))
			continue
		}
		p, err := netip.ParsePrefix(s)
		if err != nil {
			return nil, fmt.Errorf("TRUSTED_PROXIES: %q is not an IP or CIDR", s)
		}
		out = append(out, p.Masked())
	}
	return out, nil
}

// defaultCORSOrigins are the origins of the Vite dev server: Vite prints
// http://127.0.0.1:5173 or http://localhost:5173 depending on how the
// system resolves "localhost", and the browser treats them as different
// origins, so both are allowed.
const defaultCORSOrigins = "http://localhost:5173,http://127.0.0.1:5173"

// parseOrigins splits a comma-separated origin list and validates that each
// entry is an origin (http or https scheme, host, optional port; no path,
// query or wildcard), since browsers compare origins exactly.
func parseOrigins(list string) ([]string, error) {
	var out []string
	for _, raw := range strings.Split(list, ",") {
		origin := strings.TrimSpace(raw)
		if origin == "" {
			continue
		}
		u, err := url.Parse(origin)
		if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" ||
			u.Path != "" || u.RawQuery != "" || u.Fragment != "" || u.User != nil || strings.Contains(u.Host, "*") {
			return nil, fmt.Errorf("%q is not an origin like http://localhost:5173", origin)
		}
		out = append(out, origin)
	}
	return out, nil
}

func newLogger(format string, w io.Writer) *slog.Logger {
	if format == "json" {
		return slog.New(slog.NewJSONHandler(w, nil))
	}
	return slog.New(slog.NewTextHandler(w, nil))
}

func main() {
	args := os.Args[1:]
	migrateOnly := len(args) > 0 && args[0] == "migrate"
	if migrateOnly {
		args = args[1:]
	}
	o, err := parseConfig(args, os.Getenv, os.Stderr)
	if err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return
		}
		slog.Error("invalid configuration", "error", err)
		os.Exit(2)
	}
	logger := newLogger(o.logFormat, os.Stderr)
	switch {
	case migrateOnly:
		err = runMigrate(o, logger)
	case o.dev:
		err = runDev(o, logger)
	default:
		err = runDefault(o, logger)
	}
	if err != nil {
		logger.Error("server failed", "error", err)
		os.Exit(1)
	}
}

func runMigrate(o options, logger *slog.Logger) error {
	if o.databaseURL == "" {
		return errors.New("DATABASE_URL is required")
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	pool, err := postgres.Open(ctx, o.databaseURL)
	if err != nil {
		return err
	}
	defer pool.Close()
	applied, err := postgres.Migrate(ctx, pool, logger)
	if err != nil {
		return err
	}
	logger.Info("migrations done", "applied", len(applied), "version", version)
	return nil
}

func newHTTPServer(addr string, h http.Handler) *http.Server {
	return &http.Server{
		Addr:              addr,
		Handler:           h,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       60 * time.Second,
	}
}

func runDev(o options, logger *slog.Logger) error {
	cat, err := content.Load(o.content)
	if err != nil {
		return fmt.Errorf("load content: %w", err)
	}
	clock := api.WallClock{}
	start := clock.Now().Truncate(time.Millisecond)
	w, err := devworld.NewDev(cat, start)
	if err != nil {
		return err
	}
	scale := api.TimeScale{Start: start, Scale: o.timeScale}
	hub := ws.NewHub(logger)
	handler, err := api.New(api.Config{
		Store:        store.NewMemory(devWorldID, w, func() time.Time { return scale.At(clock.Now()) }),
		Catalogue:    cat,
		Clock:        clock,
		ResolveWorld: func(*http.Request) (store.WorldID, error) { return devWorldID, nil },
		Publisher:    ws.LocalPublisher{Hub: hub},
		Hub:          hub,
		CORSOrigins:  o.corsOrigins,
		Version:      version,
		Logger:       logger,
	})
	if err != nil {
		return err
	}
	srv := newHTTPServer(o.addr, handler)

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	errc := make(chan error, 1)
	go func() { errc <- srv.ListenAndServe() }()
	logger.Info("dev server listening", "addr", o.addr, "content_version", cat.Region.Version, "time_scale", o.timeScale, "cors_origins", o.corsOrigins, "version", version)

	select {
	case err := <-errc:
		return err
	case <-ctx.Done():
	}
	logger.Info("shutting down")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
	defer cancel()
	err = srv.Shutdown(shutdownCtx)
	hub.Close(shutdownCtx)
	if err != nil {
		return fmt.Errorf("shutdown: %w", err)
	}
	return nil
}

func runDefault(o options, logger *slog.Logger) error {
	switch {
	case o.databaseURL == "" && o.redisURL == "":
		return errors.New("DATABASE_URL and REDIS_URL are required without --dev")
	case o.databaseURL == "":
		return errors.New("DATABASE_URL is required without --dev")
	case o.redisURL == "":
		return errors.New("REDIS_URL is required without --dev")
	}
	instance := o.instance
	if instance == "" {
		instance, _ = os.Hostname()
	}
	logger = logger.With("instance", instance)

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	shutdownTracing, err := telemetry.SetupTracing(ctx, "new-shores-server", version, instance)
	if err != nil {
		return err
	}
	cat, err := content.Load(o.content)
	if err != nil {
		return fmt.Errorf("load content: %w", err)
	}

	pool, err := postgres.Open(ctx, o.databaseURL)
	if err != nil {
		return err
	}
	defer pool.Close()
	if o.migrateOnStart {
		if _, err := postgres.Migrate(ctx, pool, logger); err != nil {
			return err
		}
	} else if err := postgres.CheckMigrations(ctx, pool); err != nil {
		return err
	}

	redisOpts, err := redis.ParseURL(o.redisURL)
	if err != nil {
		return fmt.Errorf("REDIS_URL: %w", err)
	}
	rdb := redis.NewClient(redisOpts)
	defer func() { _ = rdb.Close() }()
	if err := rdb.Ping(ctx).Err(); err != nil {
		// Redis is ephemeral: without it push and rate limiting degrade
		// (documented); the server still serves.
		logger.Error("redis unavailable at startup; push is off and rate limiting fails open until it is back", "error", err)
	}

	st := postgres.New(pool, cat.Region.Version, logger)
	var mailer auth.Mailer = auth.LogMailer{Logger: logger}
	if o.smtpURL != "" {
		if mailer, err = auth.NewSMTPMailer(o.smtpURL, o.mailFrom); err != nil {
			return err
		}
	}
	accounts, err := auth.NewService(auth.Config{
		Store:      st,
		NewWorld:   func(now time.Time) (*sim.World, error) { return devworld.New(cat, now) },
		Region:     cat.Region.ID,
		Freshness:  o.freshness,
		SessionTTL: o.sessionTTL,
		Argon2:     auth.DefaultArgon2,
		Mailer:     mailer,
		PublicURL:  o.publicURL,
		Logger:     logger,
	})
	if err != nil {
		return err
	}

	hub := ws.NewHub(logger)
	sub := ws.NewRedisSubscriber(ctx, rdb, hub, logger)
	publisher := ws.RedisPublisher{Client: rdb, Logger: logger}

	handler, err := api.New(api.Config{
		Store:     st,
		Catalogue: cat,
		Clock:     api.WallClock{},
		Accounts:  accounts,
		Limiter: &auth.RedisLimiter{
			Client: rdb, Prefix: "ratelimit:", Burst: 10, Rate: 10, Per: time.Minute, Logger: logger,
		},
		Publisher: publisher,
		Hub:       hub,
		Health: func(ctx context.Context) api.HealthReport {
			ctx, cancel := context.WithTimeout(ctx, 2*time.Second)
			defer cancel()
			h := api.HealthReport{Postgres: pool.Ping(ctx) == nil, Redis: "ok"}
			if rdb.Ping(ctx).Err() != nil {
				h.Redis = "unavailable"
			}
			return h
		},
		CORSOrigins:    o.corsOrigins,
		CookieSecure:   o.cookieSecure,
		SessionTTL:     o.sessionTTL,
		TrustedProxies: o.trustedProxies,
		Version:        version,
		Instance:       instance,
		Logger:         logger,
	})
	if err != nil {
		return err
	}

	workerCtx, stopWorker := context.WithCancel(context.Background())
	defer stopWorker()
	worker := &events.Worker{
		Store: st, Registry: events.DefaultRegistry(o.freshness), Catalogue: cat, Publisher: publisher, Logger: logger,
	}
	var workerDone sync.WaitGroup
	workerDone.Add(1)
	go func() {
		defer workerDone.Done()
		if err := worker.Run(workerCtx); err != nil {
			logger.Error("events worker stopped", "error", err)
		}
	}()

	srv := newHTTPServer(o.addr, handler)
	metricsMux := http.NewServeMux()
	metricsMux.Handle("/metrics", telemetry.MetricsHandler())
	metricsSrv := newHTTPServer(o.metricsAddr, metricsMux)

	errc := make(chan error, 2)
	go func() { errc <- srv.ListenAndServe() }()
	go func() { errc <- metricsSrv.ListenAndServe() }()
	logger.Info("server listening", "addr", o.addr, "metrics_addr", o.metricsAddr, "content_version", cat.Region.Version,
		"cors_origins", o.corsOrigins, "freshness_interval", o.freshness.String(), "event_kinds", worker.Registry.Kinds(), "version", version)

	var runErr error
	select {
	case runErr = <-errc:
	case <-ctx.Done():
	}
	logger.Info("shutting down")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
	defer cancel()
	// Stop accepting and drain in-flight HTTP requests, then stop the
	// worker after its current event, close the sockets, then the pools.
	if err := srv.Shutdown(shutdownCtx); err != nil {
		logger.Error("http shutdown", "error", err)
	}
	stopWorker()
	workerDone.Wait()
	hub.Close(shutdownCtx)
	_ = sub.Close()
	_ = metricsSrv.Shutdown(shutdownCtx)
	if err := shutdownTracing(shutdownCtx); err != nil {
		logger.Warn("tracing shutdown", "error", err)
	}
	if runErr != nil && !errors.Is(runErr, http.ErrServerClosed) {
		return runErr
	}
	return nil
}
