package lockout

import (
	"context"

	"github.com/shortlink-org/portolan/examples/auth/internal/domain/lockout/event"
)

// Repository is the storage port. Events a change produced are handed to Save;
// see the note on the user repository for why they are an argument rather
// than a second call.
type Repository interface {
	Save(ctx context.Context, l *Lockout, events ...event.Event) error

	// ByUserID returns the lockout of a user, or ErrNotFound for a user who
	// has never typed a wrong password. Not found is the ordinary answer for
	// almost everybody, and a caller treats it as "allowed".
	ByUserID(ctx context.Context, userID string) (*Lockout, error)
}

// Publisher carries events that already happened. The domain does not care
// whether that is a bus, an outbox table or a log line.
type Publisher interface {
	Publish(ctx context.Context, events []event.Event) error
}
