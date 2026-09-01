package end_after_credential_change_test

import (
	"context"
	"testing"
	"time"

	"github.com/shortlink-org/portolan/examples/auth/internal/application/session/usecases/end_after_credential_change"
	"github.com/shortlink-org/portolan/examples/auth/internal/application/session/usecases/end_after_credential_change/dto"
	"github.com/shortlink-org/portolan/examples/auth/internal/domain/session"
	"github.com/shortlink-org/portolan/examples/auth/internal/domain/session/event"
	bus "github.com/shortlink-org/portolan/examples/auth/internal/infrastructure/bus/session"
	repo "github.com/shortlink-org/portolan/examples/auth/internal/infrastructure/repository/session"
)

var change = time.Date(2026, 3, 1, 12, 0, 0, 0, time.UTC)

func store(t *testing.T, issued map[string]time.Time) *repo.Memory {
	t.Helper()
	s := repo.NewMemory()
	for id, at := range issued {
		sess, _, err := session.Start(id, "u1", at)
		if err != nil {
			t.Fatal(err)
		}
		if err := s.Save(context.Background(), sess); err != nil {
			t.Fatal(err)
		}
	}
	return s
}

func TestEndsWhatTheServiceSelected(t *testing.T) {
	ctx := context.Background()
	st := store(t, map[string]time.Time{
		"laptop": change.Add(-time.Hour),
		"phone":  change.Add(-time.Hour),
		"fresh":  change.Add(time.Minute),
	})
	uc := end_after_credential_change.New(st, bus.NewInProc(), func() time.Time { return change.Add(time.Hour) })

	err := uc.Handle(ctx, dto.Input{UserID: "u1", ChangedAt: change, Keep: "laptop"})
	if err != nil {
		t.Fatal(err)
	}

	for id, wantLive := range map[string]bool{"laptop": true, "phone": false, "fresh": true} {
		s, err := st.ByID(ctx, id)
		if err != nil {
			t.Fatal(err)
		}
		if got := s.RevokedAt.IsZero(); got != wantLive {
			t.Errorf("%s: revoked=%v, want live=%v", id, !got, wantLive)
		}
	}
}

// One transaction per session. A single write covering all of them would span
// several aggregates, and one unlucky conflict would undo every revocation.
func TestEachSessionIsSavedOnItsOwn(t *testing.T) {
	ctx := context.Background()
	st := store(t, map[string]time.Time{
		"a": change.Add(-time.Hour),
		"b": change.Add(-time.Hour),
	})
	uc := end_after_credential_change.New(st, bus.NewInProc(), func() time.Time { return change })

	if err := uc.Handle(ctx, dto.Input{UserID: "u1", ChangedAt: change}); err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"a", "b"} {
		s, _ := st.ByID(ctx, id)
		if s.Version != 2 {
			t.Errorf("%s is at version %d, want 2 - one write to start it, one to end it", id, s.Version)
		}
	}
}

// One event per session actually ended, and each names the reason so a client
// can explain the sign-out instead of blaming an expiry that did not happen.
func TestOneEventPerSessionEnded(t *testing.T) {
	ctx := context.Background()
	st := store(t, map[string]time.Time{
		"a": change.Add(-time.Hour),
		"b": change.Add(-time.Hour),
		"c": change.Add(-time.Hour),
	})

	var got []event.Event
	b := bus.NewInProc()
	b.Subscribe("", func(_ context.Context, e event.Event) error {
		got = append(got, e)
		return nil
	})

	uc := end_after_credential_change.New(st, b, func() time.Time { return change })
	if err := uc.Handle(ctx, dto.Input{UserID: "u1", ChangedAt: change, Keep: "c"}); err != nil {
		t.Fatal(err)
	}

	if len(got) != 2 {
		t.Fatalf("%d events, want one per ended session", len(got))
	}
	for _, e := range got {
		if e.(event.SessionEnded).Reason() != event.ReasonPasswordChanged {
			t.Errorf("reason = %q", e.(event.SessionEnded).Reason())
		}
	}
}

// A session somebody else revoked in the meantime is left alone: their event
// already said it ended, and a second one would report it twice.
func TestSessionEndedBysomebodyElse(t *testing.T) {
	ctx := context.Background()
	st := store(t, map[string]time.Time{"phone": change.Add(-time.Hour)})

	loaded, _ := st.ByID(ctx, "phone")
	loaded.Revoke(event.ReasonLogout, change.Add(-time.Minute))
	if err := st.Save(ctx, loaded); err != nil {
		t.Fatal(err)
	}

	var got []event.Event
	b := bus.NewInProc()
	b.Subscribe("", func(_ context.Context, e event.Event) error {
		got = append(got, e)
		return nil
	})

	uc := end_after_credential_change.New(st, b, func() time.Time { return change })
	if err := uc.Handle(ctx, dto.Input{UserID: "u1", ChangedAt: change}); err != nil {
		t.Fatal(err)
	}
	if len(got) != 0 {
		t.Errorf("%d events, want none for a session that was already ended", len(got))
	}
}

func TestUserWithNothingOpen(t *testing.T) {
	uc := end_after_credential_change.New(repo.NewMemory(), bus.NewInProc(), func() time.Time { return change })
	if err := uc.Handle(context.Background(), dto.Input{UserID: "nobody", ChangedAt: change}); err != nil {
		t.Fatalf("= %v, want no error", err)
	}
}
