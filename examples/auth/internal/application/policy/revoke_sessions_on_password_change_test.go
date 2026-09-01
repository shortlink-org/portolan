package policy_test

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/shortlink-org/portolan/examples/auth/internal/application/policy"
	"github.com/shortlink-org/portolan/examples/auth/internal/application/session/usecases/end_after_credential_change"
	"github.com/shortlink-org/portolan/examples/auth/internal/domain/session"
	sessionevent "github.com/shortlink-org/portolan/examples/auth/internal/domain/session/event"
	userevent "github.com/shortlink-org/portolan/examples/auth/internal/domain/user/event"
	bus "github.com/shortlink-org/portolan/examples/auth/internal/infrastructure/bus/session"
	repo "github.com/shortlink-org/portolan/examples/auth/internal/infrastructure/repository/session"
	"github.com/shortlink-org/portolan/examples/auth/internal/pkg/postgrestest"
)

var change = time.Date(2026, 3, 1, 12, 0, 0, 0, time.UTC)

func TestMain(m *testing.M) {
	code := m.Run()
	postgrestest.Stop()
	os.Exit(code)
}

type harness struct {
	policy *policy.RevokeSessionsOnPasswordChange
	store  *repo.Postgres
	events []sessionevent.Event
}

func newHarness(t *testing.T, sessions map[string]time.Time) *harness {
	t.Helper()
	h := &harness{}
	ctx := context.Background()

	b := bus.NewInProc()
	b.Subscribe("", func(_ context.Context, e sessionevent.Event) error {
		h.events = append(h.events, e)
		return nil
	})
	router, unit := postgrestest.Store(t, postgrestest.Source{FS: repo.Migrations, Name: repo.Name})
	h.store = repo.NewPostgres(router, unit, b)

	for id, issued := range sessions {
		s, _, err := session.Start(id, "u1", issued)
		if err != nil {
			t.Fatal(err)
		}
		if err := h.store.Save(ctx, s); err != nil {
			t.Fatal(err)
		}
	}
	// Starting the sessions is the setup; the events these tests are about are
	// the ones the policy causes.
	h.events = nil

	h.policy = policy.New(end_after_credential_change.New(h.store, func() time.Time { return change }))
	return h
}

func (h *harness) live(t *testing.T, id string) bool {
	t.Helper()
	s, err := h.store.ByID(context.Background(), id)
	if err != nil {
		t.Fatal(err)
	}
	return s.Live(change)
}

func TestPasswordChangeEndsTheOtherSessions(t *testing.T) {
	h := newHarness(t, map[string]time.Time{
		"laptop": change.Add(-time.Hour),
		"phone":  change.Add(-time.Hour),
		"tablet": change.Add(-time.Hour),
	})

	// Changed from the laptop.
	err := h.policy.Handle(context.Background(),
		userevent.NewPasswordChanged("u1", "laptop", change))
	if err != nil {
		t.Fatal(err)
	}

	if !h.live(t, "laptop") {
		t.Error("the device the change was made from should stay signed in")
	}
	if h.live(t, "phone") || h.live(t, "tablet") {
		t.Error("the other devices should have been signed out")
	}

	if len(h.events) != 2 {
		t.Fatalf("%d events, want one per session ended", len(h.events))
	}
	for _, e := range h.events {
		ended, ok := e.(sessionevent.SessionEnded)
		if !ok {
			t.Fatalf("event = %T, want SessionEnded", e)
		}
		// The reason exists so a client can say "you were signed out because
		// the password changed" instead of the lie "your session expired".
		if ended.Reason() != sessionevent.ReasonPasswordChanged {
			t.Errorf("reason = %q, want %q", ended.Reason(), sessionevent.ReasonPasswordChanged)
		}
	}
}

// An administrative reset carries no actor, so nothing is spared.
func TestResetEndsEverything(t *testing.T) {
	h := newHarness(t, map[string]time.Time{
		"laptop": change.Add(-time.Hour),
		"phone":  change.Add(-time.Hour),
	})

	if err := h.policy.Handle(context.Background(), userevent.NewPasswordChanged("u1", "", change)); err != nil {
		t.Fatal(err)
	}
	if h.live(t, "laptop") || h.live(t, "phone") {
		t.Error("a reset spares nothing")
	}
}

// Redelivery happens. The second run must find nothing left to do and must not
// announce anything, which works because Revoke is idempotent.
func TestHandlingTheSameEventTwice(t *testing.T) {
	h := newHarness(t, map[string]time.Time{"phone": change.Add(-time.Hour)})
	e := userevent.NewPasswordChanged("u1", "laptop", change)
	ctx := context.Background()

	if err := h.policy.Handle(ctx, e); err != nil {
		t.Fatal(err)
	}
	if err := h.policy.Handle(ctx, e); err != nil {
		t.Fatalf("the second delivery = %v, want no error", err)
	}
	if len(h.events) != 1 {
		t.Errorf("%d events, want exactly one", len(h.events))
	}
}

// Anything else on the bus is not this policy's business.
func TestOtherEventsAreIgnored(t *testing.T) {
	h := newHarness(t, map[string]time.Time{"phone": change.Add(-time.Hour)})

	err := h.policy.Handle(context.Background(),
		userevent.NewUserRegistered("u1", "ada@example.com", change))
	if err != nil {
		t.Fatal(err)
	}
	if !h.live(t, "phone") {
		t.Error("a registration should not sign anybody out")
	}
	if len(h.events) != 0 {
		t.Errorf("%d events, want none", len(h.events))
	}
}

func TestUserWithNoSessions(t *testing.T) {
	h := newHarness(t, nil)
	if err := h.policy.Handle(context.Background(), userevent.NewPasswordChanged("u1", "", change)); err != nil {
		t.Fatalf("= %v, want no error", err)
	}
}
