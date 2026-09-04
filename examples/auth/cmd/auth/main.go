// Command auth runs the service.
//
// It does three things and no more: assemble, listen, stop when told. Every
// decision worth reading about is somewhere under internal/.
package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracegrpc"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"

	"github.com/shortlink-org/portolan/examples/auth/internal/di"
)

const (
	defaultAddr     = ":8080"
	shutdownTimeout = 10 * time.Second
)

func main() {
	addr := os.Getenv("AUTH_ADDR")
	if addr == "" {
		addr = defaultAddr
	}

	// Tracing is switched on by naming a collector, and it has to be set up
	// before assembly: the database driver, the bus and the cache each take
	// the global tracer provider as they are built, so one installed after
	// them would trace nothing. With no TRACER_URI the provider stays the
	// no-op one and every span below costs nothing.
	if os.Getenv("TRACER_URI") != "" {
		stopTracing, err := startTracing()
		if err != nil {
			log.Fatalf("auth: tracing: %v", err)
		}
		defer stopTracing()
	}

	app, err := di.New()
	if err != nil {
		log.Fatalf("auth: %v", err)
	}
	defer app.Close()

	srv := &http.Server{
		Addr:              addr,
		Handler:           app.Handler,
		ReadHeaderTimeout: 5 * time.Second,
	}

	// Signals are handled before Serve starts, so a Ctrl-C during startup is not
	// lost.
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	go func() {
		log.Printf("auth: listening on %s", addr)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Printf("auth: serve: %v", err)
			stop()
		}
	}()

	// The second process: reading the outbox and handing what is in it to the
	// policies. It runs for as long as the service does, and its failure is as
	// fatal as the listener's - a service that serves but never delivers what
	// it recorded is worse than one that is plainly down.
	go func() {
		if err := app.Run(ctx); err != nil {
			log.Printf("auth: outbox: %v", err)
			stop()
		}
	}()

	<-ctx.Done()

	// A fresh context: the one above is already cancelled, and shutting down
	// with a cancelled context closes connections instead of draining them.
	shutdownCtx, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
	defer cancel()

	if err := srv.Shutdown(shutdownCtx); err != nil {
		log.Printf("auth: shutdown: %v", err)
	}
	log.Print("auth: stopped")
}

// startTracing installs an OTLP tracer provider as the global one, sending to
// the collector TRACER_URI names over plain gRPC, and names this service in
// every span's resource. Everything is sampled: this switch is for recording
// what the service does, not for watching it in production.
func startTracing() (func(), error) {
	ctx := context.Background()

	exporter, err := otlptracegrpc.New(ctx,
		otlptracegrpc.WithEndpoint(os.Getenv("TRACER_URI")),
		otlptracegrpc.WithInsecure(),
	)
	if err != nil {
		return nil, err
	}

	name := os.Getenv("SERVICE_NAME")
	if name == "" {
		name = "auth"
	}
	// Schemaless on purpose: merging two resources that name different schema
	// versions is refused, and the default resource names whichever version
	// the SDK was built against.
	res, err := resource.Merge(resource.Default(), resource.NewSchemaless(
		attribute.String("service.name", name),
	))
	if err != nil {
		return nil, err
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
		shutdownCtx, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
		defer cancel()
		_ = provider.Shutdown(shutdownCtx)
	}, nil
}
