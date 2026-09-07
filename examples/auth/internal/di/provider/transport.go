package provider

import (
	"github.com/google/wire"

	transporthttp "github.com/shortlink-org/portolan/examples/auth/internal/transport/http"
)

// Transport builds the two handler halves, embeds them into the server that
// satisfies the generated interface, and mounts the routes from the spec.
var Transport = wire.NewSet(
	transporthttp.NewServer,
	transporthttp.Router,
)
