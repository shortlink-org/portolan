package rules

import (
	"errors"

	"github.com/shortlink-org/go-sdk/specification"
)

const MaxLength = 32

var ErrTooLong = errors.New("password must be at most 32 characters")

// MaxLengthSpec bounds what is accepted. It is not a security measure - a long
// passphrase is a good one - only a limit on what may be stored and hashed.
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
