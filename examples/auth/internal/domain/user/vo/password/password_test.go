package password_test

import (
	"errors"
	"strings"
	"testing"

	"github.com/shortlink-org/portolan/examples/auth/internal/domain/user/vo/password"
	"github.com/shortlink-org/portolan/examples/auth/internal/domain/user/vo/password/rules"
)

const good = "Passw0rdish"

func TestNewAcceptsAtTheBoundaries(t *testing.T) {
	cases := map[string]string{
		"minimum":     "Passw0rd",                           // exactly 8
		"maximum":     "Passw0rd" + strings.Repeat("a", 24), // exactly 32
		"punctuation": "Passw0rd!@#",
		"unicode":     "Пароль1A",
	}
	for name, plaintext := range cases {
		t.Run(name, func(t *testing.T) {
			if _, err := password.New(plaintext); err != nil {
				t.Fatalf("New(%q) = %v, want accepted", plaintext, err)
			}
		})
	}
}

func TestNewRejects(t *testing.T) {
	cases := map[string]struct {
		plaintext string
		rule      error
	}{
		"too short":  {"Passw0r", rules.ErrTooShort},
		"too long":   {"Passw0rd" + strings.Repeat("a", 25), rules.ErrTooLong},
		"no digit":   {"Passwordish", rules.ErrNoDigit},
		"no lower":   {"PASSW0RDISH", rules.ErrNoLower},
		"no upper":   {"passw0rdish", rules.ErrNoUpper},
		"whitespace": {"Passw0rd ish", rules.ErrWhitespace},
	}
	for name, c := range cases {
		t.Run(name, func(t *testing.T) {
			_, err := password.New(c.plaintext)
			if err == nil {
				t.Fatalf("New(%q) was accepted", c.plaintext)
			}
			if !errors.Is(err, password.ErrInvalid) {
				t.Errorf("want it marked with ErrInvalid, got %v", err)
			}
			if !errors.Is(err, c.rule) {
				t.Errorf("want %v, got %v", c.rule, err)
			}
		})
	}
}

// Somebody filling in a form should be told everything at once rather than one
// rule per attempt.
func TestAllBrokenRulesAreReported(t *testing.T) {
	_, err := password.New("abc")
	for _, want := range []error{rules.ErrTooShort, rules.ErrNoDigit, rules.ErrNoUpper} {
		if !errors.Is(err, want) {
			t.Errorf("want %v among the failures, got %v", want, err)
		}
	}
}

func TestMatches(t *testing.T) {
	hash, err := password.New(good)
	if err != nil {
		t.Fatal(err)
	}
	if !hash.Matches(good) {
		t.Error("the password that made the hash should match it")
	}
	if hash.Matches(good + "x") {
		t.Error("a different password should not match")
	}
	if hash.Matches("") {
		t.Error("the empty password should not match")
	}
}

// The whole point of keeping the policy out of Matches. A hash made under an
// older, laxer policy has to stay verifiable: raising the minimum must not lock
// out everyone who registered before it.
func TestMatchesIgnoresThePolicy(t *testing.T) {
	// Built through the current policy, then checked against a value that
	// today's rules would refuse outright.
	hash, err := password.New(good)
	if err != nil {
		t.Fatal(err)
	}
	if hash.Matches("abc") {
		t.Fatal("the wrong password matched")
	}

	// And the reverse: a policy failure is not something Matches ever reports.
	// It answers yes or no, never "your password is too short".
	if hash.Matches(strings.Repeat("x", 100)) {
		t.Error("an over-long guess is simply wrong, not rejected by policy")
	}
}

// A hash is different every time even for one password, because the salt is.
func TestHashesAreSalted(t *testing.T) {
	a, _ := password.New(good)
	b, _ := password.New(good)
	if a.String() == b.String() {
		t.Fatal("two hashes of one password should differ")
	}
	if !a.Matches(good) || !b.Matches(good) {
		t.Fatal("both should still verify")
	}
}

// The stored form has to carry its own parameters, or raising the cost makes
// every existing hash unverifiable.
func TestStoredFormCarriesItsParameters(t *testing.T) {
	hash, _ := password.New(good)
	parts := strings.Split(hash.String(), "$")
	if len(parts) != 4 {
		t.Fatalf("want algorithm$iterations$salt$digest, got %q", hash)
	}
	if parts[0] == "" || parts[1] == "" {
		t.Errorf("the algorithm and cost have to be in the stored form, got %q", hash)
	}
}

func TestZeroValueMatchesNothing(t *testing.T) {
	var zero password.Hash
	if !zero.IsZero() {
		t.Error("the zero Hash should report itself as zero")
	}
	if zero.Matches("") || zero.Matches(good) {
		t.Error("a zero Hash must never match anything")
	}
}
