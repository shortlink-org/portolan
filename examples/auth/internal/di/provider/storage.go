package provider

import (
	"context"
	"fmt"

	"github.com/google/wire"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/sdk/metric"

	sdkconfig "github.com/shortlink-org/go-sdk/config"
	"github.com/shortlink-org/go-sdk/db"
	"github.com/shortlink-org/go-sdk/db/drivers/postgres"
	"github.com/shortlink-org/go-sdk/db/drivers/postgres/migrate"
	"github.com/shortlink-org/go-sdk/db/drivers/postgres/replica"
	"github.com/shortlink-org/go-sdk/logger"
	sdkoutbox "github.com/shortlink-org/go-sdk/outbox"
	sdkuow "github.com/shortlink-org/go-sdk/uow"

	sessionrepo "github.com/shortlink-org/portolan/examples/auth/internal/infrastructure/repository/session"
	userrepo "github.com/shortlink-org/portolan/examples/auth/internal/infrastructure/repository/user"
	"github.com/shortlink-org/portolan/examples/auth/internal/pkg/uow"
)

// Storage opens the database, brings its schema up to date, and produces the
// router and unit of work everything else writes through.
//
// Migrating at startup is a decision, not an oversight: the alternative is a
// separate step somebody has to remember, and a service running against a
// schema older than itself fails in ways far harder to read than a migration
// error on boot.
var Storage = wire.NewSet(
	ProvideLogger,
	ProvideStore,
	ProvideDriver,
	ProvideRouter,
	uow.New,
)

func ProvideLogger(cfg *sdkconfig.Config) (logger.Logger, error) {
	log, _, err := logger.NewDefault(context.Background(), cfg)
	if err != nil {
		return nil, fmt.Errorf("provider: logger: %w", err)
	}
	return log, nil
}

// ProvideStore is where the unit of work is wired into the driver.
//
// WithTxLookup is what lets the router see a transaction this service opened
// itself. Without it the router cannot tell one is in flight and will take a
// different connection: the statement then runs outside the transaction,
// without its locks, and can deadlock against it. Every repository in this
// service depends on that one line being here.
func ProvideStore(cfg *sdkconfig.Config, log logger.Logger) (*db.Store, error) {
	ctx := context.Background()

	store, err := db.New(ctx, log, otel.GetTracerProvider(), &metric.MeterProvider{}, cfg,
		postgres.With(postgres.WithTxLookup(sdkuow.FromContext)),
	)
	if err != nil {
		return nil, fmt.Errorf("provider: store: %w", err)
	}

	// Each aggregate hands over its own schema and its own migrations table.
	// Nothing central holds the list; this is the list, and it grows where the
	// aggregates do.
	if err := migrate.Migration(ctx, store, userrepo.Migrations, userrepo.Name); err != nil {
		return nil, fmt.Errorf("provider: migrating %s: %w", userrepo.Name, err)
	}
	if err := migrate.Migration(ctx, store, sessionrepo.Migrations, sessionrepo.Name); err != nil {
		return nil, fmt.Errorf("provider: migrating %s: %w", sessionrepo.Name, err)
	}
	// The outbox table is migrated like any other. Nothing creates it at
	// start-up behind the migration's back, which is what every other table in
	// this service can also say.
	if err := migrate.Migration(ctx, store, sdkoutbox.Migrations, "outbox"); err != nil {
		return nil, fmt.Errorf("provider: migrating outbox: %w", err)
	}

	return store, nil
}

// ProvideDriver unwraps the driver. db.Store embeds the DB interface, and
// closing - along with the router - lives on the concrete driver.
func ProvideDriver(store *db.Store) (*postgres.Store, error) {
	driver, ok := store.DB.(*postgres.Store)
	if !ok {
		return nil, fmt.Errorf("provider: the store is not postgres (STORE_TYPE)")
	}
	return driver, nil
}

// ProvideRouter reaches past RouterFrom on purpose.
//
// RouterFrom refuses a router with no replicas configured, which is the normal
// case here: one database, every statement to the primary. The router is still
// the thing that honours the transaction lookup, so it is what repositories
// must go through either way.
func ProvideRouter(driver *postgres.Store) (*replica.Router, error) {
	router := driver.Router()
	if router == nil {
		return nil, fmt.Errorf("provider: the postgres store has no router")
	}
	return router, nil
}
