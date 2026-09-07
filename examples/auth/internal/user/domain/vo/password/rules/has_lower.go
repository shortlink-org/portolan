package rules

import (
	"errors"
	"unicode"

	"github.com/shortlink-org/go-sdk/specification"
)

var ErrNoLower = errors.New("password must contain a lower-case letter")

type HasLowerSpec struct{}

var _ specification.Specification[string] = HasLowerSpec{}

func (HasLowerSpec) IsSatisfiedBy(value *string) error {
	if value == nil {
		return ErrNoLower
	}
	for _, r := range *value {
		if unicode.IsLower(r) {
			return nil
		}
	}
	return ErrNoLower
}
