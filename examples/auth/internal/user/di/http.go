package di

import (
	"github.com/google/wire"

	userhttp "github.com/shortlink-org/portolan/examples/auth/internal/user/infrastructure/http"
)

// HTTPSet exposes the user module through the service's generated HTTP API.
var HTTPSet = wire.NewSet(userhttp.NewUsers)
