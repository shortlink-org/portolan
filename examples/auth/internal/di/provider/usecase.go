package provider

import (
	"github.com/google/wire"

	"github.com/shortlink-org/portolan/examples/auth/internal/application/session/usecases/login"
	"github.com/shortlink-org/portolan/examples/auth/internal/application/session/usecases/logout"
	"github.com/shortlink-org/portolan/examples/auth/internal/application/session/usecases/validate"
	"github.com/shortlink-org/portolan/examples/auth/internal/application/user/usecases/authenticate"
	"github.com/shortlink-org/portolan/examples/auth/internal/application/user/usecases/get"
	"github.com/shortlink-org/portolan/examples/auth/internal/application/user/usecases/register"
)

// UseCase provides all six scenarios.
//
// authenticate is in the set although no endpoint serves it: login needs it,
// through the adapter in authenticator.go.
var UseCase = wire.NewSet(
	register.New,
	authenticate.New,
	get.New,

	login.New,
	logout.New,
	validate.New,
)
