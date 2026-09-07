// Package user holds the User aggregate: a person, the address they log in
// with, and the hash of the password they log in by.
//
// The aggregate is the transactional boundary. Every rule below is enforced
// here and nowhere else, so a caller cannot reach past the root and leave a
// User in a state the domain says is impossible.
package user

import (
	"time"

	"github.com/shortlink-org/portolan/examples/auth/internal/user/domain/event"
	"github.com/shortlink-org/portolan/examples/auth/internal/user/domain/vo/email"
	"github.com/shortlink-org/portolan/examples/auth/internal/user/domain/vo/password"
)

// User is the aggregate root. Identity is ID, minted once at registration and
// never reused - not the email, because people change addresses.
type User struct {
	ID        string
	Email     email.Address
	Password  password.Hash
	CreatedAt time.Time

	// Version is what the store compares against before writing. It is carried
	// on the aggregate rather than known only to the repository so that a copy
	// which has gone stale can say so - without it, two changes made from two
	// reads both succeed and the first one silently disappears.
	//
	// Zero means the user has never been stored.
	Version int64
}

// Register builds a User with its password already hashed, and returns the fact
// that it happened alongside it.
//
// The event is RETURNED rather than buffered on the aggregate. An aggregate
// that quietly accumulates events carries hidden state and has to know the word
// "committed"; here what happened is visible in the signature, and publishing
// is the caller's business. See docs/adr/0001-events-returned-not-buffered.md.
func Register(id, rawEmail string, hash password.Hash, now time.Time) (*User, event.UserRegistered, error) {
	address, err := email.New(rawEmail)
	if err != nil {
		return nil, event.UserRegistered{}, err
	}
	if hash.IsZero() {
		return nil, event.UserRegistered{}, ErrPasswordRequired
	}
	u := &User{
		ID:        id,
		Email:     address,
		Password:  hash,
		CreatedAt: now,
	}
	return u, event.NewUserRegistered(id, address.String(), now), nil
}

// ChangePassword replaces the password with a validated, already-derived hash.
// Verifying the current password and deriving the next hash are application
// concerns behind the change_password slice's port.
// `by` is recorded on the event as who did it. It is passed straight through -
// this aggregate has no idea what such an identifier refers to.
func (u *User) ChangePassword(hash password.Hash, by string, now time.Time) (event.PasswordChanged, error) {
	if hash.IsZero() {
		return event.PasswordChanged{}, ErrPasswordRequired
	}
	u.Password = hash
	return event.NewPasswordChanged(u.ID, by, now), nil
}

// Clone returns a copy that shares nothing a caller can change.
//
// It exists for the repositories. Handing out the stored object would put the
// aggregate boundary in the caller's hands: a mutation would reach storage
// without a Save, and a Save that failed would leave the change visible anyway.
//
// The copy is shallow because every field is either a value or a value object
// whose contents cannot be changed after construction. A mutable field added to
// User has to be copied here explicitly, which is the reason this method lives
// on the aggregate rather than in the adapters.
//
// The version travels with the copy: a clone is as fresh, or as stale, as the
// aggregate it was taken from.
func (u *User) Clone() *User {
	if u == nil {
		return nil
	}
	copied := *u
	return &copied
}
