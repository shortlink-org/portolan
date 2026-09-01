package validate_test

import (
	"context"
	"testing"
	"time"

	"github.com/shortlink-org/portolan/examples/auth/internal/application/session/usecases/validate"
	"github.com/shortlink-org/portolan/examples/auth/internal/application/session/usecases/validate/dto"
	"github.com/shortlink-org/portolan/examples/auth/internal/domain/session"
	"github.com/shortlink-org/portolan/examples/auth/internal/domain/session/event"
	repo "github.com/shortlink-org/portolan/examples/auth/internal/infrastructure/repository/session"
)

var now = time.Date(2026, 3, 1, 12, 0, 0, 0, time.UTC)

func newHarness(t *testing.T, at func() time.Time) (*validate.UseCase, *session.Session, *repo.Memory) {
	t.Helper()
	store := repo.NewMemory()
	s, _, err := session.Start("s1", "u1", now)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Save(context.Background(), s); err != nil {
		t.Fatal(err)
	}
	return validate.New(store, at), s, store
}

func TestValidate(t *testing.T) {
	uc, s, _ := newHarness(t, func() time.Time { return now })

	out, err := uc.Handle(context.Background(), dto.Input{Token: s.Token.String()})
	if err != nil {
		t.Fatal(err)
	}
	if out.UserID != "u1" {
		t.Errorf("userID = %q, want u1", out.UserID)
	}
	if !out.ExpiresAt.Equal(s.ExpiresAt) {
		t.Errorf("expiresAt = %v, want %v", out.ExpiresAt, s.ExpiresAt)
	}
}

func TestExpired(t *testing.T) {
	uc, s, _ := newHarness(t, func() time.Time { return now.Add(session.TTL + time.Second) })

	if _, err := uc.Handle(context.Background(), dto.Input{Token: s.Token.String()}); err != session.ErrExpired {
		t.Fatalf("= %v, want ErrExpired", err)
	}
}

func TestRevoked(t *testing.T) {
	ctx := context.Background()
	uc, s, store := newHarness(t, func() time.Time { return now })

	loaded, _ := store.ByID(ctx, "s1")
	loaded.Revoke(event.ReasonLogout, now)
	if err := store.Save(ctx, loaded); err != nil {
		t.Fatal(err)
	}

	if _, err := uc.Handle(ctx, dto.Input{Token: s.Token.String()}); err != session.ErrRevoked {
		t.Fatalf("= %v, want ErrRevoked", err)
	}
}

// A token that is not shaped like ours is reported as unknown, not as a parse
// failure. Outside auth the two are the same answer, and telling them apart
// only helps somebody probing the format.
func TestMalformedIsReportedAsUnknown(t *testing.T) {
	uc, _, _ := newHarness(t, func() time.Time { return now })

	for _, raw := range []string{"", "....", "YWJj"} {
		if _, err := uc.Handle(context.Background(), dto.Input{Token: raw}); err != session.ErrNotFound {
			t.Errorf("%q = %v, want ErrNotFound", raw, err)
		}
	}
}

// The hot path writes nothing: validating a token must not touch the store.
func TestValidateDoesNotWrite(t *testing.T) {
	ctx := context.Background()
	uc, s, store := newHarness(t, func() time.Time { return now })

	before, _ := store.ByID(ctx, "s1")
	if _, err := uc.Handle(ctx, dto.Input{Token: s.Token.String()}); err != nil {
		t.Fatal(err)
	}
	after, _ := store.ByID(ctx, "s1")

	if *before != *after {
		t.Error("validating a session changed it")
	}
}
