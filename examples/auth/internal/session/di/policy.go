package di

import (
	"github.com/google/wire"

	"github.com/shortlink-org/portolan/examples/auth/internal/session/infrastructure/messaging/policy"
)

// PolicySet contains reactions owned by the session module to integration
// events emitted by other modules.
var PolicySet = wire.NewSet(policy.New)
