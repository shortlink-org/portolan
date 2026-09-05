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

	"github.com/shortlink-org/portolan/examples/auth/internal/di"
	"github.com/shortlink-org/portolan/examples/auth/internal/pkg/tracing"
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

	// Tracing goes first: the parts assembled below take the global tracer
	// provider as they are built. Why is in internal/pkg/tracing.
	stopTracing, err := tracing.Start(context.Background(), tracing.FromEnv())
	if err != nil {
		log.Fatalf("auth: %v", err)
	}
	defer stopTracing()

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
