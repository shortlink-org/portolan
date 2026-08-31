package rules

import (
	"encoding/base64"
	"errors"

	"github.com/shortlink-org/go-sdk/specification"
)

// Bytes is the entropy behind a token. 32 bytes is not guessable and still fits
// in a cookie.
const Bytes = 32

var ErrWrongLength = errors.New("token is not 32 bytes")

type LengthSpec struct{}

var _ specification.Specification[string] = LengthSpec{}

func (LengthSpec) IsSatisfiedBy(value *string) error {
	if value == nil || *value == "" {
		return nil
	}
	decoded, err := base64.RawURLEncoding.DecodeString(*value)
	if err != nil {
		// EncodingSpec reports this one.
		return nil
	}
	if len(decoded) != Bytes {
		return ErrWrongLength
	}
	return nil
}
