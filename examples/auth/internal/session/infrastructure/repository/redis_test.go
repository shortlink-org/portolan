package session_test

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
	redisOnce      sync.Once
	redisEndpoint  string
	redisStartErr  error
	terminateRedis func()
)

func redisContainer(ctx context.Context) (string, error) {
	redisOnce.Do(func() {
		container, err := tcredis.Run(ctx, "redis:8-alpine",
			testcontainers.WithWaitStrategy(
				wait.ForLog("Ready to accept connections").WithStartupTimeout(60*time.Second),
			),
		)
		if err != nil {
			redisStartErr = err
			return
		}

		redisEndpoint, redisStartErr = container.Endpoint(ctx, "")
		terminateRedis = func() { _ = container.Terminate(context.Background()) }
	})
	return redisEndpoint, redisStartErr
}

func stopRedis() {
	if terminateRedis != nil {
		terminateRedis()
	}
}

func testRedis(t *testing.T) *sdkcache.Redis {
	t.Helper()
	ctx := t.Context()

	address, err := redisContainer(ctx)
	if err != nil {
		t.Skipf("redis: no cache available (%v)", err)
	}
	t.Setenv("STORE_REDIS_URI", address)

	cfg, err := sdkconfig.New()
	if err != nil {
		t.Fatalf("redis config: %v", err)
	}
	store, err := sdkcache.NewRedis(context.Background(), cfg)
	if err != nil {
		t.Fatalf("redis cache: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })
	return store
}
