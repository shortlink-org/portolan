package di

import (
	"net/http"

	"github.com/shortlink-org/portolan/examples/auth/internal/di/provider"
)

// App is the assembled service.
//
// Handler is the only field anyone uses. Subscriptions is here because the
// policies have to be wired before the service serves anything, and a graph
// only builds what something depends on: without a field asking for them, wire
// would leave the policies out entirely and the rules would compile, never be
// subscribed, and never fire.
type App struct {
	Handler       http.Handler
	Subscriptions provider.Subscriptions
}
