// Command pricing answers what a basket costs.
package main

import (
	"context"
	"log"
	"net"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"google.golang.org/grpc"

	"github.com/shortlink-org/portolan/examples/shop/pricing/internal/di"
	"github.com/shortlink-org/portolan/examples/shop/pricing/internal/di/provider"
	pricelistv1 "github.com/shortlink-org/portolan/examples/shop/pricing/internal/infrastructure/transport/grpc/price_list/gen/shop/v1"
	pricingv1 "github.com/shortlink-org/portolan/examples/shop/pricing/internal/infrastructure/transport/grpc/quote/gen/shop/v1"
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	pool, err := pgxpool.New(ctx, env("DATABASE_URL", "postgres://pricing:pricing@localhost:5438/pricing"))
	if err != nil {
		log.Fatalf("pricing: no database: %v", err)
	}
	defer pool.Close()

	// The bus. Over NATS when there is one to talk to; the log otherwise, so
	// the service runs on its own. A wrong NATS_URL is a service that never
	// came up rather than one that took the log by mistake.
	bus, err := provider.ProvideBus(os.Getenv("NATS_URL"), "pricing", log.Default())
	if err != nil {
		log.Fatalf("pricing: no bus: %v", err)
	}
	defer bus.Close()

	app := di.New(pool, bus, time.Now)

	listener, err := net.Listen("tcp", env("GRPC_ADDR", ":9093"))
	if err != nil {
		log.Fatalf("pricing: cannot listen: %v", err)
	}

	server := grpc.NewServer()
	pricingv1.RegisterPricingServer(server, app.Quotes)
	pricelistv1.RegisterPriceListsServer(server, app.PriceLists)

	// The listener, the relay and the subscriptions run beside each other, and
	// the first to fail takes the process with it.
	failed := make(chan error, 2)
	go func() { failed <- app.Start(ctx) }()
	go func() { failed <- server.Serve(listener) }()

	log.Printf("pricing: answering on %s", listener.Addr())

	select {
	case err := <-failed:
		if err != nil {
			log.Fatalf("pricing: %v", err)
		}
	case <-ctx.Done():
	}

	server.GracefulStop()
}

func env(name, fallback string) string {
	if value := os.Getenv(name); value != "" {
		return value
	}

	return fallback
}
