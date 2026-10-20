// Package telemetry holds the Prometheus metrics and the OpenTelemetry
// tracing setup of the server (docs/ARCHITECTURE.md §8).
//
// Metrics are registered in Registry (not the global default registry) and
// served on the separate metrics listener (METRICS_ADDR).
package telemetry

import (
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/collectors"
)

// Registry holds every metric of the server plus the Go and process
// collectors.
var Registry = prometheus.NewRegistry()

var (
	// EventsPending is the number of pending scheduled events (queue
	// depth), sampled by the worker poll.
	EventsPending = prometheus.NewGauge(prometheus.GaugeOpts{
		Name: "events_pending",
		Help: "Pending scheduled events (queue depth), sampled by the worker poll.",
	})
	// EventsLag is now - due_at when an event is processed.
	EventsLag = prometheus.NewHistogram(prometheus.HistogramOpts{
		Name:    "events_lag_seconds",
		Help:    "Delay between an event's due_at and its processing (database clock).",
		Buckets: []float64{0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60, 120, 300},
	})
	// EventsHandlerDuration is the processing time of one event by kind
	// (advance, handler and commit).
	EventsHandlerDuration = prometheus.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "events_handler_duration_seconds",
		Help:    "Processing time of one scheduled event (lock, advance, handler, commit).",
		Buckets: prometheus.DefBuckets,
	}, []string{"kind"})
	// EventsProcessed counts processed events by kind and outcome
	// (done, retry, failed).
	EventsProcessed = prometheus.NewCounterVec(prometheus.CounterOpts{
		Name: "events_processed_total",
		Help: "Processed scheduled events by kind and outcome (done, retry, failed).",
	}, []string{"kind", "outcome"})

	// HTTPRequestDuration is the latency of HTTP requests by route.
	HTTPRequestDuration = prometheus.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "http_request_duration_seconds",
		Help:    "HTTP request latency by method, route and status code.",
		Buckets: []float64{0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10},
	}, []string{"method", "route", "status"})

	// TimeBackwards counts requests that failed with sim.ErrTimeBackwards.
	TimeBackwards = prometheus.NewCounter(prometheus.CounterOpts{
		Name: "world_time_backwards_total",
		Help: "World updates that failed because the world time was before the last evaluation.",
	})
	// ContentVersionMismatch counts worlds loaded with a content version
	// other than the loaded catalogue's (accepted in M2).
	ContentVersionMismatch = prometheus.NewCounter(prometheus.CounterOpts{
		Name: "world_content_version_mismatch_total",
		Help: "Worlds loaded whose stored content_version differs from the loaded catalogue.",
	})
	// RateLimitFailOpen counts auth requests let through because Redis
	// was unreachable.
	RateLimitFailOpen = prometheus.NewCounter(prometheus.CounterOpts{
		Name: "ratelimit_fail_open_total",
		Help: "Auth requests allowed without a rate-limit check because Redis was unreachable.",
	})
	// PublishErrors counts failed world_changed publishes.
	PublishErrors = prometheus.NewCounter(prometheus.CounterOpts{
		Name: "ws_publish_errors_total",
		Help: "Failed publishes of world changes to Redis.",
	})
	// WSConnections is the number of open WebSocket connections.
	WSConnections = prometheus.NewGauge(prometheus.GaugeOpts{
		Name: "ws_connections",
		Help: "Open WebSocket connections on this instance.",
	})
)

func init() {
	Registry.MustRegister(
		collectors.NewGoCollector(),
		collectors.NewProcessCollector(collectors.ProcessCollectorOpts{}),
		EventsPending, EventsLag, EventsHandlerDuration, EventsProcessed,
		HTTPRequestDuration, TimeBackwards, ContentVersionMismatch,
		RateLimitFailOpen, PublishErrors, WSConnections,
	)
}
