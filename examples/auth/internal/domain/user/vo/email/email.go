// Package email holds the email address value object.
//
// A value object has no identity: two addresses with the same normalised value
// are the same address, so they are compared by value and never mutated.
package email

import (
	"errors"
	"fmt"
	"net/mail"
	"strings"

	"github.com/shortlink-org/portolan/examples/auth/internal/domain/user/vo/email/rules"
)

// ErrInvalid marks every refusal by the policy. It is what tells a caller that
// the value was bad rather than that something broke, and it is owned here
// rather than in rules/ because this package imports that one.
//
// Which rules were broken is in the wrapped error; errors.Join puts all of them
// there, not just the first.
var ErrInvalid = errors.New("email is not acceptable")

// policy is built once. The specification is stateless, so there is no reason
// to assemble it per call.
var policy = rules.NewSpecification()

// Address is a normalised email address.
type Address struct {
	value string
}

// New validates and normalises. There is no other way to build an Address, so
// one that exists is one that passed.
func New(raw string) (Address, error) {
	trimmed := strings.TrimSpace(raw)

	if err := policy.IsSatisfiedBy(&trimmed); err != nil {
		return Address{}, fmt.Errorf("%w: %w", ErrInvalid, err)
	}

	// Safe: ParsableSpec is part of the policy, so this cannot fail here.
	parsed, err := mail.ParseAddress(trimmed)
	if err != nil {
		return Address{}, fmt.Errorf("%w: %w", ErrInvalid, rules.ErrMalformed)
	}

	return Address{value: strings.ToLower(parsed.Address)}, nil
}

func (a Address) String() string { return a.value }

func (a Address) IsZero() bool { return a.value == "" }

// Equal is the only comparison that matters for a value object.
func (a Address) Equal(other Address) bool { return a.value == other.value }
