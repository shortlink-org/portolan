package check_credentials

import (
	"context"

	domainpassword "github.com/shortlink-org/portolan/examples/auth/internal/user/domain/vo/password"
)

// PasswordVerifier is the cryptographic capability a credential check needs.
// Hashing is deliberately absent: this use case never creates a password.
type PasswordVerifier interface {
	Verify(plaintext string, hash domainpassword.Hash) bool
}

// Lockout is what check_credentials needs from the lockout domain, stated as the
// smallest interface that says it: may this account have a password checked,
// and here is how the check went.
//
// Declared HERE, by the only code that calls it, rather than in either domain.
// The user domain has no line that uses it, and the lockout domain does not
// know who asks. The implementation is the lockout domain's three use cases,
// adapted to this shape at wiring time; that keeps the knowledge that both
// domains exist in one place, the assembly.
type Lockout interface {
	// Allowed says whether a password may be checked for the account now. An
	// error is the lockout store being unreachable, not an answer, and the
	// credential check does not go ahead on it.
	Allowed(ctx context.Context, userID string) (bool, error)

	// Failed records a wrong password.
	Failed(ctx context.Context, userID string) error

	// Succeeded records a right one.
	Succeeded(ctx context.Context, userID string) error
}
