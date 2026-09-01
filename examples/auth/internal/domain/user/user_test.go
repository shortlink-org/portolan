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

func TestChangePassword(t *testing.T) {
	u, _, err := user.Register("u1", address, plaintext, now)
	if err != nil {
		t.Fatal(err)
	}

	const next = "NewPassw0rd"
	ev, err := u.ChangePassword(plaintext, next, "s1", now)
	if err != nil {
		t.Fatal(err)
	}

	if u.Password.Matches(plaintext) {
		t.Error("the old password still works")
	}
	if !u.Password.Matches(next) {
		t.Error("the new password does not")
	}
	if ev.UserID() != "u1" || ev.By() != "s1" || !ev.OccurredAt().Equal(now) {
		t.Errorf("event = %+v, want it to name the user, the actor and the time", ev)
	}
	if ev.Name() != "auth.PasswordChanged" {
		t.Errorf("name = %q", ev.Name())
	}
}

// The current password is required even though the caller got this far.
// Without it a stolen session is a stolen account.
func TestChangePasswordNeedsTheCurrentOne(t *testing.T) {
	u, _, err := user.Register("u1", address, plaintext, now)
	if err != nil {
		t.Fatal(err)
	}

	_, err = u.ChangePassword("Wr0ngGuess", "NewPassw0rd", "s1", now)
	if !errors.Is(err, user.ErrInvalidCredentials) {
		t.Fatalf("= %v, want ErrInvalidCredentials", err)
	}
	if !u.Password.Matches(plaintext) {
		t.Error("a refused change altered the password anyway")
	}
}

// A refusal leaves the aggregate exactly as it was, event included.
func TestChangePasswordRefusesAWeakNewOne(t *testing.T) {
	u, _, err := user.Register("u1", address, plaintext, now)
	if err != nil {
		t.Fatal(err)
	}

	ev, err := u.ChangePassword(plaintext, "abc", "s1", now)
	if !errors.Is(err, password.ErrInvalid) {
		t.Fatalf("= %v, want the password policy", err)
	}
	if ev.UserID() != "" {
		t.Error("a refused change produced an event")
	}
	if !u.Password.Matches(plaintext) {
		t.Error("a refused change altered the password anyway")
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

// A clone is as fresh, or as stale, as what it was taken from. A copy that lost
// its version would look unsaved and would overwrite whatever it landed on.
func TestCloneCarriesTheVersion(t *testing.T) {
	u, _, err := user.Register("u1", address, plaintext, now)
	if err != nil {
		t.Fatal(err)
	}
	u.Version = 7

	if got := u.Clone().Version; got != 7 {
		t.Errorf("clone is at version %d, want 7", got)
	}
}

func TestNewUserIsUnsaved(t *testing.T) {
	u, _, err := user.Register("u1", address, plaintext, now)
	if err != nil {
		t.Fatal(err)
	}
	if u.Version != 0 {
		t.Errorf("a fresh user is at version %d, want 0 - it has never been stored", u.Version)
	}
}

func TestCloneOfNil(t *testing.T) {
	var u *user.User
	if u.Clone() != nil {
		t.Error("cloning nothing should give nothing")
	}
}
