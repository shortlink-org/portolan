package di

import (
	"github.com/google/wire"

	"github.com/shortlink-org/portolan/examples/auth/internal/session/application/end_after_credential_change"
	"github.com/shortlink-org/portolan/examples/auth/internal/session/application/login"
	"github.com/shortlink-org/portolan/examples/auth/internal/session/application/logout"
	"github.com/shortlink-org/portolan/examples/auth/internal/session/application/validate"
	"github.com/shortlink-org/portolan/examples/auth/internal/session/infrastructure/messaging/policy"
)

// ApplicationSet contains the session module's scenarios.
var ApplicationSet = wire.NewSet(
	login.New,
	logout.New,
	validate.New,
	end_after_credential_change.New,
	wire.Bind(new(policy.SessionEnder), new(*end_after_credential_change.UseCase)),
)
