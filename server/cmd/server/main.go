// Command server is the New Shores game server. In this milestone it serves
// one in-memory world in --dev mode (docs/FIRST_PLAYABLE.md, M1b); without
// --dev it only reports its version. Persistence, auth and the events worker
// follow in M2.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/ricoberger/new-shores/server/internal/api"
	"github.com/ricoberger/new-shores/server/internal/content"
	"github.com/ricoberger/new-shores/server/internal/devworld"
	"github.com/ricoberger/new-shores/server/internal/store"
)

// version is overridden at build time via -ldflags "-X main.version=...".
var version = "dev"

// devWorldID is the ID of the single world of the dev server.
const devWorldID store.WorldID = "dev"

type options struct {
	dev         bool
	addr        string
	content     string
	corsOrigins []string
	timeScale   float64
	logFormat   string
}

func parseFlags(args []string, stderr io.Writer) (options, error) {
	var o options
	fs := flag.NewFlagSet("server", flag.ContinueOnError)
	fs.SetOutput(stderr)
	fs.BoolVar(&o.dev, "dev", false, "serve one in-memory world (no persistence; restarting resets it)")
	fs.StringVar(&o.addr, "addr", ":8080", "listen address")
	fs.StringVar(&o.content, "content", "../content/old_coast", "region content directory")
	corsOrigin := fs.String("cors-origin", defaultCORSOrigins, "comma-separated browser origins allowed to call /api/ (scheme://host[:port])")
	fs.Float64Var(&o.timeScale, "time-scale", 1, "world seconds per wall-clock second (> 0)")
	fs.StringVar(&o.logFormat, "log-format", "text", "log format: text or json")
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
	if o.logFormat != "text" && o.logFormat != "json" {
		return o, fmt.Errorf("--log-format must be text or json, got %q", o.logFormat)
	}
	return o, nil
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
	o, err := parseFlags(os.Args[1:], os.Stderr)
	if err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return
		}
		slog.Error("invalid flags", "error", err)
		os.Exit(2)
	}
	if !o.dev {
		fmt.Printf("new-shores server %s\n", version)
		return
	}
	logger := newLogger(o.logFormat, os.Stderr)
	if err := runDev(o, logger); err != nil {
		logger.Error("server failed", "error", err)
		os.Exit(1)
	}
}

func runDev(o options, logger *slog.Logger) error {
	cat, err := content.Load(o.content)
	if err != nil {
		return fmt.Errorf("load content: %w", err)
	}
	clock := api.WallClock{}
	start := clock.Now().Truncate(time.Millisecond)
	w, err := devworld.New(cat, start)
	if err != nil {
		return err
	}
	handler, err := api.New(api.Config{
		Store:        store.NewMemory(devWorldID, w, func() time.Time { return api.TimeScale{Start: start, Scale: o.timeScale}.At(clock.Now()) }),
		Catalogue:    cat,
		Clock:        clock,
		ResolveWorld: func(*http.Request) (store.WorldID, error) { return devWorldID, nil },
		CORSOrigins:  o.corsOrigins,
		Logger:       logger,
	})
	if err != nil {
		return err
	}
	srv := &http.Server{
		Addr:              o.addr,
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

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
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		return fmt.Errorf("shutdown: %w", err)
	}
	return nil
}
