package email_test

import (
	"errors"
	"strings"
	"testing"

	"github.com/shortlink-org/portolan/examples/auth/internal/domain/user/vo/email"
	"github.com/shortlink-org/portolan/examples/auth/internal/domain/user/vo/email/rules"
)

func TestNewAccepts(t *testing.T) {
	// Addresses that a hand-rolled pattern typically rejects and that real
	// people really use.
	cases := map[string]string{
		"plain":      "ada@example.com",
		"plus tag":   "ada+shop@example.com",
		"apostrophe": "o'hara@example.com",
		"long tld":   "ada@example.technology",
		"digits":     "ada2000@example.com",
		"subdomain":  "ada@mail.example.co.uk",
		"dashes":     "ada-lovelace@ex-ample.com",
	}
	for name, raw := range cases {
		t.Run(name, func(t *testing.T) {
			if _, err := email.New(raw); err != nil {
				t.Fatalf("New(%q) = %v, want accepted", raw, err)
			}
		})
	}
}

func TestNewNormalises(t *testing.T) {
	cases := []struct{ raw, want string }{
		{"Ada@Example.COM", "ada@example.com"},
		{"  ada@example.com  ", "ada@example.com"},
		{"ADA@EXAMPLE.COM", "ada@example.com"},
	}
	for _, c := range cases {
		got, err := email.New(c.raw)
		if err != nil {
			t.Fatalf("New(%q) = %v", c.raw, err)
		}
		if got.String() != c.want {
			t.Errorf("New(%q) = %q, want %q", c.raw, got, c.want)
		}
	}
}

// Two spellings of one address have to be one address, or the store holds both
// and neither can log in reliably.
func TestEqualIgnoresSpelling(t *testing.T) {
	a, _ := email.New("Ada@Example.com")
	b, _ := email.New(" ada@EXAMPLE.COM ")
	if !a.Equal(b) {
		t.Fatalf("%q and %q are the same address", a, b)
	}
}

func TestNewRejects(t *testing.T) {
	cases := map[string]struct {
		raw  string
		rule error
	}{
		"empty":        {"", rules.ErrRequired},
		"spaces only":  {"   ", rules.ErrRequired},
		"no at":        {"nope", rules.ErrMalformed},
		"no local":     {"@example.com", rules.ErrMalformed},
		"no domain":    {"ada@", rules.ErrMalformed},
		"display name": {"Ada <ada@example.com>", rules.ErrDisplayName},
		"too long":     {strings.Repeat("a", 250) + "@example.com", rules.ErrTooLong},
	}
	for name, c := range cases {
		t.Run(name, func(t *testing.T) {
			_, err := email.New(c.raw)
			if err == nil {
				t.Fatalf("New(%q) was accepted", c.raw)
			}
			if !errors.Is(err, email.ErrInvalid) {
				t.Errorf("New(%q) = %v, want it marked with ErrInvalid", c.raw, err)
			}
			if !errors.Is(err, c.rule) {
				t.Errorf("New(%q) = %v, want %v", c.raw, err, c.rule)
			}
		})
	}
}

// One fault, one reason. An empty address is required-and-nothing-else: saying
// it is also unparsable would report one mistake twice.
func TestEmptyGivesOneReason(t *testing.T) {
	_, err := email.New("")
	if errors.Is(err, rules.ErrMalformed) {
		t.Error("an empty address should not also be reported as malformed")
	}
}

func TestZeroValue(t *testing.T) {
	var zero email.Address
	if !zero.IsZero() {
		t.Error("the zero Address should report itself as zero")
	}
	built, _ := email.New("ada@example.com")
	if built.IsZero() {
		t.Error("a built Address is not zero")
	}
}
