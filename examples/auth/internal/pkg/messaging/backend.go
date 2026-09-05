// Package messaging holds what this service needs to talk over a message
// router, and that no single domain owns.
//
// There is no broker here. An event is written to the outbox, read back by the
// relay and handed to an in-process bus, which is where the policies listen
// (docs/adr/0011). The only reason a router needs a publisher at all is the
// poison queue - so that is what this package supplies, and it writes dead
// letters back into the outbox rather than into a broker that does not exist.
package messaging

import (
	"context"
	"fmt"

	"github.com/ThreeDotsLabs/watermill/message"
	sdkoutbox "github.com/shortlink-org/go-sdk/outbox"

	"github.com/shortlink-org/portolan/examples/auth/internal/pkg/uow"
)

// MetadataEventName is where a message says which event it carries, so a
// subscriber can tell without unmarshalling it first.
//
// It lives here because every domain writes it and every relay handler reads
// it: a constant agreed on by that many packages belongs to none of them.
const MetadataEventName = "event_name"

// TopicDLQ is where a message that has exhausted its retries ends up.
//
// Nothing subscribes to it, and that is the point: an undelivered message waits
// in the outbox table to be looked at, rather than disappearing into a broker
// this service does not have. `SELECT ... WHERE topic = 'auth_dlq'` is the whole
// tooling.
const TopicDLQ = "auth_dlq"

// Backend is what watermill.New asks for so that it can build a router.
//
// It is not a message transport in any general sense - it is the two halves
// watermill.New insists on, one real and one deliberately inert.
type Backend struct {
	publisher *dlqPublisher
}

func NewBackend(publisher *sdkoutbox.Publisher, unit *uow.UnitOfWork) *Backend {
	return &Backend{publisher: &dlqPublisher{outbox: publisher, uow: unit}}
}

func (b *Backend) Publisher() message.Publisher { return b.publisher }

// Subscriber never delivers anything.
//
// Reading is the outbox relay's job, and it does not go through here. A backend
// that returned a working subscriber would offer a second way to consume, and
// the two would disagree about what had been read.
func (b *Backend) Subscriber() message.Subscriber { return inertSubscriber{} }

func (b *Backend) Close() error { return nil }

// dlqPublisher writes dead letters into the outbox, durably.
//
// It opens its own unit of work: a dead letter is produced while delivering
// somebody else's message, and there is no transaction of ours in flight at
// that point. Do is re-entrant, so if there ever is one this joins it instead.
type dlqPublisher struct {
	outbox *sdkoutbox.Publisher
	uow    *uow.UnitOfWork
}

func (p *dlqPublisher) Publish(topic string, messages ...*message.Message) error {
	if len(messages) == 0 {
		return nil
	}

	// Watermill's Publisher has no context in its signature. The messages carry
	// one each, and for a dead letter they all come from the same delivery, so
	// the first is the right one to write under.
	ctx := messages[0].Context()
	if ctx == nil {
		ctx = context.Background()
	}

	return p.uow.Do(ctx, func(ctx context.Context) error {
		if err := p.outbox.Publish(ctx, topic, messages...); err != nil {
			return fmt.Errorf("messaging: dead letter to %s: %w", topic, err)
		}
		return nil
	})
}

func (p *dlqPublisher) Close() error { return nil }

type inertSubscriber struct{}

func (inertSubscriber) Subscribe(ctx context.Context, _ string) (<-chan *message.Message, error) {
	out := make(chan *message.Message)
	go func() {
		<-ctx.Done()
		close(out)
	}()
	return out, nil
}

func (inertSubscriber) Close() error { return nil }
