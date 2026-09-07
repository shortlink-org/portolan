package change_password

import domainpassword "github.com/shortlink-org/portolan/examples/auth/internal/user/domain/vo/password"

// PasswordHasher is the cryptographic capability password replacement needs:
// verify the current password and hash its replacement.
type PasswordHasher interface {
	Hash(plaintext string) (domainpassword.Hash, error)
	Verify(plaintext string, hash domainpassword.Hash) bool
}
