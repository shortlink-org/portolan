package user_test

import (
	"errors"
	"testing"
	"time"

	user "github.com/shortlink-org/portolan/examples/auth/internal/user/domain"
	"github.com/shortlink-org/portolan/examples/auth/internal/user/domain/vo/email"
	"github.com/shortlink-org/portolan/examples/auth/internal/user/domain/vo/password"
)

const address = "Ada@Example.com"

var now = time.Date(2026, 3, 1, 12, 0, 0, 0, time.UTC)

func storedHash(t *testing.T, marker string) password.Hash {
	t.Helper()
	hash, err := password.ParseHash("pbkdf2-sha256$210000$00$" + marker)
	if err != nil {
		t.Fatal(err)
	}
	return hash
}

func TestRegister(t *testing.T) {
	hash := storedHash(t, "01")
	u, ev, err := user.Register("u1", address, hash, now)
	if err != nil {
		t.Fatal(err)
	}
	if u.ID != "u1" || u.Email.String() != "ada@example.com" || u.Password.String() != hash.String() {
		t.Fatalf("user = %+v", u)
	}
	if ev.UserID() != "u1" || ev.Email() != "ada@example.com" || !ev.OccurredAt().Equal(now) {
		t.Fatalf("event = %+v", ev)
	}
}

func TestRegisterRefusesInvalidState(t *testing.T) {
	if _, _, err := user.Register("u1", "nope", storedHash(t, "01"), now); !errors.Is(err, email.ErrInvalid) {
		t.Errorf("invalid email = %v", err)
	}
	if _, _, err := user.Register("u1", address, password.Hash{}, now); !errors.Is(err, user.ErrPasswordRequired) {
		t.Errorf("zero password hash = %v", err)
	}
}

func TestChangePassword(t *testing.T) {
	u, _, _ := user.Register("u1", address, storedHash(t, "01"), now)
	next := storedHash(t, "02")
	ev, err := u.ChangePassword(next, "s1", now)
	if err != nil {
		t.Fatal(err)
	}
	if u.Password.String() != next.String() || ev.UserID() != "u1" || ev.By() != "s1" {
		t.Fatalf("user=%+v event=%+v", u, ev)
	}
}

func TestChangePasswordRefusesZeroHash(t *testing.T) {
	u, _, _ := user.Register("u1", address, storedHash(t, "01"), now)
	before := u.Password.String()
	if _, err := u.ChangePassword(password.Hash{}, "s1", now); !errors.Is(err, user.ErrPasswordRequired) {
		t.Fatalf("ChangePassword = %v", err)
	}
	if u.Password.String() != before {
		t.Fatal("a refused change altered the aggregate")
	}
}

func TestCloneCarriesIndependentStateAndVersion(t *testing.T) {
	u, _, _ := user.Register("u1", address, storedHash(t, "01"), now)
	u.Version = 7
	clone := u.Clone()
	clone.ID = "changed"
	if u.ID == clone.ID || clone.Version != 7 {
		t.Fatalf("original=%+v clone=%+v", u, clone)
	}
}

func TestCloneOfNil(t *testing.T) {
	var u *user.User
	if u.Clone() != nil {
		t.Fatal("cloning nil should return nil")
	}
}
