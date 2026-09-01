package event

import "time"

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
	userID     string
	by         string
	occurredAt time.Time
}

func NewPasswordChanged(userID, by string, occurredAt time.Time) PasswordChanged {
	return PasswordChanged{userID: userID, by: by, occurredAt: occurredAt}
}

func (PasswordChanged) Name() string { return "auth.PasswordChanged" }

func (e PasswordChanged) AggregateID() string { return e.userID }

func (e PasswordChanged) OccurredAt() time.Time { return e.occurredAt }

func (e PasswordChanged) UserID() string { return e.userID }

// By is whoever made the change, or empty when it was nobody in particular.
func (e PasswordChanged) By() string { return e.by }
