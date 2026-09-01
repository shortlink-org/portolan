package provider

import (
	"github.com/google/wire"

	"github.com/shortlink-org/portolan/examples/auth/internal/application/policy"
	userevent "github.com/shortlink-org/portolan/examples/auth/internal/domain/user/event"
	userbus "github.com/shortlink-org/portolan/examples/auth/internal/infrastructure/bus/user"
)

// Policy builds the domain policies and subscribes them.
//
// Subscription is assembly, not behaviour: the policy says what to do, this
// says that it is listening. Putting the Subscribe call inside the policy would
// mean a rule that switches itself on, and there would be no one place to look
// to find out what this service reacts to.
var Policy = wire.NewSet(
	policy.New,
	ProvideSubscriptions,
)

// Subscriptions is what a fully wired bus looks like: a value that exists only
// so that wire has something to build, and so that nothing downstream can be
// constructed before the subscriptions are in place.
type Subscriptions struct{}

func ProvideSubscriptions(
	bus *userbus.InProc,
	revokeSessions *policy.RevokeSessionsOnPasswordChange,
) Subscriptions {
	bus.Subscribe(userevent.TopicPasswordChanged, revokeSessions.Handle)

	return Subscriptions{}
}
