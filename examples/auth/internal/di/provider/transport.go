package provider

import (
	"github.com/google/wire"

	transporthttp "github.com/shortlink-org/portolan/examples/auth/internal/infrastructure/transport/http"
	httpsession "github.com/shortlink-org/portolan/examples/auth/internal/infrastructure/transport/http/session"
	httpuser "github.com/shortlink-org/portolan/examples/auth/internal/infrastructure/transport/http/user"
)

// Transport builds the two handler halves, embeds them into the server that
// satisfies the generated interface, and mounts the routes from the spec.
var Transport = wire.NewSet(
	httpuser.NewUsers,
	httpsession.NewSessions,
	transporthttp.NewServer,
	transporthttp.Router,
)
