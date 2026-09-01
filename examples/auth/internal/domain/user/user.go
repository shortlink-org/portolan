// Package user holds the User aggregate: a person, the address they log in
// with, and the hash of the password they log in by.
//
// The aggregate is the transactional boundary. Every rule below is enforced
// here and nowhere else, so a caller cannot reach past the root and leave a
// User in a state the domain says is impossible.
package user

import (
	"errors"
	"time"

	"github.com/shortlink-org/portolan/examples/auth/internal/domain/user/event"
	"github.com/shortlink-org/portolan/examples/auth/internal/domain/user/vo/email"
	"github.com/shortlink-org/portolan/examples/auth/internal/domain/user/vo/password"
)

var (
	ErrInvalidCredentials = errors.New("user: invalid credentials")
	ErrNotFound           = errors.New("user: not found")
	ErrEmailTaken         = errors.New("user: email already registered")

	// ErrConflict means the user was changed by somebody else since this copy
	// was read. The answer is always the same: read it again, redo the change,
	// save again.
	ErrConflict = errors.New("user: changed by somebody else")
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
// is the caller's business.
func Register(id, rawEmail, plaintext string, now time.Time) (*User, event.UserRegistered, error) {
	address, err := email.New(rawEmail)
	if err != nil {
		return nil, event.UserRegistered{}, err
	}
	hash, err := password.New(plaintext)
	if err != nil {
		return nil, event.UserRegistered{}, err
	}
	u := &User{
		ID:        id,
		Email:     address,
		Password:  hash,
		CreatedAt: now,
	}
	return u, event.NewUserRegistered(id, address.String(), now), nil
}

// ChangePassword replaces the password, given the current one.
//
// The current password is required even though the caller has already got this
// far. Without it a stolen session is a stolen account: whoever holds the token
// sets a new password and the owner is locked out of their own.
//
// `by` is recorded on the event as who did it. It is passed straight through -
// this aggregate has no idea what such an identifier refers to.
func (u *User) ChangePassword(current, next, by string, now time.Time) (event.PasswordChanged, error) {
	if err := u.Authenticate(current); err != nil {
		return event.PasswordChanged{}, err
	}
	hash, err := password.New(next)
	if err != nil {
		return event.PasswordChanged{}, err
	}
	u.Password = hash
	return event.NewPasswordChanged(u.ID, by, now), nil
}

// Authenticate checks a password. It answers with one error for every failure,
// so a caller cannot tell a wrong password from an unknown address.
func (u *User) Authenticate(plaintext string) error {
	if !u.Password.Matches(plaintext) {
		return ErrInvalidCredentials
	}
	return nil
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
