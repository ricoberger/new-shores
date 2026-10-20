package telemetry

import (
	"context"
	"fmt"
	"net/http"
	"os"

	"github.com/prometheus/client_golang/prometheus/promhttp"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/trace"
)

const tracerName = "github.com/ricoberger/new-shores/server"

// Tracer returns the server's tracer (a no-op tracer until SetupTracing
// installs an exporter).
func Tracer() trace.Tracer { return otel.Tracer(tracerName) }

// SetupTracing installs an OTLP/HTTP trace exporter when
// OTEL_EXPORTER_OTLP_ENDPOINT or OTEL_EXPORTER_OTLP_TRACES_ENDPOINT is set
// (the exporter reads the standard OTEL_* variables itself). Without them
// tracing stays a no-op. The returned function flushes and stops the
// exporter.
func SetupTracing(ctx context.Context, service, version, instance string) (func(context.Context) error, error) {
	if os.Getenv("OTEL_EXPORTER_OTLP_ENDPOINT") == "" && os.Getenv("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT") == "" {
		return func(context.Context) error { return nil }, nil
	}
	exp, err := otlptracehttp.New(ctx)
	if err != nil {
		return nil, fmt.Errorf("otlp exporter: %w", err)
	}
	res, err := resource.Merge(resource.Default(), resource.NewSchemaless(
		attribute.String("service.name", service),
		attribute.String("service.version", version),
		attribute.String("service.instance.id", instance),
	))
	if err != nil {
		return nil, fmt.Errorf("otel resource: %w", err)
	}
	tp := sdktrace.NewTracerProvider(sdktrace.WithBatcher(exp), sdktrace.WithResource(res))
	otel.SetTracerProvider(tp)
	otel.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator(propagation.TraceContext{}, propagation.Baggage{}))
	return tp.Shutdown, nil
}

// MetricsHandler serves Registry in the Prometheus exposition format.
func MetricsHandler() http.Handler {
	return promhttp.HandlerFor(Registry, promhttp.HandlerOpts{Registry: Registry})
}
