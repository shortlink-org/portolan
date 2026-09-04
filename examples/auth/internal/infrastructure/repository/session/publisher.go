package session

import (
	"context"
	"fmt"

	"github.com/ThreeDotsLabs/watermill/message"
	sdkoutbox "github.com/shortlink-org/go-sdk/outbox"

	"github.com/shortlink-org/portolan/examples/auth/internal/domain/session"
	"github.com/shortlink-org/portolan/examples/auth/internal/domain/session/event"
	"github.com/shortlink-org/portolan/examples/auth/internal/infrastructure/repository/session/dto"
	"github.com/shortlink-org/portolan/examples/auth/internal/pkg/messaging"
)

// Publisher writes the session domain's events into the transaction in flight.
//
// It sits next to the aggregate's repository because both are adapters for the
// same domain's ports: one puts a Session into rows, the other puts what happened
// to it into a message. Neither knows about the other, and both write through
// the same transaction.
type Publisher struct {
	outbox *sdkoutbox.Publisher
}

var _ session.Publisher = (*Publisher)(nil)

func NewPublisher(outbox *sdkoutbox.Publisher) *Publisher {
	return &Publisher{outbox: outbox}
}

// Publish turns each event into a message and appends it to the outbox.
//
// It must be called inside a unit of work. Outside one there is no transaction
// to join and the whole point would be lost, so the outbox refuses rather than
// quietly writing on its own connection.
func (p *Publisher) Publish(ctx context.Context, events []event.Event) error {
	messages := make([]*message.Message, 0, len(events))

	for _, e := range events {
		msg, err := dto.Marshal(e)
		if err != nil {
			return err
		}
		// One span per event, and its context on the message: that is what
		// lets the policy that reacts to it show up in the same trace as the
		// request that caused it.
		_, span := messaging.StartPublish(ctx, dto.Topic, msg, e.Name())
		span.End()
		messages = append(messages, msg)
	}

	return p.outbox.Publish(ctx, dto.Topic, messages...)
}

// Handler is what reacts to an event once it has come back out of the outbox.
//
// It takes a domain event, not a message: whatever reacts to a fact should not
// have to know it spent time in a table.
type Handler func(ctx context.Context, e event.Event) error

// Handle registers this domain's topic with the relay, dispatching by event
// name.
//
// One registration per topic, because the relay allows one - so the dispatch is
// here rather than in several handlers competing for the same messages. The map
// is the caller's: assembly is the only place that knows which rule listens to
// which fact.
func Handle(relay *sdkoutbox.Relay, byName map[string]Handler) error {
	return relay.Handle(dto.Topic, func(ctx context.Context, msg *message.Message) error {
		name := msg.Metadata.Get(messaging.MetadataEventName)

		handle, listening := byName[name]
		if !listening {
			// Nothing reacts to this one. Acknowledged rather than failed:
			// leaving it would block every message behind it, and it is not
			// broken, just uninteresting.
			return nil
		}

		ctx, span := messaging.StartConsume(ctx, dto.Topic, name)
		defer span.End()

		e, err := dto.Unmarshal(msg)
		if err != nil {
			return fmt.Errorf("session: %s: %w", name, err)
		}
		if e == nil {
			// A name this build does not know. Same treatment: let it pass.
			return nil
		}

		return handle(ctx, e)
	})
}
