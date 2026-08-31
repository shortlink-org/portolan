package rules

import (
	"errors"
	"unicode"

	"github.com/shortlink-org/go-sdk/specification"
)

var ErrWhitespace = errors.New("password must not contain whitespace")

// NoWhitespaceSpec is the one rule here with a real cost: it rules out
// passphrases, which are long and easy to remember. It is in the policy because
// a password copied out of a document usually arrives with a trailing space,
// and refusing it is less confusing than silently storing it.
type NoWhitespaceSpec struct{}

var _ specification.Specification[string] = NoWhitespaceSpec{}

func (NoWhitespaceSpec) IsSatisfiedBy(value *string) error {
	if value == nil {
		return nil
	}
	for _, r := range *value {
		if unicode.IsSpace(r) {
			return ErrWhitespace
		}
	}
	return nil
}
