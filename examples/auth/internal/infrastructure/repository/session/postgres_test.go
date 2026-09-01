package session_test

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"

	domain "github.com/shortlink-org/portolan/examples/auth/internal/domain/session"
	"github.com/shortlink-org/portolan/examples/auth/internal/domain/session/event"
	"github.com/shortlink-org/portolan/examples/auth/internal/domain/session/vo/token"
	repo "github.com/shortlink-org/portolan/examples/auth/internal/infrastructure/repository/session"
	"github.com/shortlink-org/portolan/examples/auth/internal/pkg/postgrestest"
	"github.com/shortlink-org/portolan/examples/auth/internal/pkg/redistest"
)

var now = time.Date(2026, 3, 1, 12, 0, 0, 0, time.UTC)

func TestMain(m *testing.M) {
	code := m.Run()
	postgrestest.Stop()
	redistest.Stop()
	os.Exit(code)
}

func store(t *testing.T) *repo.Postgres {
	t.Helper()

	router, unit := postgrestest.Store(t, postgrestest.Source{FS: repo.Migrations, Name: repo.Name})

	return repo.NewPostgres(router, unit, nil)
}

func newSession(t *testing.T, id, userID string, issued time.Time) *domain.Session {
	t.Helper()
	s, _, err := domain.Start(id, userID, issued)
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func TestSaveAndRead(t *testing.T) {
	ctx := context.Background()
	s := store(t)
	sess := newSession(t, "s1", "u1", now)

	if err := s.Save(ctx, sess); err != nil {
		t.Fatal(err)
	}

	byID, err := s.ByID(ctx, "s1")
	if err != nil || byID.UserID != "u1" {
		t.Fatalf("ByID = %v, %v", byID, err)
	}
	if !byID.IssuedAt.Equal(now) || !byID.ExpiresAt.Equal(sess.ExpiresAt) {
		t.Errorf("times did not survive the round trip: %+v", byID)
	}
	if !byID.RevokedAt.IsZero() {
		t.Error("a session that was never revoked has no revocation time")
	}

	// The hot path.
	byToken, err := s.ByToken(ctx, sess.Token)
	if err != nil || byToken.ID != "s1" {
		t.Fatalf("ByToken = %v, %v", byToken, err)
	}
}

func TestMissing(t *testing.T) {
	ctx := context.Background()
	s := store(t)
	stranger, _ := token.New()

	if _, err := s.ByID(ctx, "nobody"); !errors.Is(err, domain.ErrNotFound) {
		t.Errorf("ByID = %v, want ErrNotFound", err)
	}
	if _, err := s.ByToken(ctx, stranger); !errors.Is(err, domain.ErrNotFound) {
		t.Errorf("ByToken = %v, want ErrNotFound", err)
	}
}

func TestRevocationRoundTrips(t *testing.T) {
	ctx := context.Background()
	s := store(t)
	if err := s.Save(ctx, newSession(t, "s1", "u1", now)); err != nil {
		t.Fatal(err)
	}

	loaded, _ := s.ByID(ctx, "s1")
	ev, ended := loaded.Revoke(event.ReasonLogout, now.Add(time.Minute))
	if !ended {
		t.Fatal("a live session should end")
	}
	if err := s.Save(ctx, loaded, ev); err != nil {
		t.Fatal(err)
	}

	stored, _ := s.ByID(ctx, "s1")
	if err := stored.Validate(now.Add(2 * time.Minute)); err != domain.ErrRevoked {
		t.Errorf("= %v, want ErrRevoked", err)
	}
}

// An expired session is still stored: expiry is answered by the aggregate at
// read time, so nothing has to have swept it for it to be refused.
func TestExpiredSessionsAreStillFound(t *testing.T) {
	ctx := context.Background()
	s := store(t)
	sess := newSession(t, "s1", "u1", now)
	if err := s.Save(ctx, sess); err != nil {
		t.Fatal(err)
	}

	found, err := s.ByToken(ctx, sess.Token)
	if err != nil {
		t.Fatalf("an expired session should still be found: %v", err)
	}
	if err := found.Validate(sess.ExpiresAt.Add(time.Hour)); err != domain.ErrExpired {
		t.Errorf("and the aggregate refuses it: %v", err)
	}
}

func TestByUserID(t *testing.T) {
	ctx := context.Background()
	s := store(t)

	for i, id := range []string{"s1", "s2", "s3"} {
		if err := s.Save(ctx, newSession(t, id, "u1", now.Add(time.Duration(i)*time.Minute))); err != nil {
			t.Fatal(err)
		}
	}
	if err := s.Save(ctx, newSession(t, "other", "u2", now)); err != nil {
		t.Fatal(err)
	}

	got, err := s.ByUserID(ctx, "u1")
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 3 {
		t.Fatalf("%d sessions, want 3", len(got))
	}
	// In the order they were issued, so a reader can reason about which came
	// first without sorting the result themselves.
	for i, want := range []string{"s1", "s2", "s3"} {
		if got[i].ID != want {
			t.Errorf("position %d is %q, want %q", i, got[i].ID, want)
		}
	}
}

// Dead sessions are included. Whether a revoked one still matters is a decision
// for the domain, not for the store.
func TestByUserIDIncludesTheDead(t *testing.T) {
	ctx := context.Background()
	s := store(t)
	if err := s.Save(ctx, newSession(t, "s1", "u1", now)); err != nil {
		t.Fatal(err)
	}

	loaded, _ := s.ByID(ctx, "s1")
	loaded.Revoke(event.ReasonLogout, now)
	if err := s.Save(ctx, loaded); err != nil {
		t.Fatal(err)
	}

	got, err := s.ByUserID(ctx, "u1")
	if err != nil || len(got) != 1 {
		t.Fatalf("= %v, %v; want the revoked session to still be listed", got, err)
	}
}

func TestByUserIDOfAStranger(t *testing.T) {
	got, err := store(t).ByUserID(context.Background(), "nobody")
	if err != nil {
		t.Fatalf("= %v, want no error", err)
	}
	if len(got) != 0 {
		t.Errorf("%d sessions, want none", len(got))
	}
}

// Two devices logging out at once. One wins; the other is told to read again
// rather than quietly overwriting what the first one did.
func TestConcurrentLogoutsConflict(t *testing.T) {
	ctx := context.Background()
	s := store(t)
	if err := s.Save(ctx, newSession(t, "s1", "u1", now)); err != nil {
		t.Fatal(err)
	}

	phone, _ := s.ByID(ctx, "s1")
	laptop, _ := s.ByID(ctx, "s1")

	phone.Revoke(event.ReasonLogout, now)
	if err := s.Save(ctx, phone); err != nil {
		t.Fatalf("the first logout should win: %v", err)
	}

	laptop.Revoke(event.ReasonRevoked, now)
	if err := s.Save(ctx, laptop); !errors.Is(err, domain.ErrConflict) {
		t.Fatalf("the second = %v, want ErrConflict", err)
	}
}

func TestSaveAdvancesTheVersion(t *testing.T) {
	ctx := context.Background()
	s := store(t)
	sess := newSession(t, "s1", "u1", now)

	if err := s.Save(ctx, sess); err != nil {
		t.Fatal(err)
	}
	stored, _ := s.ByID(ctx, "s1")
	if stored.Version != 1 {
		t.Errorf("stored version = %d, want 1", stored.Version)
	}
	if sess.Version != 0 {
		t.Errorf("Save moved the caller's version to %d", sess.Version)
	}
}
