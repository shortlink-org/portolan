package register_test

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/shortlink-org/portolan/examples/auth/internal/application/user/usecases/register"
	"github.com/shortlink-org/portolan/examples/auth/internal/application/user/usecases/register/dto"
	"github.com/shortlink-org/portolan/examples/auth/internal/domain/user"
	"github.com/shortlink-org/portolan/examples/auth/internal/domain/user/event"
	"github.com/shortlink-org/portolan/examples/auth/internal/domain/user/vo/email"
	"github.com/shortlink-org/portolan/examples/auth/internal/domain/user/vo/password"
	bus "github.com/shortlink-org/portolan/examples/auth/internal/infrastructure/bus/user"
	repo "github.com/shortlink-org/portolan/examples/auth/internal/infrastructure/repository/user"
	"github.com/shortlink-org/portolan/examples/auth/internal/infrastructure/storage/postgrestest"
)

var now = time.Date(2026, 3, 1, 12, 0, 0, 0, time.UTC)

const (
	address   = "Ada@Example.com"
	plaintext = "Passw0rdish"
)

func TestMain(m *testing.M) {
	code := m.Run()
	postgrestest.Stop()
	os.Exit(code)
}

type harness struct {
	uc     *register.UseCase
	store  *repo.Postgres
	events []event.Event
}

// The use case runs against a real database and a real bus. There are no
// doubles here at all: what is being checked is the sequence of a scenario, and
// a scenario that only holds against a fake is not evidence of anything.
func newHarness(t *testing.T) *harness {
	t.Helper()
	h := &harness{}

	b := bus.NewInProc()
	b.Subscribe("", func(_ context.Context, e event.Event) error {
		h.events = append(h.events, e)
		return nil
	})
	router, unit := postgrestest.Store(t, postgrestest.Source{FS: repo.Migrations, Name: repo.Name})
	h.store = repo.NewPostgres(router, unit, b)

	ids := 0
	h.uc = register.New(h.store, func() time.Time { return now }, func() string {
		ids++
		return "u" + string(rune('0'+ids))
	})
	return h
}

func TestRegister(t *testing.T) {
	ctx := context.Background()
	h := newHarness(t)

	out, err := h.uc.Handle(ctx, dto.Input{Email: address, Password: plaintext})
	if err != nil {
		t.Fatal(err)
	}

	if out.Email != "ada@example.com" {
		t.Errorf("email = %q, want it normalised", out.Email)
	}
	if !out.CreatedAt.Equal(now) {
		t.Errorf("createdAt = %v, want the injected clock %v", out.CreatedAt, now)
	}

	stored, err := h.store.ByID(ctx, out.UserID)
	if err != nil {
		t.Fatalf("the user should be in the store: %v", err)
	}
	if !stored.Password.Matches(plaintext) {
		t.Error("the stored hash should verify the password")
	}
	if len(h.events) != 1 || h.events[0].Name() != "auth.UserRegistered" {
		t.Errorf("events = %v, want one UserRegistered", h.events)
	}
}

// A second registration is refused rather than quietly returning the first
// user: the caller asked to create something, and it did not happen.
func TestSecondRegistrationIsRefused(t *testing.T) {
	ctx := context.Background()
	h := newHarness(t)

	if _, err := h.uc.Handle(ctx, dto.Input{Email: address, Password: plaintext}); err != nil {
		t.Fatal(err)
	}
	_, err := h.uc.Handle(ctx, dto.Input{Email: "ADA@example.com", Password: plaintext})
	if !errors.Is(err, user.ErrEmailTaken) {
		t.Fatalf("= %v, want ErrEmailTaken", err)
	}
	if len(h.events) != 1 {
		t.Errorf("%d events, want the refused attempt to publish nothing", len(h.events))
	}
}

// Nothing is written and nothing is announced when the values are refused.
func TestInvalidInputWritesNothing(t *testing.T) {
	ctx := context.Background()

	cases := map[string]struct {
		in   dto.Input
		want error
	}{
		"bad address":  {dto.Input{Email: "nope", Password: plaintext}, email.ErrInvalid},
		"bad password": {dto.Input{Email: address, Password: "abc"}, password.ErrInvalid},
	}
	for name, c := range cases {
		t.Run(name, func(t *testing.T) {
			h := newHarness(t)
			if _, err := h.uc.Handle(ctx, c.in); !errors.Is(err, c.want) {
				t.Fatalf("= %v, want %v", err, c.want)
			}
			if len(h.events) != 0 {
				t.Errorf("%d events were published for a refused registration", len(h.events))
			}
			if _, err := h.store.ByEmail(ctx, address); !errors.Is(err, user.ErrNotFound) {
				t.Error("nothing should have been written")
			}
		})
	}
}
