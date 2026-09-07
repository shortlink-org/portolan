// Package password holds password policy and the opaque stored hash value.
package password

import (
	"encoding/hex"
	"errors"
	"fmt"
	"strconv"
	"strings"

	"github.com/shortlink-org/portolan/examples/auth/internal/user/domain/vo/password/rules"
)

// ErrInvalid marks a refusal by the password policy. The wrapped errors carry
// the individual rules that failed.
var ErrInvalid = errors.New("password is not acceptable")

var policy = rules.NewSpecification()

// Hash is an opaque, immutable stored password hash. Hashing and verification
// are deliberately implemented behind the application port, outside domain.
type Hash struct {
	encoded string
}

// Validate applies the policy when a password is created or replaced. It is
// never applied while verifying an existing password.
func Validate(plaintext string) error {
	if err := policy.IsSatisfiedBy(&plaintext); err != nil {
		return fmt.Errorf("%w: %w", ErrInvalid, err)
	}
	return nil
}

// ParseHash rebuilds the opaque value from persistence while rejecting a
// structurally corrupt stored representation. Algorithm support belongs to the
// hasher: an old but well-formed algorithm may still need migration.
func ParseHash(stored string) (Hash, error) {
	parts := strings.Split(stored, "$")
	if len(parts) != 4 || parts[0] == "" {
		return Hash{}, fmt.Errorf("password: %q is not a stored hash", stored)
	}
	cost, err := strconv.Atoi(parts[1])
	if err != nil || cost <= 0 {
		return Hash{}, fmt.Errorf("password: %q has no cost", stored)
	}
	salt, err := hex.DecodeString(parts[2])
	if err != nil || len(salt) == 0 {
		return Hash{}, fmt.Errorf("password: %q has no salt", stored)
	}
	digest, err := hex.DecodeString(parts[3])
	if err != nil || len(digest) == 0 {
		return Hash{}, fmt.Errorf("password: %q has no digest", stored)
	}
	return Hash{encoded: stored}, nil
}

func (h Hash) String() string { return h.encoded }
func (h Hash) IsZero() bool   { return h.encoded == "" }
