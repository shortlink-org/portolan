// Package dto is the shape the user and session domains' events take on the
// wire.
//
// These are separate types from the events themselves on purpose. A domain
// event is an immutable fact built only through its constructor; giving it an
// UnmarshalJSON would add a second way to make one, writing straight into its
// private fields, and a fact with a setter stops being a fact. Keeping the wire
// shape here also keeps JSON out of the domain, and leaves somewhere to put a
// second version of a payload when one is needed.
package dto

import "time"

// UserRegistered is the wire form of auth.UserRegistered.
type UserRegistered struct {
	UserID     string    `json:"userId"`
	Email      string    `json:"email"`
	OccurredAt time.Time `json:"occurredAt"`
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
