// Package token holds the session token value object.
package token

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"fmt"

	"github.com/shortlink-org/portolan/examples/auth/internal/domain/session/vo/token/rules"
)

// ErrInvalid marks a string that is not shaped like one of our tokens. The
// wrapped error says which rule it broke; nothing outside auth is ever told.
var ErrInvalid = errors.New("token is not acceptable")

var policy = rules.NewSpecification()

// Token is the opaque string a client presents instead of a password.
//
// Opaque is the point: it carries no claims, so nothing outside the session
// domain can read anything out of it, and revoking it is a fact in the store
// rather than a signature that has to expire.
type Token struct {
	value string
}

// New mints a random token.
func New() (Token, error) {
	b := make([]byte, rules.Bytes)
	if _, err := rand.Read(b); err != nil {
		return Token{}, fmt.Errorf("token: reading entropy: %w", err)
	}
	return Token{value: base64.RawURLEncoding.EncodeToString(b)}, nil
}

// Parse rebuilds a token presented by a client. It checks shape only - whether
// the token is live is a question for the aggregate, not for a string.
func Parse(raw string) (Token, error) {
	if err := policy.IsSatisfiedBy(&raw); err != nil {
		return Token{}, fmt.Errorf("%w: %w", ErrInvalid, err)
	}
	return Token{value: raw}, nil
}

func (t Token) String() string { return t.value }

func (t Token) IsZero() bool { return t.value == "" }

// Equal compares in constant time: a token is a secret, and comparing it is a
// lookup an attacker can time.
func (t Token) Equal(other Token) bool {
	return subtle.ConstantTimeCompare([]byte(t.value), []byte(other.value)) == 1
}
