package rules

import (
	"errors"
	"unicode"

	"github.com/shortlink-org/go-sdk/specification"
)

var ErrNoDigit = errors.New("password must contain a digit")

type HasDigitSpec struct{}

var _ specification.Specification[string] = HasDigitSpec{}

func (HasDigitSpec) IsSatisfiedBy(value *string) error {
	if value == nil {
		return ErrNoDigit
	}
	for _, r := range *value {
		if unicode.IsDigit(r) {
			return nil
		}
	}
	return ErrNoDigit
}
