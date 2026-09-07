package rules

import "github.com/shortlink-org/go-sdk/specification"

// NewSpecification is the shape a token must have to be worth looking up.
//
// Failing it early saves a store lookup on obvious rubbish, and that is all it
// saves: a token that passes every rule here is still almost certainly unknown.
func NewSpecification() specification.Specification[string] {
	return specification.NewAndSpecification[string](
		RequiredSpec{},
		EncodingSpec{},
		LengthSpec{},
	)
}
