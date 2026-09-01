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
