package password_test

import (
	"errors"
	"strings"
	"testing"

	"github.com/shortlink-org/portolan/examples/auth/internal/user/domain/vo/password"
	"github.com/shortlink-org/portolan/examples/auth/internal/user/domain/vo/password/rules"
	passwordadapter "github.com/shortlink-org/portolan/examples/auth/internal/user/infrastructure/password"
)

const good = "Passw0rdish"

func TestHashAndVerify(t *testing.T) {
	hasher := passwordadapter.NewHasher()
	hash, err := hasher.Hash(good)
	if err != nil {
		t.Fatal(err)
	}
	if !hasher.Verify(good, hash) || hasher.Verify(good+"x", hash) || hasher.Verify("", hash) {
		t.Fatal("Verify did not distinguish the original password")
	}
}

func TestHashAppliesDomainPolicy(t *testing.T) {
	_, err := passwordadapter.NewHasher().Hash("abc")
	if !errors.Is(err, password.ErrInvalid) || !errors.Is(err, rules.ErrTooShort) {
		t.Fatalf("Hash = %v, want password policy error", err)
	}
}

func TestHashesAreSaltedAndCarryParameters(t *testing.T) {
	hasher := passwordadapter.NewHasher()
	a, _ := hasher.Hash(good)
	b, _ := hasher.Hash(good)
	if a.String() == b.String() {
		t.Fatal("two hashes of one password should differ")
	}
	if len(strings.Split(a.String(), "$")) != 4 {
		t.Fatalf("stored hash = %q", a.String())
	}
	if hasher.NeedsRehash(a) {
		t.Fatal("a newly created hash should not need rehashing")
	}
}
