package rules

import (
	"errors"

	"github.com/shortlink-org/go-sdk/specification"
)

// MaxLength is the RFC 5321 limit on a forward path. An address longer than
// this cannot be delivered to, so accepting it would only mean storing it.
const MaxLength = 254

var ErrTooLong = errors.New("email must be at most 254 characters")

type MaxLengthSpec struct{}

var _ specification.Specification[string] = MaxLengthSpec{}

func (MaxLengthSpec) IsSatisfiedBy(value *string) error {
	if value == nil {
		return nil
	}
	if len(*value) > MaxLength {
		return ErrTooLong
	}
	return nil
}
