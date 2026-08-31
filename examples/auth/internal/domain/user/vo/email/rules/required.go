// Package rules holds the specifications an email address must satisfy.
//
// One rule per file, each owning the error it raises, so a rule and the reason
// it gives are read together. The policy - which of them actually apply - is
// composite.go and nothing else.
package rules

import (
	"errors"
	"strings"

	"github.com/shortlink-org/go-sdk/specification"
)

var ErrRequired = errors.New("email is required")

// RequiredSpec refuses an empty address. Whitespace only is empty: nobody typed
// an address, they typed nothing and a space.
type RequiredSpec struct{}

var _ specification.Specification[string] = RequiredSpec{}

func (RequiredSpec) IsSatisfiedBy(value *string) error {
	if value == nil || strings.TrimSpace(*value) == "" {
		return ErrRequired
	}
	return nil
}
