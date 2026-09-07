package di

import (
	"github.com/google/wire"

	lockoutdomain "github.com/shortlink-org/portolan/examples/auth/internal/lockout/domain"
	lockoutrepo "github.com/shortlink-org/portolan/examples/auth/internal/lockout/infrastructure/repository"
)

// InfrastructureSet binds the lockout module's persistence and outbox adapters.
var InfrastructureSet = wire.NewSet(
	lockoutrepo.NewPublisher,
	wire.Bind(new(lockoutdomain.Publisher), new(*lockoutrepo.Publisher)),
	lockoutrepo.NewPostgres,
	wire.Bind(new(lockoutdomain.Repository), new(*lockoutrepo.Postgres)),
)
