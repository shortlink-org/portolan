package session

import (
	"context"

	"github.com/shortlink-org/portolan/examples/auth/internal/domain/session/event"
	"github.com/shortlink-org/portolan/examples/auth/internal/domain/session/vo/token"
)

// Repository is the storage port. ByToken is the hot path: every authenticated
// request in the estate ends up there.
type Repository interface {
	Save(ctx context.Context, s *Session) error
	ByID(ctx context.Context, id string) (*Session, error)
	ByToken(ctx context.Context, presented token.Token) (*Session, error)
}

// Publisher carries events that already happened. The domain does not care
// whether that is a bus, an outbox table or a log line.
type Publisher interface {
	Publish(ctx context.Context, events []event.Event) error
}
