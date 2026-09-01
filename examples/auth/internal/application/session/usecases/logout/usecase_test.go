package logout_test

import (
	"context"
	"testing"
	"time"

	"github.com/shortlink-org/portolan/examples/auth/internal/application/session/usecases/logout"
	"github.com/shortlink-org/portolan/examples/auth/internal/application/session/usecases/logout/dto"
	"github.com/shortlink-org/portolan/examples/auth/internal/domain/session"
	"github.com/shortlink-org/portolan/examples/auth/internal/domain/session/event"
	bus "github.com/shortlink-org/portolan/examples/auth/internal/infrastructure/bus/session"
	repo "github.com/shortlink-org/portolan/examples/auth/internal/infrastructure/repository/session"
)

var now = time.Date(2026, 3, 1, 12, 0, 0, 0, time.UTC)

type harness struct {
	uc      *logout.UseCase
	store   *repo.Memory
	session *session.Session
	events  []event.Event
}

func newHarness(t *testing.T) *harness {
	t.Helper()
	h := &harness{store: repo.NewMemory()}

	s, _, err := session.Start("s1", "u1", now)
	if err != nil {
		t.Fatal(err)
	}
	if err := h.store.Save(context.Background(), s); err != nil {
		t.Fatal(err)
	}
	h.session = s

	b := bus.NewInProc()
	b.Subscribe("", func(_ context.Context, e event.Event) error {
		h.events = append(h.events, e)
		return nil
	})

	h.uc = logout.New(h.store, b, func() time.Time { return now })
	return h
}

func TestLogout(t *testing.T) {
	ctx := context.Background()
	h := newHarness(t)

	if err := h.uc.Handle(ctx, dto.Input{Token: h.session.Token.String()}); err != nil {
		t.Fatal(err)
	}

	stored, err := h.store.ByID(ctx, "s1")
	if err != nil {
		t.Fatal(err)
	}
	if err := stored.Validate(now); err != session.ErrRevoked {
		t.Errorf("the session should be revoked, got %v", err)
	}
	if len(h.events) != 1 || h.events[0].Name() != "auth.SessionEnded" {
		t.Errorf("events = %v, want one SessionEnded", h.events)
	}
}

// A token that is unknown or malformed is not an error. The caller asked for
// there to be no session, and there is none; failing would say which tokens
// exist and would break a client's retry after a timeout.
func TestUnknownTokensSucceedSilently(t *testing.T) {
	ctx := context.Background()

	cases := map[string]string{
		"empty":     "",
		"malformed": "....",
		"unknown":   "0123456789abcdef0123456789abcdef0123456789a",
	}
	for name, raw := range cases {
		t.Run(name, func(t *testing.T) {
			h := newHarness(t)
			if err := h.uc.Handle(ctx, dto.Input{Token: raw}); err != nil {
				t.Fatalf("= %v, want no error", err)
			}
			if len(h.events) != 0 {
				t.Errorf("%d events, want nothing announced for a session that was not ended", len(h.events))
			}
		})
	}
}

// Logging out twice is fine, but only the first one ended anything, so only the
// first one announces it.
func TestSecondLogoutAnnouncesNothing(t *testing.T) {
	ctx := context.Background()
	h := newHarness(t)
	raw := h.session.Token.String()

	if err := h.uc.Handle(ctx, dto.Input{Token: raw}); err != nil {
		t.Fatal(err)
	}
	if err := h.uc.Handle(ctx, dto.Input{Token: raw}); err != nil {
		t.Fatalf("the second logout = %v, want no error", err)
	}
	if len(h.events) != 1 {
		t.Errorf("%d events, want exactly one SessionEnded", len(h.events))
	}
}
