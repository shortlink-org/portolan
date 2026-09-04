package provider

import (
	"time"

	"github.com/google/wire"

	sdkcache "github.com/shortlink-org/go-sdk/cache"

	"github.com/shortlink-org/portolan/examples/auth/internal/domain/lockout"
	"github.com/shortlink-org/portolan/examples/auth/internal/domain/session"
	"github.com/shortlink-org/portolan/examples/auth/internal/domain/user"
	lockoutrepo "github.com/shortlink-org/portolan/examples/auth/internal/infrastructure/repository/lockout"
	sessionrepo "github.com/shortlink-org/portolan/examples/auth/internal/infrastructure/repository/session"
	userrepo "github.com/shortlink-org/portolan/examples/auth/internal/infrastructure/repository/user"
)

// Repository binds the storage adapters to the storage ports.
//
// These lines are the seam. They are the only place in the tree that names a
// database or a cache at all: everything above them speaks to an interface, and
// swapping what is behind it is here and nowhere else.
//
// The Postgres adapters take the router and the unit of work rather than a
// connection. Neither of them opens a transaction of its own choosing, and
// neither can be told which one it is in - that is the point.
var Repository = wire.NewSet(
	userrepo.NewPostgres,
	wire.Bind(new(user.Repository), new(*userrepo.Postgres)),

	sessionrepo.NewPostgres,
	ProvideSessionRepository,

	// No cache in front of lockouts. The read happens once per login, not
	// once per request, and it is immediately followed by a write on a wrong
	// password - the kind of read a cache would only make stale.
	lockoutrepo.NewPostgres,
	wire.Bind(new(lockout.Repository), new(*lockoutrepo.Postgres)),
)

// ProvideSessionRepository puts the cache in front of the session store.
//
// It is a function rather than a wire.Bind because the decorator takes the port
// it also provides, and wire would be asked to build a session.Repository out
// of a session.Repository. Naming the concrete store breaks that, and this is
// the only line that has to: the use cases still receive an interface and still
// cannot tell there is a cache under it.
//
// Removing the cache is removing this function's body, not editing anything
// that reads a session.
func ProvideSessionRepository(
	store *sessionrepo.Postgres,
	cached sdkcache.Cache,
	ttl time.Duration,
	now func() time.Time,
) session.Repository {
	return sessionrepo.NewCached(store, cached, ttl, now)
}
