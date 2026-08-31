package rules

import (
	"encoding/base64"
	"errors"

	"github.com/shortlink-org/go-sdk/specification"
)

var ErrMalformed = errors.New("token is not base64url")

// EncodingSpec checks that the token is what New produces: unpadded base64url.
type EncodingSpec struct{}

var _ specification.Specification[string] = EncodingSpec{}

func (EncodingSpec) IsSatisfiedBy(value *string) error {
	if value == nil || *value == "" {
		// RequiredSpec reports the empty case; two rules naming one fault read
		// as two faults.
		return nil
	}
	if _, err := base64.RawURLEncoding.DecodeString(*value); err != nil {
		return ErrMalformed
	}
	return nil
}
