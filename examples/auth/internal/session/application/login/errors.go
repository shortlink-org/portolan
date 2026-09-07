package login

import "errors"

// ErrBlocked is the application-level answer when risk refuses the attempt.
// It is returned after the account's sessions have been ended, never before.
var ErrBlocked = errors.New("login: attempt blocked")
