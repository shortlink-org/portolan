package user

import (
	"context"

	"github.com/shortlink-org/portolan/examples/auth/internal/domain/user/event"
)

// Repository is the storage port of the aggregate. It is declared here, in the
// domain, because it states what the domain NEEDS - not what any particular
// database offers. The adapters live in internal/infrastructure.
//
// The events a change produced are handed to Save rather than published
// separately, because a fact about a change that did not commit is worse than
// no fact at all. Making them an argument is what stops the two ever being done
// apart: there is no way to store the aggregate without offering its events,
// and no way to hand over events without storing.
type Repository interface {
	Save(ctx context.Context, u *User, events ...event.Event) error
	ByID(ctx context.Context, id string) (*User, error)
	ByEmail(ctx context.Context, email string) (*User, error)
}

// Publisher carries events that already happened. The domain does not
// care whether that is a bus, an outbox table or a log line.
type Publisher interface {
	Publish(ctx context.Context, events []event.Event) error
}
