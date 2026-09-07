package lockout_test

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

	platformuow "github.com/shortlink-org/portolan/examples/auth/internal/platform/uow"
)

type migrationSource struct {
	FS   fs.FS
	Name string
}

var (
	postgresOnce      sync.Once
	postgresAdminURL  string
	postgresStartErr  error
	terminatePostgres func()
)

func postgresContainer(ctx context.Context) (string, error) {
	postgresOnce.Do(func() {
		container, err := tcpostgres.Run(ctx, "postgres:18-alpine",
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
			postgresStartErr = err
			return
		}

		postgresAdminURL, postgresStartErr = container.ConnectionString(ctx, "sslmode=disable")
		terminatePostgres = func() { _ = container.Terminate(context.Background()) }
	})
	return postgresAdminURL, postgresStartErr
}

func stopPostgres() {
	if terminatePostgres != nil {
		terminatePostgres()
	}
}

func testStore(t *testing.T, sources ...migrationSource) (*replica.Router, *platformuow.UnitOfWork) {
	t.Helper()
	_, router, unit := testStoreWithDB(t, sources...)
	return router, unit
}

func testStoreWithDB(t *testing.T, sources ...migrationSource) (*db.Store, *replica.Router, *platformuow.UnitOfWork) {
	t.Helper()
	ctx := t.Context()

	admin, err := postgresContainer(ctx)
	if err != nil {
		t.Skipf("postgres: no database available (%v)", err)
	}

	name := testDatabaseName(t)
	if err := createTestDatabase(ctx, admin, name); err != nil {
		t.Skipf("postgres: cannot prepare a database (%v)", err)
	}
	t.Cleanup(func() { _ = dropTestDatabase(admin, name) })

	t.Setenv("STORE_TYPE", "postgres")
	t.Setenv("STORE_POSTGRES_URI", replaceTestDatabase(admin, name))

	cfg, err := sdkconfig.New()
	if err != nil {
		t.Fatalf("postgres config: %v", err)
	}
	log, err := logger.New(logger.Default())
	if err != nil {
		t.Fatalf("postgres logger: %v", err)
	}

	store, err := db.New(ctx, log, otel.GetTracerProvider(), &metric.MeterProvider{}, cfg,
		postgres.With(postgres.WithTxLookup(sdkuow.FromContext)),
	)
	if err != nil {
		t.Fatalf("postgres store: %v", err)
	}
	driver, ok := store.DB.(*postgres.Store)
	if !ok {
		t.Fatal("test store is not postgres")
	}
	t.Cleanup(driver.Close)

	for _, source := range sources {
		if err := migrate.Migration(ctx, store, source.FS, source.Name); err != nil {
			t.Fatalf("migrating %s: %v", source.Name, err)
		}
	}

	router := driver.Router()
	return store, router, platformuow.New(router)
}

func createTestDatabase(ctx context.Context, admin, name string) error {
	conn, err := pgx.Connect(ctx, admin)
	if err != nil {
		return err
	}
	defer func() { _ = conn.Close(ctx) }()

	_, err = conn.Exec(ctx, `CREATE DATABASE "`+name+`"`)
	return err
}

func dropTestDatabase(admin, name string) error {
	ctx := context.Background()
	conn, err := pgx.Connect(ctx, admin)
	if err != nil {
		return err
	}
	defer func() { _ = conn.Close(ctx) }()

	_, err = conn.Exec(ctx, `DROP DATABASE IF EXISTS "`+name+`" WITH (FORCE)`)
	return err
}

func replaceTestDatabase(uri, name string) string {
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

func testDatabaseName(t *testing.T) string {
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
