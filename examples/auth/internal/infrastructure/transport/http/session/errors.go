package session

import (
	"errors"

	"github.com/shortlink-org/portolan/examples/auth/internal/application/session/usecases/login"
	"github.com/shortlink-org/portolan/examples/auth/internal/domain/session"
	"github.com/shortlink-org/portolan/examples/auth/internal/domain/session/vo/token"
	"github.com/shortlink-org/portolan/examples/auth/internal/domain/user"
)

// The session domain's errors, and the status each one is answered with.
//
// Everything about a token collapses into one 401. Unknown, malformed, expired,
// revoked - all the same answer, because telling them apart hands an attacker a
// way to sort real tokens from invented ones. The user domain's credential
// error lands here too: login passes it through untouched, and it must not
// arrive as a different code than a bad token would.
func status(err error) (code int, message string) {
	switch {
	case errors.Is(err, session.ErrNotFound),
		errors.Is(err, session.ErrExpired),
		errors.Is(err, session.ErrRevoked),
		errors.Is(err, token.ErrInvalid),
		errors.Is(err, user.ErrInvalidCredentials),
		errors.Is(err, login.ErrBlocked):
		// One answer for every cause. A blocked attempt is in the list for
		// the same reason: a 403 would say the account exists and is worth
		// attacking, which is the one thing the attacker came to learn. token.ErrInvalid is listed although the
		// use cases already fold it into ErrNotFound: if one ever stops doing
		// so, a malformed token must not start coming back as a 500 - and it
		// must never come back with reasons, which is why there is no 400 arm
		// here at all. Saying which rule a token broke would let an attacker
		// sort real tokens from invented ones.
		return 401, "unauthorized"
	case errors.Is(err, session.ErrConflict):
		// The first answer here that is not 401. It says nothing about whether
		// the session exists - a conflict is only reached after the session was
		// found and its token accepted, so admitting it discloses nothing that
		// the 200 on the way in did not.
		return 409, "the session was changed by somebody else; retry"
	default:
		return 500, "internal error"
	}
}
