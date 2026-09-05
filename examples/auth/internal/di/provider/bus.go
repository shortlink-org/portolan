package provider

import (
	"github.com/google/wire"

	"github.com/shortlink-org/portolan/examples/auth/internal/application/policy"
	userevent "github.com/shortlink-org/portolan/examples/auth/internal/domain/user/event"
	lockoutbus "github.com/shortlink-org/portolan/examples/auth/internal/infrastructure/bus/lockout"
	sessionbus "github.com/shortlink-org/portolan/examples/auth/internal/infrastructure/bus/session"
	userbus "github.com/shortlink-org/portolan/examples/auth/internal/infrastructure/bus/user"
	lockoutdto "github.com/shortlink-org/portolan/examples/auth/internal/infrastructure/repository/lockout/dto"
	sessiondto "github.com/shortlink-org/portolan/examples/auth/internal/infrastructure/repository/session/dto"
	userdto "github.com/shortlink-org/portolan/examples/auth/internal/infrastructure/repository/user/dto"
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
	users := userbus.NewInProc(userdto.Topic)
	users.Subscribe(userevent.TopicPasswordChanged, revokeSessions.Handle)

	return &Buses{
		Users:    users,
		Sessions: sessionbus.NewInProc(sessiondto.Topic),
		Lockouts: lockoutbus.NewInProc(lockoutdto.Topic),
	}
}
