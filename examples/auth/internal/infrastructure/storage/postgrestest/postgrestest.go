// Package postgrestest gives a test a real database, reached exactly the way
// the service reaches it.
//
// It builds the SDK store with the same WithTxLookup hook that assembly wires,
// because a test that reached the database any other way would be exercising a
// path the service does not have - and the transaction lookup is precisely the
// thing most worth not getting wrong.
//
// One container serves the whole run of a package; isolation is a database per
// test, which is cheap and total. Everything here skips rather than fails when
// Docker is not available, so a machine without it still runs the domain tests
// and `go test ./...` stays honest about what it did not run.
package postgrestest

import (
	"context"
	"fmt"
	"io/fs"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/testcontainers/testcontainers-go"
	tcpostgres "github.com/testcontainers/testcontainers-go/modules/postgres"
	"github.com/testcontainers/testcontainers-go/wait"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/sdk/metric"

	sdkconfig "github.com/shortlink-org/go-sdk/config"
	"github.com/shortlink-org/go-sdk/db"
	"github.com/shortlink-org/go-sdk/db/drivers/postgres"
	"github.com/shortlink-org/go-sdk/db/drivers/postgres/migrate"
	"github.com/shortlink-org/go-sdk/db/drivers/postgres/replica"
	"github.com/shortlink-org/go-sdk/logger"
	sdkuow "github.com/shortlink-org/go-sdk/uow"

	"github.com/shortlink-org/portolan/examples/auth/internal/infrastructure/storage/uow"
)

// Source is one aggregate's migrations, as its repository package exports them.
type Source struct {
	FS   fs.FS
	Name string
}

var (
	once      sync.Once
	adminURL  string
	startErr  error
	terminate func()
)

func container(ctx context.Context) (string, error) {
	once.Do(func() {
		c, err := tcpostgres.Run(ctx, "postgres:18-alpine",
			tcpostgres.WithDatabase("auth"),
			tcpostgres.WithUsername("auth"),
			tcpostgres.WithPassword("auth"),
			testcontainers.WithWaitStrategy(
				wait.ForLog("database system is ready to accept connections").
					WithOccurrence(2).
					WithStartupTimeout(60*time.Second),
			),
		)
		if err != nil {
			startErr = err
			return
		}

		adminURL, startErr = c.ConnectionString(ctx, "sslmode=disable")
		terminate = func() { _ = c.Terminate(context.Background()) }
	})
	return adminURL, startErr
}

// Stop releases the shared container. Call it from TestMain after m.Run.
func Stop() {
	if terminate != nil {
		terminate()
	}
}

// Store hands the test its own database, migrated with the sources it names,
// and the router and unit of work the repositories take.
//
// The sources are the caller's: a repository test migrates the aggregate it is
// about and nothing else, which is also a check that an aggregate's schema does
// not secretly need somebody else's.
func Store(t *testing.T, sources ...Source) (*replica.Router, *uow.UnitOfWork) {
	t.Helper()

	_, router, unit := StoreWithDB(t, sources...)

	return router, unit
}

// StoreWithDB is Store, and also hands back the SDK store itself - which the
// outbox relay wants, because it reads on its own rather than through the
// router.
func StoreWithDB(t *testing.T, sources ...Source) (*db.Store, *replica.Router, *uow.UnitOfWork) {
	t.Helper()
	ctx := t.Context()

	admin, err := container(ctx)
	if err != nil {
		t.Skipf("postgrestest: no database available (%v)", err)
	}

	name := databaseName(t)
	if err := createDatabase(ctx, admin, name); err != nil {
		t.Skipf("postgrestest: cannot prepare a database (%v)", err)
	}
	t.Cleanup(func() { _ = dropDatabase(admin, name) })

	// The SDK reads its connection out of the environment, so the test sets the
	// same variables a deployment would. t.Setenv also forbids t.Parallel here,
	// which is the honest constraint: these variables are process-wide.
	t.Setenv("STORE_TYPE", "postgres")
	t.Setenv("STORE_POSTGRES_URI", replaceDatabase(admin, name))

	cfg, err := sdkconfig.New()
	if err != nil {
		t.Fatalf("postgrestest: config: %v", err)
	}
	log, _, err := logger.NewDefault(ctx, cfg)
	if err != nil {
		t.Fatalf("postgrestest: logger: %v", err)
	}

	store, err := db.New(ctx, log, otel.GetTracerProvider(), &metric.MeterProvider{}, cfg,
		postgres.With(postgres.WithTxLookup(sdkuow.FromContext)),
	)
	if err != nil {
		t.Fatalf("postgrestest: store: %v", err)
	}
	driver, ok := store.DB.(*postgres.Store)
	if !ok {
		t.Fatal("postgrestest: the store is not postgres")
	}
	t.Cleanup(driver.Close)

	for _, source := range sources {
		if err := migrate.Migration(ctx, store, source.FS, source.Name); err != nil {
			t.Fatalf("postgrestest: migrating %s: %v", source.Name, err)
		}
	}

	router := driver.Router()

	return store, router, uow.New(router)
}

func createDatabase(ctx context.Context, admin, name string) error {
	conn, err := pgx.Connect(ctx, admin)
	if err != nil {
		return err
	}
	defer conn.Close(ctx)

	_, err = conn.Exec(ctx, `CREATE DATABASE "`+name+`"`)
	return err
}

func dropDatabase(admin, name string) error {
	ctx := context.Background()

	conn, err := pgx.Connect(ctx, admin)
	if err != nil {
		return err
	}
	defer conn.Close(ctx)

	_, err = conn.Exec(ctx, `DROP DATABASE IF EXISTS "`+name+`" WITH (FORCE)`)
	return err
}

// replaceDatabase swaps the database name in a connection URI, keeping
// everything else the container told us.
func replaceDatabase(uri, name string) string {
	base, query, hasQuery := strings.Cut(uri, "?")

	slash := strings.LastIndex(base, "/")
	if slash < 0 {
		return uri
	}
	out := base[:slash+1] + name

	if hasQuery {
		return out + "?" + query
	}
	return out
}

func databaseName(t *testing.T) string {
	safe := strings.Map(func(r rune) rune {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9', r == '_':
			return r
		case r >= 'A' && r <= 'Z':
			return r + ('a' - 'A')
		default:
			return '_'
		}
	}, t.Name())

	if len(safe) > 40 {
		safe = safe[:40]
	}
	return fmt.Sprintf("t_%s_%d", safe, time.Now().UnixNano()%1_000_000)
}
