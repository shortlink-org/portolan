package provider

import (
	"github.com/google/wire"

	"github.com/shortlink-org/portolan/examples/auth/internal/domain/session"
	"github.com/shortlink-org/portolan/examples/auth/internal/domain/user"
	sessionrepo "github.com/shortlink-org/portolan/examples/auth/internal/infrastructure/repository/session"
	userrepo "github.com/shortlink-org/portolan/examples/auth/internal/infrastructure/repository/user"
)

// Repository binds the in-memory adapters to the storage ports.
//
// The wire.Bind lines are the seam: swapping to postgres is two edits here and
// nothing anywhere else, which is the whole point of the ports being interfaces.
var Repository = wire.NewSet(
	userrepo.NewMemory,
	wire.Bind(new(user.Repository), new(*userrepo.Memory)),

	sessionrepo.NewMemory,
	wire.Bind(new(session.Repository), new(*sessionrepo.Memory)),
)
