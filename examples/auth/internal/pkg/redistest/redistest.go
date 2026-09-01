// Package redistest gives a test a real redis, reached exactly the way the
// service reaches one.
//
// It builds the cache through the same constructor assembly uses - go-sdk's,
// from the same environment variables - because a test that dialled redis
// itself would be exercising a path this service does not have.
//
// One container serves the whole run of a package. There is no per-test
// isolation and none is needed: every key is a hash of a token minted in the
// test that stores it, so two tests cannot name the same entry. Everything here
// skips rather than fails when Docker is not available, which is what keeps
// `go test ./...` honest about what it did not run.
package redistest

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/testcontainers/testcontainers-go"
	tcredis "github.com/testcontainers/testcontainers-go/modules/redis"
	"github.com/testcontainers/testcontainers-go/wait"

	sdkcache "github.com/shortlink-org/go-sdk/cache"
	sdkconfig "github.com/shortlink-org/go-sdk/config"
)

var (
	once      sync.Once
	endpoint  string
	startErr  error
	terminate func()
)

func container(ctx context.Context) (string, error) {
	once.Do(func() {
		c, err := tcredis.Run(ctx, "redis:8-alpine",
			testcontainers.WithWaitStrategy(
				wait.ForLog("Ready to accept connections").WithStartupTimeout(60*time.Second),
			),
		)
		if err != nil {
			startErr = err
			return
		}

		// The endpoint, not the connection string: the SDK's driver takes a
		// host:port list, the way rueidis does, not a redis:// URL.
		endpoint, startErr = c.Endpoint(ctx, "")
		terminate = func() { _ = c.Terminate(context.Background()) }
	})

	return endpoint, startErr
}

// Stop releases the shared container. Call it from TestMain after m.Run.
func Stop() {
	if terminate != nil {
		terminate()
	}
}

// Cache hands the test a cache backed by that container.
func Cache(t *testing.T) *sdkcache.Redis {
	t.Helper()
	ctx := t.Context()

	address, err := container(ctx)
	if err != nil {
		t.Skipf("redistest: no redis available (%v)", err)
	}

	// The SDK reads its connection out of the environment, so the test sets the
	// same variable a deployment would. t.Setenv also forbids t.Parallel here,
	// which is the honest constraint: these variables are process-wide.
	t.Setenv("STORE_REDIS_URI", address)

	cfg, err := sdkconfig.New()
	if err != nil {
		t.Fatalf("redistest: config: %v", err)
	}

	store, err := sdkcache.NewRedis(context.Background(), cfg)
	if err != nil {
		t.Fatalf("redistest: cache: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })

	return store
}
