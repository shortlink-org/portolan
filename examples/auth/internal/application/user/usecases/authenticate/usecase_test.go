package authenticate_test

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/shortlink-org/portolan/examples/auth/internal/application/user/usecases/authenticate"
	"github.com/shortlink-org/portolan/examples/auth/internal/application/user/usecases/authenticate/dto"
	"github.com/shortlink-org/portolan/examples/auth/internal/domain/user"
	repo "github.com/shortlink-org/portolan/examples/auth/internal/infrastructure/repository/user"
	"github.com/shortlink-org/portolan/examples/auth/internal/pkg/postgrestest"
)

const (
	address   = "ada@example.com"
	plaintext = "Passw0rdish"
)

func TestMain(m *testing.M) {
	code := m.Run()
	postgrestest.Stop()
	os.Exit(code)
}

// lockout is the port authenticate declares, satisfied in memory. It records
// what it was told, which is what the tests below are about.
type lockout struct {
	allowed   bool
	err       error
	failed    []string
	succeeded []string
}

func (l *lockout) Allowed(context.Context, string) (bool, error) { return l.allowed, l.err }
func (l *lockout) Failed(_ context.Context, id string) error {
	l.failed = append(l.failed, id)
	return l.err
}
func (l *lockout) Succeeded(_ context.Context, id string) error {
	l.succeeded = append(l.succeeded, id)
	return l.err
}

func open() *lockout   { return &lockout{allowed: true} }
func locked() *lockout { return &lockout{allowed: false} }

func newUseCase(t *testing.T, l authenticate.Lockout) *authenticate.UseCase {
	t.Helper()
	router, unit := postgrestest.Store(t, postgrestest.Source{FS: repo.Migrations, Name: repo.Name})
	store := repo.NewPostgres(router, unit, nil)
	u, _, err := user.Register("u1", address, plaintext, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Save(context.Background(), u); err != nil {
		t.Fatal(err)
	}
	return authenticate.New(store, l)
}

func TestAuthenticate(t *testing.T) {
	l := open()
	out, err := newUseCase(t, l).Handle(context.Background(), dto.Input{Email: "  ADA@Example.com ", Password: plaintext})
	if err != nil {
		t.Fatal(err)
	}
	if out.UserID != "u1" {
		t.Errorf("userID = %q, want u1", out.UserID)
	}
	if len(l.succeeded) != 1 || l.succeeded[0] != "u1" {
		t.Errorf("succeeded = %v, want the lockout told once about u1", l.succeeded)
	}
	if len(l.failed) != 0 {
		t.Errorf("failed = %v, want nothing counted for a right password", l.failed)
	}
}

// The reason this use case exists in one piece: an unknown address, a wrong
// password, a malformed address and a locked account are answered identically,
// so nothing about which addresses are registered, or locked, can be read out
// of the reply.
func TestEveryFailureLooksTheSame(t *testing.T) {
	ctx := context.Background()

	cases := map[string]struct {
		in dto.Input
		l  *lockout
	}{
		"unknown address":   {dto.Input{Email: "nobody@example.com", Password: plaintext}, open()},
		"wrong password":    {dto.Input{Email: address, Password: "Wr0ngGuess"}, open()},
		"malformed address": {dto.Input{Email: "nope", Password: plaintext}, open()},
		"empty password":    {dto.Input{Email: address, Password: ""}, open()},
		"password policy":   {dto.Input{Email: address, Password: "abc"}, open()},
		"locked account":    {dto.Input{Email: address, Password: plaintext}, locked()},
	}
	for name, c := range cases {
		t.Run(name, func(t *testing.T) {
			out, err := newUseCase(t, c.l).Handle(ctx, c.in)
			if !errors.Is(err, user.ErrInvalidCredentials) {
				t.Fatalf("= %v, want ErrInvalidCredentials", err)
			}
			if err.Error() != user.ErrInvalidCredentials.Error() {
				t.Errorf("= %q, want nothing beyond the refusal", err)
			}
			if out.UserID != "" {
				t.Errorf("a failure returned a user id: %q", out.UserID)
			}
		})
	}
}

// A wrong password is counted; the account it was counted against is the one
// the address resolved to.
func TestAWrongPasswordIsCounted(t *testing.T) {
	l := open()
	_, err := newUseCase(t, l).Handle(context.Background(), dto.Input{Email: address, Password: "Wr0ngGuess"})
	if !errors.Is(err, user.ErrInvalidCredentials) {
		t.Fatalf("= %v, want the refusal", err)
	}
	if len(l.failed) != 1 || l.failed[0] != "u1" {
		t.Errorf("failed = %v, want one failure against u1", l.failed)
	}
	if len(l.succeeded) != 0 {
		t.Errorf("succeeded = %v, want nothing", l.succeeded)
	}
}

// A locked account has nothing checked and nothing counted: the refusal comes
// before the password is looked at, even when the password is right.
func TestALockedAccountIsRefusedUnchecked(t *testing.T) {
	l := locked()
	_, err := newUseCase(t, l).Handle(context.Background(), dto.Input{Email: address, Password: plaintext})
	if !errors.Is(err, user.ErrInvalidCredentials) {
		t.Fatalf("= %v, want the refusal", err)
	}
	if len(l.failed)+len(l.succeeded) != 0 {
		t.Errorf("failed = %v, succeeded = %v; a locked account should not be reported on", l.failed, l.succeeded)
	}
}

// An unknown address has no account to count against. Counting by address
// would let anybody lock anybody by typing their address with junk.
func TestAnUnknownAddressCountsForNothing(t *testing.T) {
	l := open()
	_, err := newUseCase(t, l).Handle(context.Background(), dto.Input{Email: "nobody@example.com", Password: "Wr0ngGuess"})
	if !errors.Is(err, user.ErrInvalidCredentials) {
		t.Fatalf("= %v, want the refusal", err)
	}
	if len(l.failed) != 0 {
		t.Errorf("failed = %v, want nothing counted for an address that is not registered", l.failed)
	}
}

// A lockout store that is down is an error, not an answer. "Allowed" would be
// unlimited guessing again; the refusal would hide that counting has stopped.
func TestAnUnreachableLockoutStopsTheCheck(t *testing.T) {
	down := errors.New("lockout store is down")
	l := &lockout{allowed: true, err: down}
	_, err := newUseCase(t, l).Handle(context.Background(), dto.Input{Email: address, Password: plaintext})
	if !errors.Is(err, down) {
		t.Fatalf("= %v, want the store's error passed through", err)
	}
}

// A password that today's policy would refuse is still checked, not rejected.
// Otherwise raising the minimum would lock out everyone who registered before.
func TestPolicyIsNotAppliedOnTheWayIn(t *testing.T) {
	uc := newUseCase(t, open())
	_, err := uc.Handle(context.Background(), dto.Input{Email: address, Password: "abc"})
	if !errors.Is(err, user.ErrInvalidCredentials) {
		t.Fatalf("= %v, want the plain credential refusal", err)
	}
	// It must not surface as a validation failure, which a transport would turn
	// into a 400 and thereby leak the policy.
	if err.Error() != user.ErrInvalidCredentials.Error() {
		t.Errorf("= %q, want nothing beyond the refusal", err)
	}
}
