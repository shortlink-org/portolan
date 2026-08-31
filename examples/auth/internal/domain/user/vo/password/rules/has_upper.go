package rules

import (
	"errors"
	"unicode"

	"github.com/shortlink-org/go-sdk/specification"
)

var ErrNoUpper = errors.New("password must contain an upper-case letter")

type HasUpperSpec struct{}

var _ specification.Specification[string] = HasUpperSpec{}

func (HasUpperSpec) IsSatisfiedBy(value *string) error {
	if value == nil {
		return ErrNoUpper
	}
	for _, r := range *value {
		if unicode.IsUpper(r) {
			return nil
		}
	}
	return ErrNoUpper
}
