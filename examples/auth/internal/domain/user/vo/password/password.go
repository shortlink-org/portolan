// Package password holds the password hash value object.
package password

import (
	"crypto/pbkdf2"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"fmt"
	"strconv"
	"strings"

	"github.com/shortlink-org/portolan/examples/auth/internal/domain/user/vo/password/rules"
)

// ErrInvalid marks a refusal by the policy. The wrapped error carries every
// rule that was broken.
var ErrInvalid = errors.New("password is not acceptable")

var policy = rules.NewSpecification()

// Cost of the derivation. Stored alongside every hash rather than assumed, so
// raising it here leaves already-stored hashes verifiable.
const (
	algorithm  = "pbkdf2-sha256"
	iterations = 210_000 // OWASP floor for PBKDF2-HMAC-SHA256
	keyLength  = 32
	saltLength = 16
)

// Hash is what the user domain stores in place of a password. The plaintext
// never lives on an aggregate and never leaves the function that hashed it.
type Hash struct {
	algorithm  string
	iterations int
	salt       []byte
	digest     []byte
}

// New applies the policy and derives a hash with a fresh random salt.
func New(plaintext string) (Hash, error) {
	if err := policy.IsSatisfiedBy(&plaintext); err != nil {
		return Hash{}, fmt.Errorf("%w: %w", ErrInvalid, err)
	}

	salt := make([]byte, saltLength)
	if _, err := rand.Read(salt); err != nil {
		return Hash{}, fmt.Errorf("password: reading salt: %w", err)
	}
	digest, err := pbkdf2.Key(sha256.New, plaintext, salt, iterations, keyLength)
	if err != nil {
		return Hash{}, fmt.Errorf("password: deriving hash: %w", err)
	}

	return Hash{
		algorithm:  algorithm,
		iterations: iterations,
		salt:       salt,
		digest:     digest,
	}, nil
}

// ParseHash rebuilds a Hash from its stored form.
//
// It is the inverse of String and the reason that form carries its parameters:
// a hash written under an older cost has to stay verifiable, which means the
// cost has to be read back rather than assumed to be today's.
//
// The policy is not applied. Whatever was accepted when the password was set
// stays acceptable; this is the reading of a fact, not the making of one.
func ParseHash(stored string) (Hash, error) {
	parts := strings.Split(stored, "$")
	if len(parts) != 4 {
		return Hash{}, fmt.Errorf("password: %q is not a stored hash", stored)
	}

	iterations, err := strconv.Atoi(parts[1])
	if err != nil || iterations <= 0 {
		return Hash{}, fmt.Errorf("password: %q has no cost", stored)
	}
	salt, err := hex.DecodeString(parts[2])
	if err != nil {
		return Hash{}, fmt.Errorf("password: salt is not hex: %w", err)
	}
	digest, err := hex.DecodeString(parts[3])
	if err != nil {
		return Hash{}, fmt.Errorf("password: digest is not hex: %w", err)
	}
	if len(digest) == 0 {
		return Hash{}, fmt.Errorf("password: %q has no digest", stored)
	}

	return Hash{
		algorithm:  parts[0],
		iterations: iterations,
		salt:       salt,
		digest:     digest,
	}, nil
}

// Matches compares in constant time. A timing difference here tells an attacker
// how much of a guess was right.
//
// It does NOT apply the policy. The policy governs the creation of a secret,
// not its presentation: raising the minimum would otherwise lock out everyone
// who registered under the old one.
func (h Hash) Matches(plaintext string) bool {
	if h.algorithm != algorithm || len(h.digest) == 0 {
		return false
	}
	got, err := pbkdf2.Key(sha256.New, plaintext, h.salt, h.iterations, len(h.digest))
	if err != nil {
		return false
	}
	return subtle.ConstantTimeCompare(got, h.digest) == 1
}

func (h Hash) IsZero() bool { return len(h.digest) == 0 }

// String is the stored encoding: everything needed to verify, and nothing that
// helps guess. Used by the repository, not for display.
func (h Hash) String() string {
	return fmt.Sprintf("%s$%d$%s$%s",
		h.algorithm, h.iterations,
		hex.EncodeToString(h.salt), hex.EncodeToString(h.digest))
}
