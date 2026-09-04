// Why this is not a counter on User: docs/adr/0004-lockout-is-its-own-aggregate.md.

// Package lockout holds the Lockout aggregate: how many wrong passwords in a
// row an account has taken, and whether it is refusing logins because of them.
//
// It is a separate aggregate from User on purpose. A failed attempt is written
// on every wrong password and the user does not change when one arrives; under
// one root every guess would contend with a password change on the same row.
// They are linked by user id and nothing else.
package lockout

import (
	"errors"
	"time"

	"github.com/shortlink-org/portolan/examples/auth/internal/domain/lockout/event"
)

// Threshold is how many wrong passwords in a row lock an account, and Duration
// is for how long. One value each, no per-user override, like session.TTL.
const (
	Threshold = 5
	Duration  = 15 * time.Minute
)

var (
	ErrNotFound = errors.New("lockout: not found")

	// ErrConflict means the lockout was changed by somebody else since this
	// copy was read - two wrong passwords arriving together, say. Read it
	// again and redo the change.
	ErrConflict = errors.New("lockout: changed by somebody else")
)

// Lockout is the aggregate root. Its identity is the user id: there is one per
// account, and it exists from the first wrong password on.
type Lockout struct {
	UserID string

	// Failures is the number of wrong passwords in a row. It is reset by a
	// right one and by the count starting again after a lock has run out.
	Failures int

	// LockedUntil is when the lock ends; zero while the account has never been
	// locked. A time in the past is a lock that ran out: the state is read off
	// it with `now`, and nothing runs when it passes.
	LockedUntil time.Time

	// Version is what the store compares against before writing; see the note
	// on user.User.Version. Zero means the lockout has never been stored.
	Version int64
}

// New starts counting for a user. It returns no event: a lockout that exists
// with nothing counted is not a fact anybody needs to hear.
func New(userID string) *Lockout {
	return &Lockout{UserID: userID}
}

// Locked reports whether the account is refusing logins at `now`.
func (l *Lockout) Locked(now time.Time) bool {
	return now.Before(l.LockedUntil)
}

// Allows is Locked the other way round, for the caller that asks before
// checking a password.
func (l *Lockout) Allows(now time.Time) bool {
	return !l.Locked(now)
}

// Fail records a wrong password. Open -> Open while the count is under the
// threshold; Open -> Locked, with the fact, on the failure that reaches it.
//
// The bool is false when this failure locked nothing: either the count is
// still short, or the account was already locked. A failure while locked is
// not counted at all - the password was not checked, so nothing was learned
// about it - and it publishes nothing.
//
// A lock that has run out is not a state of its own. The first failure after
// it starts the count again at one, so five wrong passwords spread over a
// week never lock anybody.
func (l *Lockout) Fail(now time.Time) (event.AccountLocked, bool) {
	if l.Locked(now) {
		return event.AccountLocked{}, false
	}
	// A lock that ran out is noticed here, on the next attempt: the way back
	// through the table, and the count starts again.
	l.trigger(EventLapse, now)

	l.Failures++
	if l.Failures < Threshold {
		return event.AccountLocked{}, false
	}

	if !l.trigger(EventLock, now) {
		return event.AccountLocked{}, false
	}
	return event.NewAccountLocked(l.UserID, l.LockedUntil, now), true
}

// Succeed records a right password and clears the count. It returns whether
// anything changed, so a caller can skip the write on the common case of a
// user who never typed a wrong one.
//
// There is no event. A count going back to zero is bookkeeping, not a fact
// with a consumer, and publishing one on every login would be noise.
//
// A success while locked changes nothing and keeps the lock. By construction
// it cannot happen - a locked account has its password refused unchecked -
// and if it is ever reported anyway, the lock is the safer thing to believe.
func (l *Lockout) Succeed(now time.Time) bool {
	if l.Locked(now) {
		return false
	}
	if l.Failures == 0 && l.LockedUntil.IsZero() {
		return false
	}

	// A right password after a lock ran out is the same way back as a wrong
	// one would have been; with no lock standing it is only the count going.
	if !l.trigger(EventLapse, now) {
		l.Failures = 0
	}
	return true
}

// Clone returns a copy that shares nothing a caller can change. See the note
// on User.Clone for why the repositories need it.
func (l *Lockout) Clone() *Lockout {
	if l == nil {
		return nil
	}
	copied := *l
	return &copied
}
