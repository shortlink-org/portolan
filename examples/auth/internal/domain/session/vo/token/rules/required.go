// Package rules holds the specifications a session token must satisfy.
//
// The rules are shape only - a token is a random string, so there is nothing to
// judge about it beyond whether it could be one of ours.
//
// Their reasons never reach a client. Every failure here is answered with the
// same 401 as an unknown or expired token, because telling "this is not shaped
// like our tokens" apart from "we have never seen it" hands an attacker a way
// to sort real tokens from invented ones. The reasons exist for logs and tests.
package rules

import (
	"errors"

	"github.com/shortlink-org/go-sdk/specification"
)

var ErrRequired = errors.New("token is required")

type RequiredSpec struct{}

var _ specification.Specification[string] = RequiredSpec{}

func (RequiredSpec) IsSatisfiedBy(value *string) error {
	if value == nil || *value == "" {
		return ErrRequired
	}
	return nil
}
