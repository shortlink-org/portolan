// Package di assembles the service.
package di

import (
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/shortlink-org/portolan/examples/shop/pricing/internal/application/policy"
	archiveuc "github.com/shortlink-org/portolan/examples/shop/pricing/internal/application/price_list/usecases/archive_price_list"
	importuc "github.com/shortlink-org/portolan/examples/shop/pricing/internal/application/price_list/usecases/import_price_list"
	listuc "github.com/shortlink-org/portolan/examples/shop/pricing/internal/application/price_list/usecases/list_price_lists"
	expireuc "github.com/shortlink-org/portolan/examples/shop/pricing/internal/application/quote/usecases/expire_quote"
	getuc "github.com/shortlink-org/portolan/examples/shop/pricing/internal/application/quote/usecases/get_quote"
	issueuc "github.com/shortlink-org/portolan/examples/shop/pricing/internal/application/quote/usecases/issue_quote"
	"github.com/shortlink-org/portolan/examples/shop/pricing/internal/di/provider"
	pricelisthandler "github.com/shortlink-org/portolan/examples/shop/pricing/internal/infrastructure/transport/grpc/price_list"
	quotehandler "github.com/shortlink-org/portolan/examples/shop/pricing/internal/infrastructure/transport/grpc/quote"
)

// App is everything the process runs.
type App struct {
	Quotes     *quotehandler.Handler
	PriceLists *pricelisthandler.Handler
	Expire     *expireuc.UseCase
	OnCheckout *policy.ExpireQuoteOnCheckout
}

// New builds the app out of a pool and a clock. Every port is filled here and
// nowhere else.
func New(pool *pgxpool.Pool, now func() time.Time) *App {
	quotes := provider.ProvideQuotes(pool)
	lists := provider.ProvidePriceLists(pool)
	newID := func() string { return uuid.NewString() }

	issue := issueuc.New(quotes, lists, now, newID)
	get := getuc.New(quotes)
	expire := expireuc.New(quotes, now)

	importList := importuc.New(lists, newID)
	archive := archiveuc.New(lists)
	list := listuc.New(lists)

	return &App{
		Quotes:     quotehandler.NewHandler(issue, get),
		PriceLists: pricelisthandler.NewHandler(importList, archive, list),
		Expire:     expire,
		OnCheckout: policy.NewExpireQuoteOnCheckout(quotes, now),
	}
}
