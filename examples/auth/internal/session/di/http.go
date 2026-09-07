package di

import (
	"github.com/google/wire"

	sessionhttp "github.com/shortlink-org/portolan/examples/auth/internal/session/infrastructure/http"
)

// HTTPSet exposes the session module through the generated HTTP API.
var HTTPSet = wire.NewSet(sessionhttp.NewSessions)
