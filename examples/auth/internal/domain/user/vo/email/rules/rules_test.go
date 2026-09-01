package rules_test

import (
	"errors"
	"strings"
	"testing"

	"github.com/shortlink-org/portolan/examples/auth/internal/domain/user/vo/email/rules"
)

func satisfied(t *testing.T, spec interface{ IsSatisfiedBy(*string) error }, value string) error {
	t.Helper()
	return spec.IsSatisfiedBy(&value)
}

func TestRequired(t *testing.T) {
	spec := rules.RequiredSpec{}
	for _, empty := range []string{"", " ", "\t\n"} {
		if err := satisfied(t, spec, empty); !errors.Is(err, rules.ErrRequired) {
			t.Errorf("%q should be required, got %v", empty, err)
		}
	}
	if err := satisfied(t, spec, "ada@example.com"); err != nil {
		t.Errorf("an address is not empty: %v", err)
	}
}

func TestMaxLength(t *testing.T) {
	spec := rules.MaxLengthSpec{}
	atLimit := strings.Repeat("a", rules.MaxLength)
	if err := satisfied(t, spec, atLimit); err != nil {
		t.Errorf("%d characters is the limit, not past it: %v", rules.MaxLength, err)
	}
	if err := satisfied(t, spec, atLimit+"a"); !errors.Is(err, rules.ErrTooLong) {
		t.Errorf("%d characters should be too long, got %v", rules.MaxLength+1, err)
	}
}

func TestParsable(t *testing.T) {
	spec := rules.ParsableSpec{}
	if err := satisfied(t, spec, "nope"); !errors.Is(err, rules.ErrMalformed) {
		t.Errorf("%q is not an address, got %v", "nope", err)
	}
	// RequiredSpec owns the empty case; two rules naming one fault would read
	// as two faults.
	if err := satisfied(t, spec, ""); err != nil {
		t.Errorf("an empty value is RequiredSpec's business, got %v", err)
	}
}

func TestNoDisplayName(t *testing.T) {
	spec := rules.NoDisplayNameSpec{}
	if err := satisfied(t, spec, "Ada <ada@example.com>"); !errors.Is(err, rules.ErrDisplayName) {
		t.Errorf("a display name is not a login, got %v", err)
	}
	if err := satisfied(t, spec, "ada@example.com"); err != nil {
		t.Errorf("a bare address carries no display name: %v", err)
	}
	// ParsableSpec owns rubbish.
	if err := satisfied(t, spec, "nope"); err != nil {
		t.Errorf("unparsable input is ParsableSpec's business, got %v", err)
	}
}

// The policy has to report everything that is wrong at once, or a form tells
// its user one mistake per attempt.
func TestCompositeJoinsFailures(t *testing.T) {
	err := satisfied(t, rules.NewSpecification(), "")
	if !errors.Is(err, rules.ErrRequired) {
		t.Fatalf("want ErrRequired in %v", err)
	}
	joined, ok := err.(interface{ Unwrap() []error })
	if !ok {
		t.Fatal("the composite should join its failures, not return the first")
	}
	if len(joined.Unwrap()) == 0 {
		t.Fatal("no failures were joined")
	}
}
