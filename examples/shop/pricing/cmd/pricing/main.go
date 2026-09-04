// Command pricing answers what a basket costs.
package main

import (
	"context"
	"log"
	"net"
	"os"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"google.golang.org/grpc"

	"github.com/shortlink-org/portolan/examples/shop/pricing/internal/di"
	pricelistv1 "github.com/shortlink-org/portolan/examples/shop/pricing/internal/infrastructure/transport/grpc/price_list/gen/shop/v1"
	pricingv1 "github.com/shortlink-org/portolan/examples/shop/pricing/internal/infrastructure/transport/grpc/quote/gen/shop/v1"
)

func main() {
	ctx := context.Background()

	pool, err := pgxpool.New(ctx, env("DATABASE_URL", "postgres://pricing:pricing@localhost:5438/pricing"))
	if err != nil {
		log.Fatalf("pricing: no database: %v", err)
	}
	defer pool.Close()

	app := di.New(pool, time.Now)

	listener, err := net.Listen("tcp", env("GRPC_ADDR", ":9093"))
	if err != nil {
		log.Fatalf("pricing: cannot listen: %v", err)
	}

	server := grpc.NewServer()
	pricingv1.RegisterPricingServer(server, app.Quotes)
	pricelistv1.RegisterPriceListsServer(server, app.PriceLists)

	log.Printf("pricing: answering on %s", listener.Addr())
	if err := server.Serve(listener); err != nil {
		log.Fatalf("pricing: %v", err)
	}
}

func env(name, fallback string) string {
	if value := os.Getenv(name); value != "" {
		return value
	}

	return fallback
}
