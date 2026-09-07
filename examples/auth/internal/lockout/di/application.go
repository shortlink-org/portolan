package di

import (
	"github.com/google/wire"

	"github.com/shortlink-org/portolan/examples/auth/internal/lockout/application/check"
	"github.com/shortlink-org/portolan/examples/auth/internal/lockout/application/record_failure"
	"github.com/shortlink-org/portolan/examples/auth/internal/lockout/application/record_success"
)

// ApplicationSet contains the lockout module's scenarios.
var ApplicationSet = wire.NewSet(
	check.New,
	record_failure.New,
	record_success.New,
)
