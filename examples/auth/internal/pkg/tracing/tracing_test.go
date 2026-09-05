package tracing

import (
	"context"
	"testing"

	"go.opentelemetry.io/otel"
)

func TestFromEnv_DefaultsServiceName(t *testing.T) {
	t.Setenv("TRACER_URI", "")
	t.Setenv("SERVICE_NAME", "")

	cfg := FromEnv()
	if cfg.Endpoint != "" {
		t.Fatalf("Endpoint = %q, want empty", cfg.Endpoint)
	}
	if cfg.ServiceName != defaultServiceName {
		t.Fatalf("ServiceName = %q, want %q", cfg.ServiceName, defaultServiceName)
	}
}

func TestFromEnv_ReadsBoth(t *testing.T) {
	t.Setenv("TRACER_URI", "collector:4317")
	t.Setenv("SERVICE_NAME", "auth-canary")

	cfg := FromEnv()
	if cfg.Endpoint != "collector:4317" || cfg.ServiceName != "auth-canary" {
		t.Fatalf("FromEnv() = %+v", cfg)
	}
}

// Without an endpoint Start must leave the global provider alone: the service
// is meant to run untraced at no cost, and a provider installed here would be
// one the spans below pay for.
func TestStart_NoEndpointInstallsNothing(t *testing.T) {
	before := otel.GetTracerProvider()

	stop, err := Start(context.Background(), Config{})
	if err != nil {
		t.Fatalf("Start: %v", err)
	}
	if stop == nil {
		t.Fatal("Start returned a nil stop")
	}
	stop()

	if otel.GetTracerProvider() != before {
		t.Fatal("Start installed a tracer provider with no endpoint")
	}
}
