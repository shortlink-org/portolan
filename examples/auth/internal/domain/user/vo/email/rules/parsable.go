package rules

import (
	"errors"
	"net/mail"
	"strings"

	"github.com/shortlink-org/go-sdk/specification"
)

var ErrMalformed = errors.New("email must be an email address")

// ParsableSpec defers to net/mail rather than to a pattern of our own.
//
// An address is harder to describe than it looks, and hand-rolled expressions
// reject real ones - plus tags, apostrophes, long TLDs. The standard library
// already implements the grammar; there is nothing to gain by restating it
// worse.
type ParsableSpec struct{}

var _ specification.Specification[string] = ParsableSpec{}

func (ParsableSpec) IsSatisfiedBy(value *string) error {
	if value == nil {
		return ErrMalformed
	}
	trimmed := strings.TrimSpace(*value)
	if trimmed == "" {
		// Nothing to parse. RequiredSpec is the rule that reports an empty
		// address, and two rules naming one fault read as two faults.
		return nil
	}
	if _, err := mail.ParseAddress(trimmed); err != nil {
		return ErrMalformed
	}
	return nil
}
