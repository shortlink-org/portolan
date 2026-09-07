package tracing

import (
	"context"
	"testing"

	"go.opentelemetry.io/otel"
)

// Without TRACER_URI Start must leave the global provider alone: the service
// is meant to run untraced at no cost, and a provider installed here would be
// one the spans below pay for.
func TestStart_NoEndpointInstallsNothing(t *testing.T) {
	t.Setenv("TRACER_URI", "")
	before := otel.GetTracerProvider()

	stop, err := Start(context.Background())
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
