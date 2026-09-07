package password_test

import (
	"errors"
	"strings"
	"testing"

	"github.com/shortlink-org/portolan/examples/auth/internal/user/domain/vo/password"
	"github.com/shortlink-org/portolan/examples/auth/internal/user/domain/vo/password/rules"
)

func TestValidateAcceptsAtTheBoundaries(t *testing.T) {
	for name, plaintext := range map[string]string{
		"minimum":     "Passw0rd",
		"maximum":     "Passw0rd" + strings.Repeat("a", 24),
		"punctuation": "Passw0rd!@#",
		"unicode":     "Пароль1A",
	} {
		t.Run(name, func(t *testing.T) {
			if err := password.Validate(plaintext); err != nil {
				t.Fatalf("Validate(%q) = %v", plaintext, err)
			}
		})
	}
}

func TestValidateReportsEveryBrokenRule(t *testing.T) {
	err := password.Validate("abc")
	for _, want := range []error{rules.ErrTooShort, rules.ErrNoDigit, rules.ErrNoUpper} {
		if !errors.Is(err, want) {
			t.Errorf("want %v among the failures, got %v", want, err)
		}
	}
}

func TestParseHash(t *testing.T) {
	const encoded = "pbdf$210000$00$01"
	hash, err := password.ParseHash(encoded)
	if err != nil {
		t.Fatal(err)
	}
	if hash.String() != encoded || hash.IsZero() {
		t.Fatalf("hash = %q", hash.String())
	}
}

func TestParseHashRejectsCorruptStorage(t *testing.T) {
	for _, encoded := range []string{"", "broken", "algo$0$00$01", "algo$1$$01", "algo$1$00$"} {
		if _, err := password.ParseHash(encoded); err == nil {
			t.Errorf("ParseHash(%q) succeeded", encoded)
		}
	}
}
