// Package di assembles the service.
package di

import (
	"context"
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
	"github.com/shortlink-org/portolan/examples/shop/pricing/internal/infrastructure/bus"
	"github.com/shortlink-org/portolan/examples/shop/pricing/internal/infrastructure/cart"
	"github.com/shortlink-org/portolan/examples/shop/pricing/internal/infrastructure/outbox"
	pricelisthandler "github.com/shortlink-org/portolan/examples/shop/pricing/internal/infrastructure/transport/grpc/price_list"
	quotehandler "github.com/shortlink-org/portolan/examples/shop/pricing/internal/infrastructure/transport/grpc/quote"
)

// App is everything the process runs.
type App struct {
	Quotes     *quotehandler.Handler
	PriceLists *pricelisthandler.Handler
	Expire     *expireuc.UseCase
	OnCheckout *policy.ExpireQuoteOnCheckout

	bus   bus.Bus
	relay *outbox.Relay
}

// New builds the app out of a pool, a bus and a clock. Every port is filled
// here and nowhere else.
func New(pool *pgxpool.Pool, b bus.Bus, now func() time.Time) *App {
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
		bus:        b,
		relay:      outbox.NewRelay(pool, b),
	}
}

// Start subscribes the policies on the bus, by the subject their event travels
// on, and runs the relay until ctx ends. The relay's error is the app's: a
// service that serves but never delivers what it recorded is worse than one
// that is plainly down.
func (a *App) Start(ctx context.Context) error {
	if err := a.bus.Subscribe(ctx, cart.Topic, cart.BasketCheckedOut{}.Name(), a.onCheckedOut); err != nil {
		return err
	}

	return a.relay.Run(ctx)
}

// onCheckedOut is the cart's message as the policy wants it: decoded, and
// passed over when it is not one this service reads.
func (a *App) onCheckedOut(ctx context.Context, m bus.Message) error {
	e, err := cart.Decode(m.Name(), m.Payload)
	if err != nil || e == nil {
		return err
	}

	return a.OnCheckout.Handle(ctx, e)
}
