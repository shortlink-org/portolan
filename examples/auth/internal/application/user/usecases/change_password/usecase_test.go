package change_password_test

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/shortlink-org/portolan/examples/auth/internal/application/user/usecases/change_password"
	"github.com/shortlink-org/portolan/examples/auth/internal/application/user/usecases/change_password/dto"
	"github.com/shortlink-org/portolan/examples/auth/internal/domain/user"
	"github.com/shortlink-org/portolan/examples/auth/internal/domain/user/event"
	"github.com/shortlink-org/portolan/examples/auth/internal/domain/user/vo/password"
	bus "github.com/shortlink-org/portolan/examples/auth/internal/infrastructure/bus/user"
	repo "github.com/shortlink-org/portolan/examples/auth/internal/infrastructure/repository/user"
	"github.com/shortlink-org/portolan/examples/auth/internal/pkg/postgrestest"
)

var now = time.Date(2026, 3, 1, 12, 0, 0, 0, time.UTC)

const (
	address = "ada@example.com"
	current = "Passw0rdish"
	next    = "NewPassw0rd"
)

func TestMain(m *testing.M) {
	code := m.Run()
	postgrestest.Stop()
	os.Exit(code)
}

type harness struct {
	uc     *change_password.UseCase
	store  *repo.Postgres
	events []event.Event
}

func newHarness(t *testing.T) *harness {
	t.Helper()
	h := &harness{}
	ctx := context.Background()

	b := bus.NewInProc()
	b.Subscribe("", func(_ context.Context, e event.Event) error {
		h.events = append(h.events, e)
		return nil
	})
	router, unit := postgrestest.Store(t, postgrestest.Source{FS: repo.Migrations, Name: repo.Name})
	h.store = repo.NewPostgres(router, unit, b)

	u, _, err := user.Register("u1", address, current, now)
	if err != nil {
		t.Fatal(err)
	}
	if err := h.store.Save(ctx, u); err != nil {
		t.Fatal(err)
	}
	// The registration event is not what these tests are about.
	h.events = nil

	h.uc = change_password.New(h.store, func() time.Time { return now })
	return h
}

func TestChangePassword(t *testing.T) {
	ctx := context.Background()
	h := newHarness(t)

	err := h.uc.Handle(ctx, dto.Input{UserID: "u1", By: "s1", Current: current, New: next})
	if err != nil {
		t.Fatal(err)
	}

	stored, err := h.store.ByID(ctx, "u1")
	if err != nil {
		t.Fatal(err)
	}
	if stored.Password.Matches(current) {
		t.Error("the old password still works")
	}
	if !stored.Password.Matches(next) {
		t.Error("the new password does not")
	}

	if len(h.events) != 1 {
		t.Fatalf("%d events, want one PasswordChanged", len(h.events))
	}
	changed, ok := h.events[0].(event.PasswordChanged)
	if !ok {
		t.Fatalf("event = %T", h.events[0])
	}
	// The actor travels on the event; it is the only way the session side can
	// learn which session to spare without this package knowing sessions exist.
	if changed.By() != "s1" {
		t.Errorf("by = %q, want the session it was changed from", changed.By())
	}
}

// The password must not change, and nothing must be announced, when the change
// is refused. A published PasswordChanged would sign the user out of every
// device over a password that never changed.
func TestRefusalWritesNothingAndAnnouncesNothing(t *testing.T) {
	ctx := context.Background()

	cases := map[string]struct {
		in   dto.Input
		want error
	}{
		"wrong current": {
			dto.Input{UserID: "u1", Current: "Wr0ngGuess", New: next},
			user.ErrInvalidCredentials,
		},
		"weak new": {
			dto.Input{UserID: "u1", Current: current, New: "abc"},
			password.ErrInvalid,
		},
	}
	for name, c := range cases {
		t.Run(name, func(t *testing.T) {
			h := newHarness(t)
			if err := h.uc.Handle(ctx, c.in); !errors.Is(err, c.want) {
				t.Fatalf("= %v, want %v", err, c.want)
			}
			stored, _ := h.store.ByID(ctx, "u1")
			if !stored.Password.Matches(current) {
				t.Error("a refused change altered the password")
			}
			if len(h.events) != 0 {
				t.Errorf("%d events published for a refused change", len(h.events))
			}
		})
	}
}

// A wrong current password answers exactly as a failed login does, so this
// endpoint is not a cheaper way to test guesses than the front door.
func TestWrongCurrentLooksLikeAFailedLogin(t *testing.T) {
	h := newHarness(t)
	err := h.uc.Handle(context.Background(), dto.Input{UserID: "u1", Current: "Wr0ngGuess", New: next})

	if err.Error() != user.ErrInvalidCredentials.Error() {
		t.Errorf("= %q, want nothing beyond the refusal", err)
	}
}

func TestUnknownUser(t *testing.T) {
	h := newHarness(t)
	err := h.uc.Handle(context.Background(), dto.Input{UserID: "nobody", Current: current, New: next})
	if !errors.Is(err, user.ErrNotFound) {
		t.Fatalf("= %v, want ErrNotFound", err)
	}
}
