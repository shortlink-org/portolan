package event

import "time"

// UserRegistered is published once per user, at registration. It carries the
// address because consumers routinely need to reach the person, and asking
// auth for it on every event would make the bus useless.
//
// It does not, and must never, carry anything derived from the password.
type UserRegistered struct {
	userID     string
	email      string
	occurredAt time.Time
}

func NewUserRegistered(userID, email string, occurredAt time.Time) UserRegistered {
	return UserRegistered{userID: userID, email: email, occurredAt: occurredAt}
}

func (UserRegistered) Name() string { return "auth.UserRegistered" }

func (e UserRegistered) AggregateID() string { return e.userID }

func (e UserRegistered) OccurredAt() time.Time { return e.occurredAt }

func (e UserRegistered) UserID() string { return e.userID }

func (e UserRegistered) Email() string { return e.email }
