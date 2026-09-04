package lockout_test

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"

	domain "github.com/shortlink-org/portolan/examples/auth/internal/domain/lockout"
	repo "github.com/shortlink-org/portolan/examples/auth/internal/infrastructure/repository/lockout"
	"github.com/shortlink-org/portolan/examples/auth/internal/pkg/postgrestest"
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

func TestUnknownUserIsNotFound(t *testing.T) {
	_, err := store(t).ByUserID(context.Background(), "nobody")
	if !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("= %v, want ErrNotFound", err)
	}
}

func TestSaveAndRead(t *testing.T) {
	ctx := context.Background()
	s := store(t)

	l := domain.New("u1")
	l.Fail(now)
	if err := s.Save(ctx, l); err != nil {
		t.Fatal(err)
	}

	stored, err := s.ByUserID(ctx, "u1")
	if err != nil {
		t.Fatal(err)
	}
	if stored.Failures != 1 || !stored.LockedUntil.IsZero() || stored.Version != 1 {
		t.Errorf("stored = %+v, want one failure, no lock, version 1", stored)
	}

	// Lock it, and read the time back.
	for range domain.Threshold - 1 {
		stored.Fail(now)
	}
	if err := s.Save(ctx, stored); err != nil {
		t.Fatal(err)
	}
	again, err := s.ByUserID(ctx, "u1")
	if err != nil {
		t.Fatal(err)
	}
	if !again.LockedUntil.Equal(now.Add(domain.Duration)) || again.Version != 2 {
		t.Errorf("again = %+v, want locked until %v at version 2", again, now.Add(domain.Duration))
	}
}

// Two first failures for one user: the second insert is a conflict, not a
// duplicate row and not a silent overwrite.
func TestTwoFirstFailuresConflict(t *testing.T) {
	ctx := context.Background()
	s := store(t)

	a, b := domain.New("u1"), domain.New("u1")
	a.Fail(now)
	b.Fail(now)
	if err := s.Save(ctx, a); err != nil {
		t.Fatal(err)
	}
	if err := s.Save(ctx, b); !errors.Is(err, domain.ErrConflict) {
		t.Fatalf("= %v, want ErrConflict", err)
	}
}

func TestStaleCopyIsRefused(t *testing.T) {
	ctx := context.Background()
	s := store(t)

	first := domain.New("u1")
	first.Fail(now)
	if err := s.Save(ctx, first); err != nil {
		t.Fatal(err)
	}

	// A saved copy is not refreshed by the save; whoever wants to write again
	// reads again. Two readers of the same row get the same version.
	l, err := s.ByUserID(ctx, "u1")
	if err != nil {
		t.Fatal(err)
	}
	stale := l.Clone()

	l.Fail(now)
	if err := s.Save(ctx, l); err != nil {
		t.Fatal(err)
	}
	stale.Fail(now)
	if err := s.Save(ctx, stale); !errors.Is(err, domain.ErrConflict) {
		t.Fatalf("= %v, want ErrConflict for the stale copy", err)
	}
}
