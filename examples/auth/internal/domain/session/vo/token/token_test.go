package token_test

import (
	"encoding/base64"
	"errors"
	"testing"

	"github.com/shortlink-org/portolan/examples/auth/internal/domain/session/vo/token"
	"github.com/shortlink-org/portolan/examples/auth/internal/domain/session/vo/token/rules"
)

func TestNewIsRandom(t *testing.T) {
	seen := map[string]bool{}
	for range 100 {
		minted, err := token.New()
		if err != nil {
			t.Fatal(err)
		}
		if seen[minted.String()] {
			t.Fatal("New produced the same token twice")
		}
		seen[minted.String()] = true
	}
}

func TestNewProducesWhatParseAccepts(t *testing.T) {
	minted, err := token.New()
	if err != nil {
		t.Fatal(err)
	}
	parsed, err := token.Parse(minted.String())
	if err != nil {
		t.Fatalf("Parse rejected what New minted: %v", err)
	}
	if !parsed.Equal(minted) {
		t.Error("a round trip should give the same token back")
	}
}

func TestParseRejects(t *testing.T) {
	short := base64.RawURLEncoding.EncodeToString([]byte("abc"))
	long := base64.RawURLEncoding.EncodeToString(make([]byte, rules.Bytes+1))

	cases := map[string]struct {
		raw  string
		rule error
	}{
		"empty":          {"", rules.ErrRequired},
		"not base64":     {"....", rules.ErrMalformed},
		"padded":         {base64.URLEncoding.EncodeToString(make([]byte, rules.Bytes)), rules.ErrMalformed},
		"too few bytes":  {short, rules.ErrWrongLength},
		"too many bytes": {long, rules.ErrWrongLength},
	}
	for name, c := range cases {
		t.Run(name, func(t *testing.T) {
			_, err := token.Parse(c.raw)
			if err == nil {
				t.Fatalf("Parse(%q) was accepted", c.raw)
			}
			if !errors.Is(err, token.ErrInvalid) {
				t.Errorf("want it marked with ErrInvalid, got %v", err)
			}
			if !errors.Is(err, c.rule) {
				t.Errorf("want %v, got %v", c.rule, err)
			}
		})
	}
}

func TestEqual(t *testing.T) {
	a, _ := token.New()
	b, _ := token.New()
	same, _ := token.Parse(a.String())

	if !a.Equal(same) {
		t.Error("the same token should compare equal")
	}
	if a.Equal(b) {
		t.Error("different tokens should not")
	}
}

func TestZeroValue(t *testing.T) {
	var zero token.Token
	if !zero.IsZero() {
		t.Error("the zero Token should report itself as zero")
	}
	minted, _ := token.New()
	if minted.IsZero() {
		t.Error("a minted Token is not zero")
	}
}
