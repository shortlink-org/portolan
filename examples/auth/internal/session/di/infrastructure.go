package di

import (
	"time"

	"github.com/google/wire"

	sdkcache "github.com/shortlink-org/go-sdk/cache"

	sessiondomain "github.com/shortlink-org/portolan/examples/auth/internal/session/domain"
	"github.com/shortlink-org/portolan/examples/auth/internal/session/infrastructure/identity"
	sessionrepo "github.com/shortlink-org/portolan/examples/auth/internal/session/infrastructure/repository"
)

// InfrastructureSet binds storage, cache and cross-module adapters to the
// contracts declared by the session module.
var InfrastructureSet = wire.NewSet(
	sessionrepo.NewPublisher,
	wire.Bind(new(sessiondomain.Publisher), new(*sessionrepo.Publisher)),
	sessionrepo.NewPostgres,
	ProvideRepository,
	identity.NewAuthenticator,
	RiskSet,
)

func ProvideRepository(
	store *sessionrepo.Postgres,
	cache sdkcache.Cache,
	ttl time.Duration,
	now func() time.Time,
) sessiondomain.Repository {
	return sessionrepo.NewCached(store, cache, ttl, now)
}
