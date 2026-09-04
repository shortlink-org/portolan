// Package dto is the shape the lockout domain's events take on the wire, and
// the translation to and from it. See the user domain's dto for why these are
// separate types from the events themselves.
package dto

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/ThreeDotsLabs/watermill"
	"github.com/ThreeDotsLabs/watermill/message"

	"github.com/shortlink-org/portolan/examples/auth/internal/domain/lockout/event"
	"github.com/shortlink-org/portolan/examples/auth/internal/pkg/messaging"
)

// Topic is where this domain's events go.
const Topic = "auth_lockout"

// AccountLocked is the wire form of auth.AccountLocked.
type AccountLocked struct {
	UserID     string    `json:"userId"`
	Until      time.Time `json:"until"`
	OccurredAt time.Time `json:"occurredAt"`
}

// Marshal turns a domain event into a message.
func Marshal(e event.Event) (*message.Message, error) {
	var (
		payload []byte
		err     error
	)

	switch typed := e.(type) {
	case event.AccountLocked:
		payload, err = json.Marshal(AccountLocked{
			UserID:     typed.UserID(),
			Until:      typed.Until(),
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
// this build does not know.
func Unmarshal(msg *message.Message) (event.Event, error) {
	name := msg.Metadata.Get(messaging.MetadataEventName)

	switch name {
	case event.TopicAccountLocked:
		var wire AccountLocked
		if err := json.Unmarshal(msg.Payload, &wire); err != nil {
			return nil, fmt.Errorf("dto: reading %s: %w", name, err)
		}
		return event.NewAccountLocked(wire.UserID, wire.Until, wire.OccurredAt), nil

	default:
		return nil, nil
	}
}
