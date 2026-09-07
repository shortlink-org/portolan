package rules

import (
	"errors"
	"net/mail"
	"strings"

	"github.com/shortlink-org/go-sdk/specification"
)

var ErrDisplayName = errors.New("email must not carry a display name")

// NoDisplayNameSpec refuses `Ada <ada@example.com>`.
//
// net/mail parses that happily and hands back the address, which would let a
// login be typed in a form the store never sees. What was parsed has to be all
// there was.
type NoDisplayNameSpec struct{}

var _ specification.Specification[string] = NoDisplayNameSpec{}

func (NoDisplayNameSpec) IsSatisfiedBy(value *string) error {
	if value == nil {
		return nil
	}
	trimmed := strings.TrimSpace(*value)
	parsed, err := mail.ParseAddress(trimmed)
	if err != nil {
		// Not parsable at all: ParsableSpec is the rule that says so, and two
		// rules reporting one fault would read as two faults.
		return nil
	}
	if parsed.Name != "" || !strings.EqualFold(parsed.Address, trimmed) {
		return ErrDisplayName
	}
	return nil
}
