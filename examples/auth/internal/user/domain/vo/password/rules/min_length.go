// Package rules holds the specifications a new password must satisfy.
//
// One rule per file, each owning the error it raises. The policy - which of
// them apply - is composite.go and nothing else.
//
// Every rule here governs the CREATION of a password. None of them is consulted
// when one is checked: raising the minimum would otherwise lock out everyone
// who registered under the old one, whose stored hash is still perfectly good.
package rules

import (
	"errors"

	"github.com/shortlink-org/go-sdk/specification"
)

const MinLength = 8

var ErrTooShort = errors.New("password must be at least 8 characters")

type MinLengthSpec struct{}

var _ specification.Specification[string] = MinLengthSpec{}

func (MinLengthSpec) IsSatisfiedBy(value *string) error {
	if value == nil || len(*value) < MinLength {
		return ErrTooShort
	}
	return nil
}
