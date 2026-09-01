package user_test

import (
	"errors"
	"testing"
	"time"

	"github.com/shortlink-org/portolan/examples/auth/internal/domain/user"
	"github.com/shortlink-org/portolan/examples/auth/internal/domain/user/vo/email"
	"github.com/shortlink-org/portolan/examples/auth/internal/domain/user/vo/password"
)

const (
	plaintext = "Passw0rdish"
	address   = "Ada@Example.com"
)

var now = time.Date(2026, 3, 1, 12, 0, 0, 0, time.UTC)

func TestRegister(t *testing.T) {
	u, ev, err := user.Register("u1", address, plaintext, now)
	if err != nil {
		t.Fatal(err)
	}

	if u.ID != "u1" {
		t.Errorf("id = %q, want u1", u.ID)
	}
	if u.Email.String() != "ada@example.com" {
		t.Errorf("email = %q, want it normalised", u.Email)
	}
	if !u.CreatedAt.Equal(now) {
		t.Errorf("createdAt = %v, want %v", u.CreatedAt, now)
	}

	// The event is returned, not buffered: what happened is in the signature.
	if ev.UserID() != "u1" || ev.Email() != "ada@example.com" {
		t.Errorf("event = %+v, want it to describe the user", ev)
	}
	if !ev.OccurredAt().Equal(now) {
		t.Errorf("occurredAt = %v, want the domain time %v", ev.OccurredAt(), now)
	}
	if ev.Name() != "auth.UserRegistered" {
		t.Errorf("name = %q; renaming it breaks every consumer", ev.Name())
	}
}

// The plaintext must not survive anywhere on the aggregate.
func TestRegisterStoresNoPlaintext(t *testing.T) {
	u, _, err := user.Register("u1", address, plaintext, now)
	if err != nil {
		t.Fatal(err)
	}
	if got := u.Password.String(); got == plaintext {
		t.Fatal("the password was stored as typed")
	}
	if !u.Password.Matches(plaintext) {
		t.Error("the stored hash should still verify the password")
	}
}

func TestRegisterRefusesBadValues(t *testing.T) {
	if _, _, err := user.Register("u1", "nope", plaintext, now); !errors.Is(err, email.ErrInvalid) {
		t.Errorf("a bad address should be refused by the email policy, got %v", err)
	}
	if _, _, err := user.Register("u1", address, "abc", now); !errors.Is(err, password.ErrInvalid) {
		t.Errorf("a bad password should be refused by the password policy, got %v", err)
	}
}

func TestAuthenticate(t *testing.T) {
	u, _, err := user.Register("u1", address, plaintext, now)
	if err != nil {
		t.Fatal(err)
	}
	if err := u.Authenticate(plaintext); err != nil {
		t.Errorf("the right password should authenticate: %v", err)
	}
	if err := u.Authenticate("Wr0ngGuess"); !errors.Is(err, user.ErrInvalidCredentials) {
		t.Errorf("a wrong password = %v, want ErrInvalidCredentials", err)
	}
	// One error for every failure. A caller cannot learn anything from which
	// one it got, because there is only one.
	if err := u.Authenticate(""); !errors.Is(err, user.ErrInvalidCredentials) {
		t.Errorf("an empty password = %v, want ErrInvalidCredentials", err)
	}
}

// The repositories rely on this: what they hand out must share nothing a caller
// can change under them.
func TestCloneSharesNothingMutable(t *testing.T) {
	u, _, err := user.Register("u1", address, plaintext, now)
	if err != nil {
		t.Fatal(err)
	}
	clone := u.Clone()

	if clone == u {
		t.Fatal("Clone returned the same pointer")
	}
	clone.ID = "changed"
	if u.ID == "changed" {
		t.Error("changing the clone changed the original")
	}
	if !clone.Password.Matches(plaintext) {
		t.Error("the clone should carry a working hash")
	}
}

func TestCloneOfNil(t *testing.T) {
	var u *user.User
	if u.Clone() != nil {
		t.Error("cloning nothing should give nothing")
	}
}
