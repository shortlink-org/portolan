package authenticate_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/shortlink-org/portolan/examples/auth/internal/application/user/usecases/authenticate"
	"github.com/shortlink-org/portolan/examples/auth/internal/application/user/usecases/authenticate/dto"
	"github.com/shortlink-org/portolan/examples/auth/internal/domain/user"
	repo "github.com/shortlink-org/portolan/examples/auth/internal/infrastructure/repository/user"
)

const (
	address   = "ada@example.com"
	plaintext = "Passw0rdish"
)

func newUseCase(t *testing.T) *authenticate.UseCase {
	t.Helper()
	store := repo.NewMemory()
	u, _, err := user.Register("u1", address, plaintext, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Save(context.Background(), u); err != nil {
		t.Fatal(err)
	}
	return authenticate.New(store)
}

func TestAuthenticate(t *testing.T) {
	out, err := newUseCase(t).Handle(context.Background(), dto.Input{Email: "  ADA@Example.com ", Password: plaintext})
	if err != nil {
		t.Fatal(err)
	}
	if out.UserID != "u1" {
		t.Errorf("userID = %q, want u1", out.UserID)
	}
}

// The reason this use case exists in one piece: an unknown address, a wrong
// password and a malformed address are answered identically, so nothing about
// which addresses are registered can be read out of the reply.
func TestEveryFailureLooksTheSame(t *testing.T) {
	uc := newUseCase(t)
	ctx := context.Background()

	cases := map[string]dto.Input{
		"unknown address":   {Email: "nobody@example.com", Password: plaintext},
		"wrong password":    {Email: address, Password: "Wr0ngGuess"},
		"malformed address": {Email: "nope", Password: plaintext},
		"empty password":    {Email: address, Password: ""},
		"password policy":   {Email: address, Password: "abc"},
	}
	for name, in := range cases {
		t.Run(name, func(t *testing.T) {
			out, err := uc.Handle(ctx, in)
			if !errors.Is(err, user.ErrInvalidCredentials) {
				t.Fatalf("= %v, want ErrInvalidCredentials", err)
			}
			if out.UserID != "" {
				t.Errorf("a failure returned a user id: %q", out.UserID)
			}
		})
	}
}

// A password that today's policy would refuse is still checked, not rejected.
// Otherwise raising the minimum would lock out everyone who registered before.
func TestPolicyIsNotAppliedOnTheWayIn(t *testing.T) {
	uc := newUseCase(t)
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
