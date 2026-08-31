package user

import (
	"context"

	"github.com/shortlink-org/portolan/examples/auth/internal/domain/user/event"
)

// Repository is the storage port of the aggregate. It is declared here, in the
// domain, because it states what the domain NEEDS - not what any particular
// database offers. The adapters live in internal/infrastructure.
//
// Save is the only place a User and its events reach durable storage, and it
// does both or neither.
type Repository interface {
	Save(ctx context.Context, u *User) error
	ByID(ctx context.Context, id string) (*User, error)
	ByEmail(ctx context.Context, email string) (*User, error)
}

// Publisher carries events that already happened. The domain does not
// care whether that is a bus, an outbox table or a log line.
type Publisher interface {
	Publish(ctx context.Context, events []event.Event) error
}
