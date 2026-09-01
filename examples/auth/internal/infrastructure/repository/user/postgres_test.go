package user_test

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"

	domain "github.com/shortlink-org/portolan/examples/auth/internal/domain/user"
	repo "github.com/shortlink-org/portolan/examples/auth/internal/infrastructure/repository/user"
	"github.com/shortlink-org/portolan/examples/auth/internal/pkg/postgrestest"
)

const (
	plaintext = "Passw0rdish"
	address   = "Ada@Example.com"
)

var now = time.Date(2026, 3, 1, 12, 0, 0, 0, time.UTC)

func TestMain(m *testing.M) {
	code := m.Run()
	postgrestest.Stop()
	os.Exit(code)
}

func store(t *testing.T) *repo.Postgres {
	t.Helper()

	router, unit := postgrestest.Store(t, postgrestest.Source{FS: repo.Migrations, Name: repo.Name})

	return repo.NewPostgres(router, unit, nil)
}

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
	s := store(t)

	if err := s.Save(ctx, newUser(t, "u1", address)); err != nil {
		t.Fatal(err)
	}

	byID, err := s.ByID(ctx, "u1")
	if err != nil {
		t.Fatalf("ByID: %v", err)
	}
	if byID.ID != "u1" || !byID.CreatedAt.Equal(now) {
		t.Errorf("ByID gave %+v", byID)
	}
	// The hash survives the round trip, which is the whole point of the stored
	// form carrying its own parameters.
	if !byID.Password.Matches(plaintext) {
		t.Error("the password no longer verifies after a round trip")
	}

	// However the address is typed on the way in, it is the same address.
	for _, spelling := range []string{"ada@example.com", "Ada@Example.com", "  ADA@EXAMPLE.COM  "} {
		if _, err := s.ByEmail(ctx, spelling); err != nil {
			t.Errorf("ByEmail(%q): %v", spelling, err)
		}
	}
}

func TestMissing(t *testing.T) {
	ctx := context.Background()
	s := store(t)

	if _, err := s.ByID(ctx, "nobody"); !errors.Is(err, domain.ErrNotFound) {
		t.Errorf("ByID = %v, want ErrNotFound", err)
	}
	if _, err := s.ByEmail(ctx, "nobody@example.com"); !errors.Is(err, domain.ErrNotFound) {
		t.Errorf("ByEmail = %v, want ErrNotFound", err)
	}
}

// Uniqueness is now a unique index rather than a look-before-you-write, which
// is the difference between a rule and a hope: two writers both look and both
// find nothing.
func TestEmailIsUnique(t *testing.T) {
	ctx := context.Background()
	s := store(t)

	if err := s.Save(ctx, newUser(t, "u1", address)); err != nil {
		t.Fatal(err)
	}
	if err := s.Save(ctx, newUser(t, "u2", "ADA@example.com")); !errors.Is(err, domain.ErrEmailTaken) {
		t.Fatalf("a second user on one address = %v, want ErrEmailTaken", err)
	}

	first, err := s.ByEmail(ctx, address)
	if err != nil || first.ID != "u1" {
		t.Errorf("the original user should still be there, got %v %v", first, err)
	}
}

func TestSaveAdvancesTheVersion(t *testing.T) {
	ctx := context.Background()
	s := store(t)
	u := newUser(t, "u1", address)

	if err := s.Save(ctx, u); err != nil {
		t.Fatal(err)
	}
	stored, _ := s.ByID(ctx, "u1")
	if stored.Version != 1 {
		t.Errorf("stored version = %d, want 1", stored.Version)
	}
	if u.Version != 0 {
		t.Errorf("Save moved the caller's version to %d", u.Version)
	}
}

// Two changes made from one read must not both succeed, or the first one
// vanishes without anyone being told.
func TestStaleWriteIsRefused(t *testing.T) {
	ctx := context.Background()
	s := store(t)
	if err := s.Save(ctx, newUser(t, "u1", address)); err != nil {
		t.Fatal(err)
	}

	first, _ := s.ByID(ctx, "u1")
	second, _ := s.ByID(ctx, "u1")

	if _, err := first.ChangePassword(plaintext, "NewPassw0rd", "s1", now); err != nil {
		t.Fatal(err)
	}
	if err := s.Save(ctx, first); err != nil {
		t.Fatalf("the first writer should win: %v", err)
	}
	if err := s.Save(ctx, second); !errors.Is(err, domain.ErrConflict) {
		t.Fatalf("the second writer = %v, want ErrConflict", err)
	}
}

func TestSavingTheSameObjectTwiceConflicts(t *testing.T) {
	ctx := context.Background()
	s := store(t)
	u := newUser(t, "u1", address)

	if err := s.Save(ctx, u); err != nil {
		t.Fatal(err)
	}
	if err := s.Save(ctx, u); !errors.Is(err, domain.ErrConflict) {
		t.Fatalf("the second Save = %v, want ErrConflict", err)
	}

	fresh, err := s.ByID(ctx, "u1")
	if err != nil {
		t.Fatal(err)
	}
	if err := s.Save(ctx, fresh); err != nil {
		t.Fatalf("saving a freshly read user: %v", err)
	}
}

// A version on something the store has never seen did not come from this store.
func TestUnknownUserWithAVersionIsRefused(t *testing.T) {
	ctx := context.Background()
	u := newUser(t, "u1", address)
	u.Version = 7

	if err := store(t).Save(ctx, u); !errors.Is(err, domain.ErrConflict) {
		t.Fatalf("= %v, want ErrConflict", err)
	}
}

// A change made through the aggregate is what the store then hands back - and
// nothing else is, because the aggregate never escapes.
func TestChangesLandOnlyThroughSave(t *testing.T) {
	ctx := context.Background()
	s := store(t)
	if err := s.Save(ctx, newUser(t, "u1", address)); err != nil {
		t.Fatal(err)
	}

	loaded, _ := s.ByID(ctx, "u1")
	if _, err := loaded.ChangePassword(plaintext, "NewPassw0rd", "s1", now); err != nil {
		t.Fatal(err)
	}

	before, _ := s.ByID(ctx, "u1")
	if !before.Password.Matches(plaintext) {
		t.Fatal("a change reached storage without a Save")
	}

	if err := s.Save(ctx, loaded); err != nil {
		t.Fatal(err)
	}
	after, _ := s.ByID(ctx, "u1")
	if !after.Password.Matches("NewPassw0rd") {
		t.Error("after Save the new password should be stored")
	}
}
