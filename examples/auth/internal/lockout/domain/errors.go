package lockout

import "errors"

var (
	// ErrNotFound is part of the repository port contract. A missing lockout is
	// normal before an account's first failed credential check.
	ErrNotFound = errors.New("lockout: not found")

	// ErrConflict means the aggregate changed after it was read. Callers that
	// mutate lockouts must reload and reapply the operation so concurrent failed
	// attempts are not lost.
	ErrConflict = errors.New("lockout: changed by somebody else")
)
