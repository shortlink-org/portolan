// Package tracing is the one switch that turns telemetry on.
//
// The service names its spans everywhere - in the driver, the bus, the cache,
// the outbox - against whatever tracer provider is global when each of them is
// built. This package is what installs that provider, so it has to run before
// assembly: a provider installed after the parts are built would trace nothing.
//
// The provider itself is the SDK's (go-sdk/observability/tracing): OTLP over
// plain gRPC, everything sampled, W3C and B3 propagation, a bounded flush on
// stop. It is switched on by TRACER_URI and names the service after
// SERVICE_NAME; the SDK documents the rest of its variables. This package adds
// only what the service decides for itself: the name it answers to when none
// is given, and the fact that unset means off at no cost.
package tracing

import (
	"context"
	"fmt"
	"log/slog"

	sdkconfig "github.com/shortlink-org/go-sdk/config"
	sdktracing "github.com/shortlink-org/go-sdk/observability/tracing"
)

const defaultServiceName = "auth"

// Start installs the global tracer provider and returns the function that
// flushes and stops it. The returned function is never nil and is safe to
// defer: with no TRACER_URI nothing is installed and it does nothing.
func Start(ctx context.Context) (func(), error) {
	cfg, err := sdkconfig.New()
	if err != nil {
		return nil, fmt.Errorf("tracing: config: %w", err)
	}
	cfg.SetDefault("SERVICE_NAME", defaultServiceName)

	// slog.Default writes where main's log package does, so "Tracing enable"
	// lands next to "listening on".
	_, stop, err := sdktracing.New(ctx, slog.Default(), cfg)
	if err != nil {
		return nil, fmt.Errorf("tracing: %w", err)
	}
	return stop, nil
}
