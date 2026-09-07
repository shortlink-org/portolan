package di

import (
	"github.com/google/wire"

	"github.com/shortlink-org/portolan/examples/auth/internal/user/application/change_password"
	"github.com/shortlink-org/portolan/examples/auth/internal/user/application/check_credentials"
	"github.com/shortlink-org/portolan/examples/auth/internal/user/application/get"
	"github.com/shortlink-org/portolan/examples/auth/internal/user/application/register"
)

// ApplicationSet contains the user module's business scenarios.
var ApplicationSet = wire.NewSet(
	register.New,
	check_credentials.New,
	change_password.New,
	get.New,
)
