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

	srv := &http.Server{
		Addr:              addr,
		Handler:           di.New().Handler,
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
