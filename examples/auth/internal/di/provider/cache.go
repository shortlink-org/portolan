package provider

import (
	"context"
	"fmt"
	"time"

	"github.com/google/wire"
	"go.opentelemetry.io/otel"

	sdkcache "github.com/shortlink-org/go-sdk/cache"
	sdkconfig "github.com/shortlink-org/go-sdk/config"
)

// Cache decides whether this deployment has one, and how long it may keep
// anything.
//
// Both are configuration rather than code because they are properties of a
// deployment: the same build runs on a laptop with no redis and in an estate
// where the session lookup is the busiest query there is.
//
//	CACHE_TYPE=redis
//	STORE_REDIS_URI=localhost:6379
//	CACHE_SESSION_TTL=1m
//
// STORE_REDIS_CLIENT_CACHE_TTL, read by the SDK, additionally keeps a copy in
// each process for that long. It is off by default and it is safe to turn on
// here: the SDK's local layer is redis client-side caching, which the server
// invalidates on every replica when a key changes - unlike an in-process LRU,
// which nothing would tell about a logout.
var Cache = wire.NewSet(
	ProvideCache,
	ProvideCacheTTL,
)

// ProvideCache opens the cache, or hands back the one that keeps nothing.
//
// Not configuring a cache is a supported way to run this service, and it is the
// default: a service that refused to start without redis would have made a
// cache a dependency, which is the one thing a cache must never be.
//
// A CACHE_TYPE nobody recognises is a different matter. It is somebody asking
// for a cache and getting silence, and the deployment that most wants one is
// the one where the typo costs the most, so it fails at assembly.
func ProvideCache(cfg *sdkconfig.Config) (sdkcache.Cache, error) {
	cfg.SetDefault("CACHE_TYPE", "none")

	switch kind := cfg.GetString("CACHE_TYPE"); kind {
	case "none":
		return sdkcache.Noop{}, nil

	case "redis":
		// Background, not a start-up deadline: the driver treats this context
		// as the connection's lifetime. Closing is App.Close's job.
		//
		// The tracer is passed and no meter is: spans are what make a cache
		// that has quietly become slower visible at all, and this service
		// configures no meter provider to give.
		store, err := sdkcache.NewRedis(context.Background(), cfg,
			sdkcache.WithTracer(otel.GetTracerProvider()),
		)
		if err != nil {
			return nil, fmt.Errorf("provider: cache: %w", err)
		}

		return store, nil

	default:
		return nil, fmt.Errorf("provider: cache: CACHE_TYPE=%q is not one of none, redis", kind)
	}
}

// ProvideCacheTTL is the longest a cached session may survive its last check
// against the database.
//
// A minute, by default, and the reasoning is worth stating: revocation is
// invalidated explicitly, so this is not how long a logout takes to be seen -
// it is how long the estate stays wrong if that invalidation is the thing that
// failed. A day of caching would be free until the afternoon somebody could not
// log a stolen session out.
//
// It is a plain time.Duration for the reason the clock is a plain function: see
// the note on Ambient. Wire has one Duration in the graph, so there is nothing
// yet for a named type to keep apart.
func ProvideCacheTTL(cfg *sdkconfig.Config) time.Duration {
	cfg.SetDefault("CACHE_SESSION_TTL", "1m")

	return cfg.GetDuration("CACHE_SESSION_TTL")
}
