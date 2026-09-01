package rules_test

import (
	"errors"
	"strings"
	"testing"

	"github.com/shortlink-org/portolan/examples/auth/internal/domain/user/vo/password/rules"
)

func check(spec interface{ IsSatisfiedBy(*string) error }, value string) error {
	return spec.IsSatisfiedBy(&value)
}

func TestLengthBoundaries(t *testing.T) {
	minSpec, maxSpec := rules.MinLengthSpec{}, rules.MaxLengthSpec{}

	if err := check(minSpec, strings.Repeat("a", rules.MinLength-1)); !errors.Is(err, rules.ErrTooShort) {
		t.Errorf("%d characters is short, got %v", rules.MinLength-1, err)
	}
	if err := check(minSpec, strings.Repeat("a", rules.MinLength)); err != nil {
		t.Errorf("%d characters is the minimum, not below it: %v", rules.MinLength, err)
	}
	if err := check(maxSpec, strings.Repeat("a", rules.MaxLength)); err != nil {
		t.Errorf("%d characters is the maximum, not past it: %v", rules.MaxLength, err)
	}
	if err := check(maxSpec, strings.Repeat("a", rules.MaxLength+1)); !errors.Is(err, rules.ErrTooLong) {
		t.Errorf("%d characters is too long, got %v", rules.MaxLength+1, err)
	}
}

func TestCharacterClasses(t *testing.T) {
	cases := []struct {
		name    string
		spec    interface{ IsSatisfiedBy(*string) error }
		pass    string
		fail    string
		failErr error
	}{
		{"digit", rules.HasDigitSpec{}, "abc1", "abcd", rules.ErrNoDigit},
		{"lower", rules.HasLowerSpec{}, "ABCd", "ABCD", rules.ErrNoLower},
		{"upper", rules.HasUpperSpec{}, "abcD", "abcd", rules.ErrNoUpper},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if err := check(c.spec, c.pass); err != nil {
				t.Errorf("%q satisfies the rule: %v", c.pass, err)
			}
			if err := check(c.spec, c.fail); !errors.Is(err, c.failErr) {
				t.Errorf("%q should not, got %v", c.fail, err)
			}
		})
	}
}

// Unicode counts. A Cyrillic capital is a capital.
func TestCharacterClassesAreNotAscii(t *testing.T) {
	if err := check(rules.HasUpperSpec{}, "Пароль"); err != nil {
		t.Errorf("П is an upper-case letter: %v", err)
	}
	if err := check(rules.HasLowerSpec{}, "ПАРОЛЬь"); err != nil {
		t.Errorf("ь is a lower-case letter: %v", err)
	}
}

func TestNoWhitespace(t *testing.T) {
	spec := rules.NoWhitespaceSpec{}
	for _, spaced := range []string{"a b", "a\tb", "ab ", " ab", "a\nb"} {
		if err := check(spec, spaced); !errors.Is(err, rules.ErrWhitespace) {
			t.Errorf("%q contains whitespace, got %v", spaced, err)
		}
	}
	if err := check(spec, "Passw0rd"); err != nil {
		t.Errorf("%q has no whitespace: %v", "Passw0rd", err)
	}
}

func TestCompositeReportsEveryFailure(t *testing.T) {
	err := check(rules.NewSpecification(), "abc")
	for _, want := range []error{rules.ErrTooShort, rules.ErrNoDigit, rules.ErrNoUpper} {
		if !errors.Is(err, want) {
			t.Errorf("want %v among the failures, got %v", want, err)
		}
	}
	if errors.Is(err, rules.ErrNoLower) {
		t.Error("abc has lower-case letters; that rule should not have failed")
	}
}
