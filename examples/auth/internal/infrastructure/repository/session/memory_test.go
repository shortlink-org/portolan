package session_test

import (
	"context"
	"errors"
	"testing"
	"time"

	domain "github.com/shortlink-org/portolan/examples/auth/internal/domain/session"
	"github.com/shortlink-org/portolan/examples/auth/internal/domain/session/event"
	"github.com/shortlink-org/portolan/examples/auth/internal/domain/session/vo/token"
	repo "github.com/shortlink-org/portolan/examples/auth/internal/infrastructure/repository/session"
)

var now = time.Date(2026, 3, 1, 12, 0, 0, 0, time.UTC)

func newSession(t *testing.T, id, userID string) *domain.Session {
	t.Helper()
	s, _, err := domain.Start(id, userID, now)
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func TestSaveAndRead(t *testing.T) {
	ctx := context.Background()
	store := repo.NewMemory()
	s := newSession(t, "s1", "u1")

	if err := store.Save(ctx, s); err != nil {
		t.Fatal(err)
	}

	byID, err := store.ByID(ctx, "s1")
	if err != nil || byID.UserID != "u1" {
		t.Fatalf("ByID = %v, %v", byID, err)
	}

	// The hot path: every authenticated request in the estate ends here.
	byToken, err := store.ByToken(ctx, s.Token)
	if err != nil || byToken.ID != "s1" {
		t.Fatalf("ByToken = %v, %v", byToken, err)
	}
}

func TestMissing(t *testing.T) {
	ctx := context.Background()
	store := repo.NewMemory()
	stranger, _ := token.New()

	if _, err := store.ByID(ctx, "nobody"); !errors.Is(err, domain.ErrNotFound) {
		t.Errorf("ByID = %v, want ErrNotFound", err)
	}
	if _, err := store.ByToken(ctx, stranger); !errors.Is(err, domain.ErrNotFound) {
		t.Errorf("ByToken = %v, want ErrNotFound", err)
	}
}

// An expired session is still stored. Expiry is answered by the aggregate at
// read time, so nothing has to have swept it for it to be refused - and a
// sweeper would be a space optimisation, not a rule.
func TestExpiredSessionsAreStillFound(t *testing.T) {
	ctx := context.Background()
	store := repo.NewMemory()
	s := newSession(t, "s1", "u1")
	if err := store.Save(ctx, s); err != nil {
		t.Fatal(err)
	}

	found, err := store.ByToken(ctx, s.Token)
	if err != nil {
		t.Fatalf("an expired session should still be found: %v", err)
	}
	if err := found.Validate(s.ExpiresAt.Add(time.Hour)); err != domain.ErrExpired {
		t.Errorf("and the aggregate refuses it: %v", err)
	}
}

func TestRevocationIsVisibleOnlyAfterSave(t *testing.T) {
	ctx := context.Background()
	store := repo.NewMemory()
	s := newSession(t, "s1", "u1")
	if err := store.Save(ctx, s); err != nil {
		t.Fatal(err)
	}

	loaded, _ := store.ByID(ctx, "s1")
	loaded.Revoke(event.ReasonLogout, now)

	before, _ := store.ByID(ctx, "s1")
	if !before.RevokedAt.IsZero() {
		t.Fatal("a revocation reached storage without a Save")
	}

	if err := store.Save(ctx, loaded); err != nil {
		t.Fatal(err)
	}
	after, _ := store.ByID(ctx, "s1")
	if after.RevokedAt.IsZero() {
		t.Error("after Save the revocation should be stored")
	}
}

func TestSaveAdvancesTheVersion(t *testing.T) {
	ctx := context.Background()
	store := repo.NewMemory()
	s := newSession(t, "s1", "u1")

	if err := store.Save(ctx, s); err != nil {
		t.Fatal(err)
	}
	stored, _ := store.ByID(ctx, "s1")
	if stored.Version != 1 {
		t.Errorf("stored version = %d, want 1", stored.Version)
	}
	if s.Version != 0 {
		t.Errorf("Save moved the caller's version to %d", s.Version)
	}
}

// Two devices logging out at once. One wins; the other is told to read again
// rather than quietly overwriting what the first one did.
func TestConcurrentLogoutsConflict(t *testing.T) {
	ctx := context.Background()
	store := repo.NewMemory()
	if err := store.Save(ctx, newSession(t, "s1", "u1")); err != nil {
		t.Fatal(err)
	}

	phone, _ := store.ByID(ctx, "s1")
	laptop, _ := store.ByID(ctx, "s1")

	phone.Revoke(event.ReasonLogout, now)
	if err := store.Save(ctx, phone); err != nil {
		t.Fatalf("the first logout should win: %v", err)
	}

	laptop.Revoke(event.ReasonRevoked, now)
	if err := store.Save(ctx, laptop); !errors.Is(err, domain.ErrConflict) {
		t.Fatalf("the second = %v, want ErrConflict", err)
	}

	// The first writer's reason is the one that stands.
	stored, _ := store.ByID(ctx, "s1")
	if stored.RevokedAt.IsZero() {
		t.Error("the session should be revoked")
	}
}

func TestByUserID(t *testing.T) {
	ctx := context.Background()
	store := repo.NewMemory()

	for _, id := range []string{"s1", "s2", "s3"} {
		s := newSession(t, id, "u1")
		if err := store.Save(ctx, s); err != nil {
			t.Fatal(err)
		}
	}
	if err := store.Save(ctx, newSession(t, "other", "u2")); err != nil {
		t.Fatal(err)
	}

	got, err := store.ByUserID(ctx, "u1")
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 3 {
		t.Fatalf("%d sessions, want 3", len(got))
	}
	// In the order they were issued, so a reader of the result can reason about
	// which came first without sorting it themselves.
	for i, want := range []string{"s1", "s2", "s3"} {
		if got[i].ID != want {
			t.Errorf("position %d is %q, want %q", i, got[i].ID, want)
		}
	}
}

// Dead sessions are included. Whether a revoked or expired one still matters is
// a decision for the domain service, not for the store.
func TestByUserIDIncludesTheDead(t *testing.T) {
	ctx := context.Background()
	store := repo.NewMemory()

	s := newSession(t, "s1", "u1")
	if err := store.Save(ctx, s); err != nil {
		t.Fatal(err)
	}
	loaded, _ := store.ByID(ctx, "s1")
	loaded.Revoke(event.ReasonLogout, now)
	if err := store.Save(ctx, loaded); err != nil {
		t.Fatal(err)
	}

	got, err := store.ByUserID(ctx, "u1")
	if err != nil || len(got) != 1 {
		t.Fatalf("= %v, %v; want the revoked session to still be listed", got, err)
	}
}

// Somebody with nothing open has nothing open. That is an empty list, not a
// missing user - this store knows nothing about users.
func TestByUserIDOfAStranger(t *testing.T) {
	got, err := repo.NewMemory().ByUserID(context.Background(), "nobody")
	if err != nil {
		t.Fatalf("= %v, want no error", err)
	}
	if len(got) != 0 {
		t.Errorf("%d sessions, want none", len(got))
	}
}

// Re-saving a session must not list it twice.
func TestByUserIDDoesNotDuplicate(t *testing.T) {
	ctx := context.Background()
	store := repo.NewMemory()
	s := newSession(t, "s1", "u1")
	if err := store.Save(ctx, s); err != nil {
		t.Fatal(err)
	}
	loaded, _ := store.ByID(ctx, "s1")
	if err := store.Save(ctx, loaded); err != nil {
		t.Fatal(err)
	}

	got, _ := store.ByUserID(ctx, "u1")
	if len(got) != 1 {
		t.Fatalf("%d sessions, want 1", len(got))
	}
}

// And what it hands out is a copy, like every other read.
func TestByUserIDDoesNotLeak(t *testing.T) {
	ctx := context.Background()
	store := repo.NewMemory()
	if err := store.Save(ctx, newSession(t, "s1", "u1")); err != nil {
		t.Fatal(err)
	}

	got, _ := store.ByUserID(ctx, "u1")
	got[0].Revoke(event.ReasonLogout, now)

	stored, _ := store.ByID(ctx, "s1")
	if !stored.RevokedAt.IsZero() {
		t.Error("changing what ByUserID returned changed what is stored")
	}
}

func TestAggregateDoesNotEscape(t *testing.T) {
	ctx := context.Background()
	store := repo.NewMemory()
	s := newSession(t, "s1", "u1")
	if err := store.Save(ctx, s); err != nil {
		t.Fatal(err)
	}

	// Through the object that was saved.
	s.Revoke(event.ReasonRevoked, now)

	stored, err := store.ByID(ctx, "s1")
	if err != nil {
		t.Fatal(err)
	}
	if !stored.RevokedAt.IsZero() {
		t.Error("changing what was saved changed what is stored")
	}
}
