package rules_test

import (
	"encoding/base64"
	"errors"
	"testing"

	"github.com/shortlink-org/portolan/examples/auth/internal/domain/session/vo/token/rules"
)

func check(spec interface{ IsSatisfiedBy(*string) error }, value string) error {
	return spec.IsSatisfiedBy(&value)
}

func valid() string {
	return base64.RawURLEncoding.EncodeToString(make([]byte, rules.Bytes))
}

func TestRequired(t *testing.T) {
	if err := check(rules.RequiredSpec{}, ""); !errors.Is(err, rules.ErrRequired) {
		t.Errorf("an empty token is missing, got %v", err)
	}
	if err := check(rules.RequiredSpec{}, valid()); err != nil {
		t.Errorf("a token is not missing: %v", err)
	}
}

func TestEncoding(t *testing.T) {
	spec := rules.EncodingSpec{}
	if err := check(spec, "...."); !errors.Is(err, rules.ErrMalformed) {
		t.Errorf("rubbish is not base64url, got %v", err)
	}
	if err := check(spec, valid()); err != nil {
		t.Errorf("what New produces is base64url: %v", err)
	}
	// RequiredSpec owns the empty case.
	if err := check(spec, ""); err != nil {
		t.Errorf("an empty value is RequiredSpec's business, got %v", err)
	}
}

func TestLength(t *testing.T) {
	spec := rules.LengthSpec{}
	short := base64.RawURLEncoding.EncodeToString(make([]byte, rules.Bytes-1))

	if err := check(spec, short); !errors.Is(err, rules.ErrWrongLength) {
		t.Errorf("%d bytes is not %d, got %v", rules.Bytes-1, rules.Bytes, err)
	}
	if err := check(spec, valid()); err != nil {
		t.Errorf("%d bytes is right: %v", rules.Bytes, err)
	}
	// EncodingSpec owns undecodable input.
	if err := check(spec, "...."); err != nil {
		t.Errorf("undecodable input is EncodingSpec's business, got %v", err)
	}
}

func TestComposite(t *testing.T) {
	if err := check(rules.NewSpecification(), valid()); err != nil {
		t.Errorf("a well-formed token satisfies the policy: %v", err)
	}
	if err := check(rules.NewSpecification(), ""); !errors.Is(err, rules.ErrRequired) {
		t.Errorf("an empty token does not, got %v", err)
	}
}
