package user_test

import (
	"context"
	"errors"
	"testing"
	"time"

	domain "github.com/shortlink-org/portolan/examples/auth/internal/domain/user"
	repo "github.com/shortlink-org/portolan/examples/auth/internal/infrastructure/repository/user"
)

const (
	plaintext = "Passw0rdish"
	address   = "Ada@Example.com"
)

var now = time.Date(2026, 3, 1, 12, 0, 0, 0, time.UTC)

func newUser(t *testing.T, id, mail string) *domain.User {
	t.Helper()
	u, _, err := domain.Register(id, mail, plaintext, now)
	if err != nil {
		t.Fatal(err)
	}
	return u
}

func TestSaveAndRead(t *testing.T) {
	ctx := context.Background()
	store := repo.NewMemory()
	u := newUser(t, "u1", address)

	if err := store.Save(ctx, u); err != nil {
		t.Fatal(err)
	}

	byID, err := store.ByID(ctx, "u1")
	if err != nil {
		t.Fatalf("ByID: %v", err)
	}
	if byID.ID != "u1" {
		t.Errorf("ByID gave %q", byID.ID)
	}

	// The address is looked up as typed, not as normalised, because that is how
	// it arrives from a login form.
	for _, spelling := range []string{"ada@example.com", "Ada@Example.com", "  ADA@EXAMPLE.COM  "} {
		if _, err := store.ByEmail(ctx, spelling); err != nil {
			t.Errorf("ByEmail(%q): %v", spelling, err)
		}
	}
}

func TestMissing(t *testing.T) {
	ctx := context.Background()
	store := repo.NewMemory()

	if _, err := store.ByID(ctx, "nobody"); !errors.Is(err, domain.ErrNotFound) {
		t.Errorf("ByID = %v, want ErrNotFound", err)
	}
	if _, err := store.ByEmail(ctx, "nobody@example.com"); !errors.Is(err, domain.ErrNotFound) {
		t.Errorf("ByEmail = %v, want ErrNotFound", err)
	}
}

// Uniqueness lives here because this is the only place that can see every user;
// one aggregate cannot know about the others.
func TestEmailIsUnique(t *testing.T) {
	ctx := context.Background()
	store := repo.NewMemory()

	if err := store.Save(ctx, newUser(t, "u1", address)); err != nil {
		t.Fatal(err)
	}
	err := store.Save(ctx, newUser(t, "u2", "ADA@example.com"))
	if !errors.Is(err, domain.ErrEmailTaken) {
		t.Fatalf("a second user on one address = %v, want ErrEmailTaken", err)
	}

	// And the first one is untouched.
	first, err := store.ByEmail(ctx, address)
	if err != nil || first.ID != "u1" {
		t.Errorf("the original user should still be there, got %v %v", first, err)
	}
}

// Saving the same user again is not a uniqueness violation with itself.
func TestSaveIsIdempotentForOneUser(t *testing.T) {
	ctx := context.Background()
	store := repo.NewMemory()
	u := newUser(t, "u1", address)

	if err := store.Save(ctx, u); err != nil {
		t.Fatal(err)
	}
	if err := store.Save(ctx, u); err != nil {
		t.Fatalf("re-saving the same user: %v", err)
	}
}

// The boundary. A store that hands out what it holds lets a caller change
// stored state without saving - which no real database does, so a test that
// passes against it would not pass against one.
func TestAggregateDoesNotEscape(t *testing.T) {
	ctx := context.Background()
	store := repo.NewMemory()
	u := newUser(t, "u1", address)
	if err := store.Save(ctx, u); err != nil {
		t.Fatal(err)
	}

	t.Run("through a read", func(t *testing.T) {
		loaded, _ := store.ByID(ctx, "u1")
		loaded.ID = "tampered"

		again, err := store.ByID(ctx, "u1")
		if err != nil {
			t.Fatalf("the stored user went missing: %v", err)
		}
		if again.ID != "u1" {
			t.Error("changing what was read changed what is stored")
		}
	})

	t.Run("through the saved object", func(t *testing.T) {
		u.ID = "tampered"

		again, err := store.ByID(ctx, "u1")
		if err != nil || again.ID != "u1" {
			t.Error("changing what was saved changed what is stored")
		}
	})
}
