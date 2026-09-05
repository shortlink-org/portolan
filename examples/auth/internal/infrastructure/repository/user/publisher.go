package user

import (
	"context"
	"fmt"

	"github.com/ThreeDotsLabs/watermill/message"
	sdkoutbox "github.com/shortlink-org/go-sdk/outbox"

	"github.com/shortlink-org/portolan/examples/auth/internal/domain/user"
	"github.com/shortlink-org/portolan/examples/auth/internal/domain/user/event"
	"github.com/shortlink-org/portolan/examples/auth/internal/infrastructure/repository/user/dto"
	"github.com/shortlink-org/portolan/examples/auth/internal/pkg/messaging"
)

// Publisher writes the user domain's events into the transaction in flight.
//
// It sits next to the aggregate's repository because both are adapters for the
// same domain's ports: one puts a User into rows, the other puts what happened
// to it into a message. Neither knows about the other, and both write through
// the same transaction.
type Publisher struct {
	outbox *sdkoutbox.Publisher
}

var _ user.Publisher = (*Publisher)(nil)

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

// Bus is what the relay hands an event to once it is back out of the outbox:
// the domain's own Publisher port, plus a name for the trace.
//
// It takes domain events, not messages. Whatever reacts to a fact should not
// have to know it spent time in a table - and the in-process bus assembly
// wires here is the same type the tests bind straight to the port.
type Bus interface {
	user.Publisher

	// System names the bus on a span, as messaging.system.
	System() string
}

// Handle registers this domain's topic with the relay and hands every event
// on it to the bus.
//
// One registration per topic, because the relay allows one: a topic has one
// cursor, and a second reader would take messages the first never saw. So
// nothing is dispatched by name here - who listens to what is the bus's
// business, and is decided where the bus is built (docs/adr/0011). Every
// event that was written comes through, including the ones nothing in this
// service reacts to: handed over and acknowledged, rather than left pending
// forever for a reader that does not exist.
func Handle(relay *sdkoutbox.Relay, bus Bus) error {
	return relay.Handle(dto.Topic, func(ctx context.Context, msg *message.Message) (err error) {
		name := msg.Metadata.Get(messaging.MetadataEventName)

		ctx, span := messaging.StartRelay(ctx, bus.System(), dto.Topic, name)
		defer func() { messaging.EndWith(span, err) }()

		e, err := dto.Unmarshal(msg)
		if err != nil {
			return fmt.Errorf("user: %s: %w", name, err)
		}
		if e == nil {
			// A name this build does not know - almost always one a newer
			// version wrote. Acknowledged rather than failed: leaving it would
			// block every message behind it, and it is not broken, just
			// unreadable here.
			return nil
		}

		return bus.Publish(ctx, []event.Event{e})
	})
}
