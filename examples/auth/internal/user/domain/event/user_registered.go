package event

import (
	"time"

	ddd "github.com/shortlink-org/portolan/pkg/ddd/event"
)

// UserRegistered is published once per user, at registration. It carries the
// address because consumers routinely need to reach the person, and asking
// auth for it on every event would make the bus useless.
//
// It does not, and must never, carry anything derived from the password.
type UserRegistered struct {
	ddd.Base
	email string
}

func NewUserRegistered(userID, email string, occurredAt time.Time) UserRegistered {
	return UserRegistered{Base: ddd.New(userID, occurredAt), email: email}
}

func (UserRegistered) Name() string { return TopicUserRegistered }

func (e UserRegistered) UserID() string { return e.AggregateID() }

func (e UserRegistered) Email() string { return e.email }
