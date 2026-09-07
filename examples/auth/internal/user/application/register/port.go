package register

import domainpassword "github.com/shortlink-org/portolan/examples/auth/internal/user/domain/vo/password"

// PasswordHasher is the cryptographic capability registration needs.
// Verification is deliberately absent: this use case only creates a password.
type PasswordHasher interface {
	Hash(plaintext string) (domainpassword.Hash, error)
}
