package di

import (
	"github.com/google/wire"

	"github.com/shortlink-org/portolan/examples/auth/internal/user/application/change_password"
	"github.com/shortlink-org/portolan/examples/auth/internal/user/application/check_credentials"
	"github.com/shortlink-org/portolan/examples/auth/internal/user/application/register"
	userdomain "github.com/shortlink-org/portolan/examples/auth/internal/user/domain"
	lockoutadapter "github.com/shortlink-org/portolan/examples/auth/internal/user/infrastructure/lockout"
	passwordadapter "github.com/shortlink-org/portolan/examples/auth/internal/user/infrastructure/password"
	userrepo "github.com/shortlink-org/portolan/examples/auth/internal/user/infrastructure/repository"
)

// InfrastructureSet binds the user module's driven adapters to its ports.
var InfrastructureSet = wire.NewSet(
	userrepo.NewPublisher,
	wire.Bind(new(userdomain.Publisher), new(*userrepo.Publisher)),
	userrepo.NewPostgres,
	wire.Bind(new(userdomain.Repository), new(*userrepo.Postgres)),
	lockoutadapter.New,
	passwordadapter.NewHasher,
	wire.Bind(new(register.PasswordHasher), new(*passwordadapter.Hasher)),
	wire.Bind(new(check_credentials.PasswordVerifier), new(*passwordadapter.Hasher)),
	wire.Bind(new(change_password.PasswordHasher), new(*passwordadapter.Hasher)),
)
