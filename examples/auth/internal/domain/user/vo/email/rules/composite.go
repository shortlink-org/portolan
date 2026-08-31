package rules

import "github.com/shortlink-org/go-sdk/specification"

// NewSpecification is the email policy: every rule that currently applies.
//
// The rules above exist whether or not they are listed here. Tightening or
// relaxing what an address must satisfy is an edit to this list, and nothing
// else in the tree changes.
func NewSpecification() specification.Specification[string] {
	return specification.NewAndSpecification[string](
		RequiredSpec{},
		MaxLengthSpec{},
		ParsableSpec{},
		NoDisplayNameSpec{},
	)
}
