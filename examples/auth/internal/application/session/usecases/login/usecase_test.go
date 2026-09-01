package login_test

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/shortlink-org/portolan/examples/auth/internal/application/session/usecases/login"
	"github.com/shortlink-org/portolan/examples/auth/internal/application/session/usecases/login/dto"
	"github.com/shortlink-org/portolan/examples/auth/internal/domain/session"
	"github.com/shortlink-org/portolan/examples/auth/internal/domain/session/event"
	"github.com/shortlink-org/portolan/examples/auth/internal/domain/session/vo/token"
	"github.com/shortlink-org/portolan/examples/auth/internal/domain/user"
	bus "github.com/shortlink-org/portolan/examples/auth/internal/infrastructure/bus/session"
	repo "github.com/shortlink-org/portolan/examples/auth/internal/infrastructure/repository/session"
	"github.com/shortlink-org/portolan/examples/auth/internal/infrastructure/storage/postgrestest"
)

var now = time.Date(2026, 3, 1, 12, 0, 0, 0, time.UTC)

// authFunc is the port login declares, satisfied inline. The real
// implementation is the user domain's authenticate use case, adapted at wiring
// time; nothing here needs to know that.
type authFunc func(ctx context.Context, email, password string) (string, error)

func (f authFunc) Authenticate(ctx context.Context, email, password string) (string, error) {
	return f(ctx, email, password)
}

func TestMain(m *testing.M) {
	code := m.Run()
	postgrestest.Stop()
	os.Exit(code)
}

type harness struct {
	uc     *login.UseCase
	store  *repo.Postgres
	events []event.Event
}

func newHarness(t *testing.T, auth login.Authenticator) *harness {
	t.Helper()
	h := &harness{}

	b := bus.NewInProc()
	b.Subscribe("", func(_ context.Context, e event.Event) error {
		h.events = append(h.events, e)
		return nil
	})
	router, unit := postgrestest.Store(t, postgrestest.Source{FS: repo.Migrations, Name: repo.Name})
	h.store = repo.NewPostgres(router, unit, b)

	h.uc = login.New(h.store, auth, func() time.Time { return now }, func() string { return "s1" })
	return h
}

func vouches(userID string) login.Authenticator {
	return authFunc(func(context.Context, string, string) (string, error) { return userID, nil })
}

func refuses() login.Authenticator {
	return authFunc(func(context.Context, string, string) (string, error) {
		return "", user.ErrInvalidCredentials
	})
}

func TestLogin(t *testing.T) {
	ctx := context.Background()
	h := newHarness(t, vouches("u1"))

	out, err := h.uc.Handle(ctx, dto.Input{Email: "ada@example.com", Password: "Passw0rdish"})
	if err != nil {
		t.Fatal(err)
	}

	if want := now.Add(session.TTL); !out.ExpiresAt.Equal(want) {
		t.Errorf("expiresAt = %v, want %v", out.ExpiresAt, want)
	}

	presented, err := token.Parse(out.Token)
	if err != nil {
		t.Fatalf("the token handed to a client should parse: %v", err)
	}
	stored, err := h.store.ByToken(ctx, presented)
	if err != nil {
		t.Fatalf("the session should be in the store: %v", err)
	}
	if stored.UserID != "u1" {
		t.Errorf("userID = %q, want the id the authenticator vouched for", stored.UserID)
	}
	if len(h.events) != 1 || h.events[0].Name() != "auth.SessionStarted" {
		t.Errorf("events = %v, want one SessionStarted", h.events)
	}
}

// The rule this use case exists to enforce: no session for a user the user
// domain did not vouch for.
func TestNoSessionWithoutTheAuthenticator(t *testing.T) {
	ctx := context.Background()
	h := newHarness(t, refuses())

	out, err := h.uc.Handle(ctx, dto.Input{Email: "ada@example.com", Password: "wrong"})
	if !errors.Is(err, user.ErrInvalidCredentials) {
		t.Fatalf("= %v, want the authenticator's error untouched", err)
	}
	if out.Token != "" {
		t.Error("a refused login handed out a token")
	}
	if len(h.events) != 0 {
		t.Errorf("%d events, want a refused login to announce nothing", len(h.events))
	}
}

// The failure is passed through rather than translated. Translating it here is
// the one way to accidentally make a wrong password distinguishable from an
// unknown address.
func TestAuthenticatorFailureIsNotRewritten(t *testing.T) {
	ctx := context.Background()
	boom := errors.New("the identity store is down")
	h := newHarness(t, authFunc(func(context.Context, string, string) (string, error) {
		return "", boom
	}))

	if _, err := h.uc.Handle(ctx, dto.Input{Email: "a@b.co", Password: "x"}); !errors.Is(err, boom) {
		t.Fatalf("= %v, want %v", err, boom)
	}
}

// Two logins are two sessions. Reusing one would mean logging out on one device
// logged you out everywhere.
func TestEachLoginIsItsOwnSession(t *testing.T) {
	ctx := context.Background()
	router, unit := postgrestest.Store(t, postgrestest.Source{FS: repo.Migrations, Name: repo.Name})
	store := repo.NewPostgres(router, unit, bus.NewInProc())

	ids := 0
	uc := login.New(store, vouches("u1"), func() time.Time { return now }, func() string {
		ids++
		return "s" + string(rune('0'+ids))
	})

	first, err := uc.Handle(ctx, dto.Input{Email: "ada@example.com", Password: "Passw0rdish"})
	if err != nil {
		t.Fatal(err)
	}
	second, err := uc.Handle(ctx, dto.Input{Email: "ada@example.com", Password: "Passw0rdish"})
	if err != nil {
		t.Fatal(err)
	}
	if first.Token == second.Token {
		t.Fatal("two logins shared a token")
	}
}
