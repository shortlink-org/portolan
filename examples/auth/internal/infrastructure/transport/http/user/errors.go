package user

import (
	"errors"
	"strings"

	"github.com/shortlink-org/portolan/examples/auth/internal/domain/user"
	"github.com/shortlink-org/portolan/examples/auth/internal/domain/user/vo/email"
	"github.com/shortlink-org/portolan/examples/auth/internal/domain/user/vo/password"
)

// The user domain's errors, and the status each one is answered with. This is
// the only place in the package that decides a code, so the same failure cannot
// come back as 401 from one endpoint and 403 from the next.
//
// Note ErrNotFound is a 404 here and a 401 in the session package. That is not
// an inconsistency: a caller asking for a user by id already knows the id, so
// admitting it does not exist discloses nothing, while "no such token" and
// "expired token" must stay indistinguishable.
func status(err error) (code int, message string) {
	switch {
	case errors.Is(err, email.ErrInvalid), errors.Is(err, password.ErrInvalid):
		// One arm for every validation rule there will ever be. A new rule in
		// the domain reaches the caller as a 400 without anything here
		// changing, which is why the value objects raise a marker rather than a
		// sentinel per rule.
		return 400, "the request is not acceptable"
	case errors.Is(err, user.ErrEmailTaken):
		return 409, "that address is already registered"
	case errors.Is(err, user.ErrInvalidCredentials):
		return 401, "invalid credentials"
	case errors.Is(err, user.ErrNotFound):
		return 404, "no such user"
	default:
		// Anything unrecognised is ours, not the caller's. The detail stays on
		// this side; the caller gets a code it can act on and nothing to probe.
		return 500, "internal error"
	}
}

// reasons flattens the rules a value broke into one string per rule.
//
// The policy is an And specification, which joins its failures rather than
// stopping at the first, and errors.Join hides them behind Unwrap() []error.
// Walking that tree is the only way to report everything that is wrong in one
// answer instead of one rule per attempt.
func reasons(err error) []string {
	var out []string

	var walk func(error)
	walk = func(e error) {
		switch x := e.(type) {
		case interface{ Unwrap() []error }:
			for _, inner := range x.Unwrap() {
				walk(inner)
			}
		case interface{ Unwrap() error }:
			// A wrapped marker: skip the marker itself, keep what it wraps.
			if inner := x.Unwrap(); inner != nil {
				walk(inner)
			}
		default:
			// The markers are not reasons: they say the value was refused, the
			// leaves say what was wrong with it.
			if errors.Is(e, email.ErrInvalid) || errors.Is(e, password.ErrInvalid) {
				return
			}
			if text := strings.TrimSpace(e.Error()); text != "" {
				out = append(out, text)
			}
		}
	}
	walk(err)

	return out
}
