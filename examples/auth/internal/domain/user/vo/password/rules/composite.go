package rules

import "github.com/shortlink-org/go-sdk/specification"

// NewSpecification is the password policy: every rule that currently applies.
//
// And joins the failures rather than stopping at the first, so somebody filling
// in a form is told everything that is wrong in one go instead of one rule per
// attempt.
func NewSpecification() specification.Specification[string] {
	return specification.NewAndSpecification[string](
		MinLengthSpec{},
		MaxLengthSpec{},
		HasDigitSpec{},
		HasLowerSpec{},
		HasUpperSpec{},
		NoWhitespaceSpec{},
	)
}
