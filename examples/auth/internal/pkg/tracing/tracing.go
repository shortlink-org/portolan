// Package tracing is the one switch that turns telemetry on.
//
// The service names its spans everywhere - in the driver, the bus, the cache,
// the outbox - against whatever tracer provider is global when each of them is
// built. This package is what installs that provider, so it has to run before
// assembly: a provider installed after the parts are built would trace nothing.
//
// It reads two variables:
//
//	TRACER_URI    the OTLP collector to send spans to, host:port, plain gRPC
//	SERVICE_NAME  what the spans call this service; "auth" when unset
//
// With no TRACER_URI nothing is installed, the global provider stays the
// no-op one, and every span in the service costs nothing.
package tracing

import (
	"context"
	"fmt"
	"os"
	"time"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracegrpc"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
)

const (
	defaultServiceName = "auth"

	// shutdownTimeout bounds the final flush. Spans not exported by then are
	// dropped: a service told to stop should stop, not wait on a collector.
	shutdownTimeout = 10 * time.Second
)

// Config is what Start needs. An empty Endpoint means "do not trace".
type Config struct {
	// Endpoint is the collector's host:port. Spans are sent over plain gRPC.
	Endpoint string

	// ServiceName is the service.name resource attribute on every span.
	ServiceName string
}

// FromEnv reads Config from TRACER_URI and SERVICE_NAME.
func FromEnv() Config {
	cfg := Config{
		Endpoint:    os.Getenv("TRACER_URI"),
		ServiceName: os.Getenv("SERVICE_NAME"),
	}
	if cfg.ServiceName == "" {
		cfg.ServiceName = defaultServiceName
	}
	return cfg
}

// Start installs an OTLP tracer provider as the global one and returns the
// function that flushes and stops it. The returned function is never nil and
// is safe to defer: with an empty Endpoint nothing is installed and it does
// nothing.
//
// Everything is sampled. This switch is for recording what the service does,
// not for watching it in production.
func Start(ctx context.Context, cfg Config) (func(), error) {
	if cfg.Endpoint == "" {
		return func() {}, nil
	}

	exporter, err := otlptracegrpc.New(ctx,
		otlptracegrpc.WithEndpoint(cfg.Endpoint),
		otlptracegrpc.WithInsecure(),
	)
	if err != nil {
		return nil, fmt.Errorf("tracing: exporter: %w", err)
	}

	name := cfg.ServiceName
	if name == "" {
		name = defaultServiceName
	}
	// Schemaless on purpose: merging two resources that name different schema
	// versions is refused, and the default resource names whichever version
	// the SDK was built against.
	res, err := resource.Merge(resource.Default(), resource.NewSchemaless(
		attribute.String("service.name", name),
	))
	if err != nil {
		return nil, fmt.Errorf("tracing: resource: %w", err)
	}

	provider := sdktrace.NewTracerProvider(
		sdktrace.WithBatcher(exporter),
		sdktrace.WithResource(res),
		sdktrace.WithSampler(sdktrace.AlwaysSample()),
	)
	otel.SetTracerProvider(provider)
	otel.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator(
		propagation.TraceContext{}, propagation.Baggage{},
	))

	return func() {
		// A fresh context: the one Start was given belongs to startup and
		// may well be cancelled by the time the service stops.
		shutdownCtx, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
		defer cancel()
		_ = provider.Shutdown(shutdownCtx)
	}, nil
}
