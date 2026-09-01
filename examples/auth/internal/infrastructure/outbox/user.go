// Package outbox writes domain events into the same transaction as the
// aggregate that produced them, and delivers them from there afterwards.
//
// This is what closes the gap the in-process bus leaves open. Publishing after
// a commit means a change can succeed while the fact of it is lost, and nothing
// downstream can tell. Here the row carrying the event and the row carrying the
// aggregate are written together or not at all; delivery is a separate, later
// concern, and may be retried as often as it likes.
//
// The cost is that delivery is no longer immediate. Whatever reacts to an event
// does so a poll interval later, which is why the moment a thing happened
// travels on the event rather than being read off the clock at the far end.
package outbox

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/ThreeDotsLabs/watermill"
	"github.com/ThreeDotsLabs/watermill/message"
	sdkoutbox "github.com/shortlink-org/go-sdk/outbox"

	"github.com/shortlink-org/portolan/examples/auth/internal/domain/user"
	"github.com/shortlink-org/portolan/examples/auth/internal/domain/user/event"
	"github.com/shortlink-org/portolan/examples/auth/internal/infrastructure/outbox/dto"
)

// TopicUser is where the user domain's events go. One topic per domain rather
// than per event: the name of the event is on the message, subscribers already
// dispatch on it, and four tables would buy nothing over two.
//
// Underscored, not dotted. The topic name becomes the table name, and a dot
// there forces a quoted identifier that reads like a schema qualification and
// is not one.
const TopicUser = "auth_user"

// metadataEventName is how a subscriber knows what it is holding without
// unmarshalling it first.
const metadataEventName = "event_name"

// UserPublisher writes the user domain's events into the transaction in flight.
type UserPublisher struct {
	messages *sdkoutbox.Publisher
}

var _ user.Publisher = (*UserPublisher)(nil)

func NewUserPublisher(messages *sdkoutbox.Publisher) *UserPublisher {
	return &UserPublisher{messages: messages}
}

// Publish turns each event into a message and writes it.
//
// It must be called inside a unit of work. Outside one there is no transaction
// to join and the whole point would be lost, so the outbox refuses rather than
// quietly writing on its own connection.
func (p *UserPublisher) Publish(ctx context.Context, events []event.Event) error {
	messages := make([]*message.Message, 0, len(events))

	for _, e := range events {
		payload, err := marshalUser(e)
		if err != nil {
			return err
		}

		msg := message.NewMessage(watermill.NewUUID(), payload)
		msg.Metadata.Set(metadataEventName, e.Name())
		messages = append(messages, msg)
	}

	return p.messages.Publish(ctx, TopicUser, messages...)
}

// marshalUser maps a domain event onto its wire shape. A new event type that
// nobody added here is a compile-time nothing and a runtime error, which is why
// the default case says so loudly.
func marshalUser(e event.Event) ([]byte, error) {
	switch typed := e.(type) {
	case event.UserRegistered:
		return json.Marshal(dto.UserRegistered{
			UserID:     typed.UserID(),
			Email:      typed.Email(),
			OccurredAt: typed.OccurredAt(),
		})

	case event.PasswordChanged:
		return json.Marshal(dto.PasswordChanged{
			UserID:     typed.UserID(),
			By:         typed.By(),
			OccurredAt: typed.OccurredAt(),
		})

	default:
		return nil, fmt.Errorf("outbox: %s has no wire shape", e.Name())
	}
}

// unmarshalUser rebuilds a domain event from a message.
//
// Every event is built through its constructor, the same one the domain uses.
// Nothing here writes into an event's fields, so a fact that came back from the
// store is exactly as immutable as the one that went in.
func unmarshalUser(msg *message.Message) (event.Event, error) {
	name := msg.Metadata.Get(metadataEventName)

	switch name {
	case event.TopicUserRegistered:
		var wire dto.UserRegistered
		if err := json.Unmarshal(msg.Payload, &wire); err != nil {
			return nil, fmt.Errorf("outbox: reading %s: %w", name, err)
		}
		return event.NewUserRegistered(wire.UserID, wire.Email, wire.OccurredAt), nil

	case event.TopicPasswordChanged:
		var wire dto.PasswordChanged
		if err := json.Unmarshal(msg.Payload, &wire); err != nil {
			return nil, fmt.Errorf("outbox: reading %s: %w", name, err)
		}
		return event.NewPasswordChanged(wire.UserID, wire.By, wire.OccurredAt), nil

	default:
		// Not an error worth failing delivery over: an unknown name is almost
		// always an event added by a newer version of this service, and a
		// subscriber that cannot read it should let it pass rather than block
		// the topic behind it forever.
		return nil, nil
	}
}
