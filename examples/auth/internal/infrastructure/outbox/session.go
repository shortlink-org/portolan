package outbox

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/ThreeDotsLabs/watermill"
	"github.com/ThreeDotsLabs/watermill/message"

	"github.com/shortlink-org/portolan/examples/auth/internal/domain/session"
	"github.com/shortlink-org/portolan/examples/auth/internal/domain/session/event"
	"github.com/shortlink-org/portolan/examples/auth/internal/infrastructure/outbox/dto"
)

// TopicSession is where the session domain's events go.
const TopicSession = "auth_session"

// SessionPublisher writes the session domain's events into the transaction in
// flight.
type SessionPublisher struct {
	messages *Messages
}

var _ session.Publisher = (*SessionPublisher)(nil)

func NewSessionPublisher(messages *Messages) *SessionPublisher {
	return &SessionPublisher{messages: messages}
}

func (p *SessionPublisher) Publish(ctx context.Context, events []event.Event) error {
	messages := make([]*message.Message, 0, len(events))

	for _, e := range events {
		payload, err := marshalSession(e)
		if err != nil {
			return err
		}

		msg := message.NewMessage(watermill.NewUUID(), payload)
		msg.Metadata.Set(metadataEventName, e.Name())
		messages = append(messages, msg)
	}

	return p.messages.Publish(ctx, TopicSession, messages...)
}

func marshalSession(e event.Event) ([]byte, error) {
	switch typed := e.(type) {
	case event.SessionStarted:
		return json.Marshal(dto.SessionStarted{
			SessionID:  typed.SessionID(),
			UserID:     typed.UserID(),
			ExpiresAt:  typed.ExpiresAt(),
			OccurredAt: typed.OccurredAt(),
		})

	case event.SessionEnded:
		return json.Marshal(dto.SessionEnded{
			SessionID:  typed.SessionID(),
			UserID:     typed.UserID(),
			Reason:     string(typed.Reason()),
			OccurredAt: typed.OccurredAt(),
		})

	default:
		return nil, fmt.Errorf("outbox: %s has no wire shape", e.Name())
	}
}

// unmarshalSession rebuilds a domain event through the same constructors the
// domain uses. See the note on the user side about unknown names.
func unmarshalSession(msg *message.Message) (event.Event, error) {
	name := msg.Metadata.Get(metadataEventName)

	switch name {
	case event.TopicSessionStarted:
		var wire dto.SessionStarted
		if err := json.Unmarshal(msg.Payload, &wire); err != nil {
			return nil, fmt.Errorf("outbox: reading %s: %w", name, err)
		}
		return event.NewSessionStarted(wire.SessionID, wire.UserID, wire.ExpiresAt, wire.OccurredAt), nil

	case event.TopicSessionEnded:
		var wire dto.SessionEnded
		if err := json.Unmarshal(msg.Payload, &wire); err != nil {
			return nil, fmt.Errorf("outbox: reading %s: %w", name, err)
		}
		return event.NewSessionEnded(wire.SessionID, wire.UserID, event.Reason(wire.Reason), wire.OccurredAt), nil

	default:
		return nil, nil
	}
}
