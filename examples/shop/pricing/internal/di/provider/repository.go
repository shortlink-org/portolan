// Package provider is the assembly: the one place that knows every package
// exists, and the only one allowed to.
package provider

import (
	"github.com/jackc/pgx/v5/pgxpool"

	pricelist "github.com/shortlink-org/portolan/examples/shop/pricing/internal/domain/price_list"
	"github.com/shortlink-org/portolan/examples/shop/pricing/internal/domain/quote"
	pricelistrepo "github.com/shortlink-org/portolan/examples/shop/pricing/internal/infrastructure/repository/price_list"
	quoterepo "github.com/shortlink-org/portolan/examples/shop/pricing/internal/infrastructure/repository/quote"
)

// ProvideQuotes fills the quote domain's storage port with the postgres one.
func ProvideQuotes(pool *pgxpool.Pool) quote.Repository {
	return quoterepo.New(pool)
}

// ProvidePriceLists does the same for lists.
func ProvidePriceLists(pool *pgxpool.Pool) pricelist.Repository {
	return pricelistrepo.New(pool)
}
