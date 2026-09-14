package event

import (
	"time"

	ddd "github.com/shortlink-org/portolan/pkg/ddd/event"
)

// PasswordChanged is published when a user's password is replaced. It says the
// password is different now; it does not carry the password, old or new, in any
// form.
//
// `by` is who made the change, as an opaque string: the caller's own identifier
// for itself, or empty when nobody in particular did it - an administrative
// reset, a migration. The user domain does not interpret it and has no idea
// what such an identifier refers to. Somebody downstream may recognise one of
// its own, and that is their business, not this package's.
type PasswordChanged struct {
	ddd.Base
	by string
}

func NewPasswordChanged(userID, by string, occurredAt time.Time) PasswordChanged {
	return PasswordChanged{Base: ddd.New(userID, occurredAt), by: by}
}

func (PasswordChanged) Name() string { return TopicPasswordChanged }

func (e PasswordChanged) UserID() string { return e.AggregateID() }

// By is whoever made the change, or empty when it was nobody in particular.
func (e PasswordChanged) By() string { return e.by }
