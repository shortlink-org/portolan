package provider

import (
	"github.com/google/wire"

	"github.com/shortlink-org/portolan/examples/auth/internal/domain/session"
	"github.com/shortlink-org/portolan/examples/auth/internal/domain/user"
	sessionrepo "github.com/shortlink-org/portolan/examples/auth/internal/infrastructure/repository/session"
	userrepo "github.com/shortlink-org/portolan/examples/auth/internal/infrastructure/repository/user"
)

// Repository binds the Postgres adapters to the storage ports.
//
// The wire.Bind lines are the seam. They are the only place in the tree that
// names a database at all: everything above them speaks to an interface, and
// swapping what is behind it is these two lines and nothing else.
//
// Both adapters take the router and the unit of work rather than a connection.
// Neither of them opens a transaction of its own choosing, and neither can be
// told which one it is in - that is the point.
var Repository = wire.NewSet(
	userrepo.NewPostgres,
	wire.Bind(new(user.Repository), new(*userrepo.Postgres)),

	sessionrepo.NewPostgres,
	wire.Bind(new(session.Repository), new(*sessionrepo.Postgres)),
)
