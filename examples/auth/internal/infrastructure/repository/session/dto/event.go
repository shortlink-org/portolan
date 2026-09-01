// Package dto is the shape the session domain's events take on the wire, and
// the translation to and from it. See the user domain's dto for why these are
// separate types from the events themselves.
package dto

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/ThreeDotsLabs/watermill"
	"github.com/ThreeDotsLabs/watermill/message"

	"github.com/shortlink-org/portolan/examples/auth/internal/domain/session/event"
	"github.com/shortlink-org/portolan/examples/auth/internal/pkg/messaging"
)

// Topic is where this domain's events go.
const Topic = "auth_session"

// SessionStarted is the wire form of auth.SessionStarted.
type SessionStarted struct {
	SessionID  string    `json:"sessionId"`
	UserID     string    `json:"userId"`
	ExpiresAt  time.Time `json:"expiresAt"`
	OccurredAt time.Time `json:"occurredAt"`
}

// SessionEnded is the wire form of auth.SessionEnded.
type SessionEnded struct {
	SessionID  string    `json:"sessionId"`
	UserID     string    `json:"userId"`
	Reason     string    `json:"reason"`
	OccurredAt time.Time `json:"occurredAt"`
}

// Marshal turns a domain event into a message.
func Marshal(e event.Event) (*message.Message, error) {
	var (
		payload []byte
		err     error
	)

	switch typed := e.(type) {
	case event.SessionStarted:
		payload, err = json.Marshal(SessionStarted{
			SessionID:  typed.SessionID(),
			UserID:     typed.UserID(),
			ExpiresAt:  typed.ExpiresAt(),
			OccurredAt: typed.OccurredAt(),
		})

	case event.SessionEnded:
		payload, err = json.Marshal(SessionEnded{
			SessionID:  typed.SessionID(),
			UserID:     typed.UserID(),
			Reason:     string(typed.Reason()),
			OccurredAt: typed.OccurredAt(),
		})

	default:
		return nil, fmt.Errorf("dto: %s has no wire shape", e.Name())
	}

	if err != nil {
		return nil, fmt.Errorf("dto: %s: %w", e.Name(), err)
	}

	msg := message.NewMessage(watermill.NewUUID(), payload)
	msg.Metadata.Set(messaging.MetadataEventName, e.Name())

	return msg, nil
}

// Unmarshal rebuilds a domain event from a message, or returns nil for a name
// this build does not know. See the user domain's dto for why unknown is not an
// error.
func Unmarshal(msg *message.Message) (event.Event, error) {
	name := msg.Metadata.Get(messaging.MetadataEventName)

	switch name {
	case event.TopicSessionStarted:
		var wire SessionStarted
		if err := json.Unmarshal(msg.Payload, &wire); err != nil {
			return nil, fmt.Errorf("dto: reading %s: %w", name, err)
		}
		return event.NewSessionStarted(wire.SessionID, wire.UserID, wire.ExpiresAt, wire.OccurredAt), nil

	case event.TopicSessionEnded:
		var wire SessionEnded
		if err := json.Unmarshal(msg.Payload, &wire); err != nil {
			return nil, fmt.Errorf("dto: reading %s: %w", name, err)
		}
		return event.NewSessionEnded(wire.SessionID, wire.UserID, event.Reason(wire.Reason), wire.OccurredAt), nil

	default:
		return nil, nil
	}
}
