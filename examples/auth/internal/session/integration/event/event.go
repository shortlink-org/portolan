// Package event is the shape the session domain's events take on the wire, and
// the translation to and from it. See the user domain's dto for why these are
// separate types from the events themselves.
package event

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/ThreeDotsLabs/watermill"
	"github.com/ThreeDotsLabs/watermill/message"

	"github.com/shortlink-org/portolan/examples/auth/internal/platform/messaging"
	domainevent "github.com/shortlink-org/portolan/examples/auth/internal/session/domain/event"
)

// Topic is where this domain's events go.
const Topic = "auth_session"

const (
	TopicSessionStarted = domainevent.TopicSessionStarted
	TopicSessionEnded   = domainevent.TopicSessionEnded

	ReasonLogout          = string(domainevent.ReasonLogout)
	ReasonRevoked         = string(domainevent.ReasonRevoked)
	ReasonPasswordChanged = string(domainevent.ReasonPasswordChanged)
	ReasonRiskBlocked     = string(domainevent.ReasonRiskBlocked)
)

type Event interface {
	Name() string
	AggregateID() string
}

// SessionStarted is the wire form of auth.SessionStarted.
type SessionStarted struct {
	SessionID  string    `json:"sessionId"`
	UserID     string    `json:"userId"`
	ExpiresAt  time.Time `json:"expiresAt"`
	OccurredAt time.Time `json:"occurredAt"`
}

func (SessionStarted) Name() string          { return TopicSessionStarted }
func (e SessionStarted) AggregateID() string { return e.SessionID }

func NewSessionStarted(sessionID, userID string, expiresAt, occurredAt time.Time) SessionStarted {
	return SessionStarted{SessionID: sessionID, UserID: userID, ExpiresAt: expiresAt, OccurredAt: occurredAt}
}

// SessionEnded is the wire form of auth.SessionEnded.
type SessionEnded struct {
	SessionID  string    `json:"sessionId"`
	UserID     string    `json:"userId"`
	Reason     string    `json:"reason"`
	OccurredAt time.Time `json:"occurredAt"`
}

func (SessionEnded) Name() string          { return TopicSessionEnded }
func (e SessionEnded) AggregateID() string { return e.SessionID }

func NewSessionEnded(sessionID, userID, reason string, occurredAt time.Time) SessionEnded {
	return SessionEnded{SessionID: sessionID, UserID: userID, Reason: reason, OccurredAt: occurredAt}
}

// Marshal turns a domain event into a message.
func Marshal(e domainevent.Event) (*message.Message, error) {
	var (
		payload []byte
		err     error
	)

	switch typed := e.(type) {
	case domainevent.SessionStarted:
		payload, err = json.Marshal(SessionStarted{
			SessionID:  typed.SessionID(),
			UserID:     typed.UserID(),
			ExpiresAt:  typed.ExpiresAt(),
			OccurredAt: typed.OccurredAt(),
		})

	case domainevent.SessionEnded:
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

// Unmarshal rebuilds an integration event from a message, or returns nil for a name
// this build does not know. See the user domain's dto for why unknown is not an
// error.
func Unmarshal(msg *message.Message) (Event, error) {
	name := msg.Metadata.Get(messaging.MetadataEventName)

	switch name {
	case domainevent.TopicSessionStarted:
		var wire SessionStarted
		if err := json.Unmarshal(msg.Payload, &wire); err != nil {
			return nil, fmt.Errorf("dto: reading %s: %w", name, err)
		}
		return wire, nil

	case domainevent.TopicSessionEnded:
		var wire SessionEnded
		if err := json.Unmarshal(msg.Payload, &wire); err != nil {
			return nil, fmt.Errorf("dto: reading %s: %w", name, err)
		}
		return wire, nil

	default:
		return nil, nil
	}
}
