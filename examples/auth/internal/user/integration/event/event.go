// Package event is the shape the user domain's events take on the wire, and the
// translation to and from it.
//
// These are separate types from the events themselves on purpose. A domain
// event is an immutable fact built only through its constructor; giving it an
// UnmarshalJSON would add a second way to make one, writing straight into its
// private fields, and a fact with a setter stops being a fact. Keeping the wire
// shape here also keeps JSON out of the domain, and leaves somewhere to put a
// second version of a payload when one is needed.
package event

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/ThreeDotsLabs/watermill"
	"github.com/ThreeDotsLabs/watermill/message"

	"github.com/shortlink-org/portolan/examples/auth/internal/platform/messaging"
	domainevent "github.com/shortlink-org/portolan/examples/auth/internal/user/domain/event"
)

// Topic is where this domain's events go. One topic per domain rather than per
// event: the name of the event is on the message, subscribers dispatch on it,
// and four topics would buy nothing over two.
//
// Underscored, not dotted. A topic is a value in a column here, but it has been
// a table name in other implementations, and a dot forces a quoted identifier
// that reads like a schema qualification and is not one.
const Topic = "auth_user"

const (
	NameUserRegistered   = domainevent.TopicUserRegistered
	NamePasswordChanged  = domainevent.TopicPasswordChanged
	TopicUserRegistered  = NameUserRegistered
	TopicPasswordChanged = NamePasswordChanged
)

// Event is the stable integration contract delivered after the outbox. It is
// deliberately smaller than the domain event contract: consumers need a name
// and the DTO fields, not aggregate behaviour.
type Event interface {
	Name() string
	AggregateID() string
}

// UserRegistered is the wire form of auth.UserRegistered.
type UserRegistered struct {
	UserID     string    `json:"userId"`
	Email      string    `json:"email"`
	OccurredAt time.Time `json:"occurredAt"`
}

func (UserRegistered) Name() string          { return NameUserRegistered }
func (e UserRegistered) AggregateID() string { return e.UserID }

func NewUserRegistered(userID, email string, occurredAt time.Time) UserRegistered {
	return UserRegistered{UserID: userID, Email: email, OccurredAt: occurredAt}
}

// PasswordChanged is the wire form of auth.PasswordChanged.
//
// It carries nothing derived from either password, old or new. `by` is whoever
// made the change - an opaque identifier the user domain records and does not
// interpret.
type PasswordChanged struct {
	UserID     string    `json:"userId"`
	By         string    `json:"by"`
	OccurredAt time.Time `json:"occurredAt"`
}

func (PasswordChanged) Name() string          { return NamePasswordChanged }
func (e PasswordChanged) AggregateID() string { return e.UserID }

func NewPasswordChanged(userID, by string, occurredAt time.Time) PasswordChanged {
	return PasswordChanged{UserID: userID, By: by, OccurredAt: occurredAt}
}

// Marshal turns a domain event into a message.
//
// The switch is exhaustive by intent, and the default says so loudly: an event
// type nobody added here is not a compile error, so it has to be a loud runtime
// one rather than a message that silently never gets written.
func Marshal(e domainevent.Event) (*message.Message, error) {
	var (
		payload []byte
		err     error
	)

	switch typed := e.(type) {
	case domainevent.UserRegistered:
		payload, err = json.Marshal(UserRegistered{
			UserID:     typed.UserID(),
			Email:      typed.Email(),
			OccurredAt: typed.OccurredAt(),
		})

	case domainevent.PasswordChanged:
		payload, err = json.Marshal(PasswordChanged{
			UserID:     typed.UserID(),
			By:         typed.By(),
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

// Unmarshal rebuilds an integration event from a message, or returns nil for a
// name this build does not know.
//
// An unknown name is nil rather than an error: it is almost always an event
// added by a newer version of this service, and refusing it would block every
// message behind it for good.
func Unmarshal(msg *message.Message) (Event, error) {
	name := msg.Metadata.Get(messaging.MetadataEventName)

	switch name {
	case domainevent.TopicUserRegistered:
		var wire UserRegistered
		if err := json.Unmarshal(msg.Payload, &wire); err != nil {
			return nil, fmt.Errorf("dto: reading %s: %w", name, err)
		}
		return wire, nil

	case domainevent.TopicPasswordChanged:
		var wire PasswordChanged
		if err := json.Unmarshal(msg.Payload, &wire); err != nil {
			return nil, fmt.Errorf("dto: reading %s: %w", name, err)
		}
		return wire, nil

	default:
		return nil, nil
	}
}
