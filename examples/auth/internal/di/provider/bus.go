package provider

import (
	"github.com/google/wire"

	lockoutbus "github.com/shortlink-org/portolan/examples/auth/internal/lockout/infrastructure/bus"
	lockoutevent "github.com/shortlink-org/portolan/examples/auth/internal/lockout/integration/event"
	sessionbus "github.com/shortlink-org/portolan/examples/auth/internal/session/infrastructure/bus"
	"github.com/shortlink-org/portolan/examples/auth/internal/session/infrastructure/messaging/policy"
	sessionevent "github.com/shortlink-org/portolan/examples/auth/internal/session/integration/event"
	userbus "github.com/shortlink-org/portolan/examples/auth/internal/user/infrastructure/bus"
	userevent "github.com/shortlink-org/portolan/examples/auth/internal/user/integration/event"
)

// Bus builds the buses the relay hands events to, and says who listens.
//
// The Publisher ports are NOT bound here - the outbox has them, so that an
// event reaches durable storage inside the transaction that produced it. The
// buses sit on the far side of the relay: everything the outbox was given comes
// through them, and a policy subscribes to a bus, not to the table
// (docs/adr/0011).
var Bus = wire.NewSet(ProvideBuses)

// Buses is one bus per domain, each named for the topic its events come off.
//
// One per domain rather than one for everything because the events are typed
// per domain, and so is what subscribes to them: a bus that carried all three
// would have to erase the type and every subscriber would put it back.
type Buses struct {
	Users    *userbus.InProc
	Sessions *sessionbus.InProc
	Lockouts *lockoutbus.InProc
}

// ProvideBuses builds the buses and subscribes the policies to them.
//
// Subscription is assembly, not behaviour: a policy says what to do, this says
// that it is listening. Putting the subscribe call inside the policy would mean
// a rule that switches itself on, and no one place to look to find out what
// this service reacts to. This is that place - the whole answer to "what does
// this service react to" - and a domain with no subscriber below is a domain
// whose events leave the outbox and reach nobody, on purpose, until something
// here or beyond this service wants them.
func ProvideBuses(revokeSessions *policy.RevokeSessionsOnPasswordChange) *Buses {
	users := userbus.NewInProc(userevent.Topic)
	users.Subscribe(userevent.NamePasswordChanged, revokeSessions.Handle)

	return &Buses{
		Users:    users,
		Sessions: sessionbus.NewInProc(sessionevent.Topic),
		Lockouts: lockoutbus.NewInProc(lockoutevent.Topic),
	}
}
