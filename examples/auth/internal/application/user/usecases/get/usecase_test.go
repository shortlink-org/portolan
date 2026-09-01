package get_test

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/shortlink-org/portolan/examples/auth/internal/application/user/usecases/get"
	"github.com/shortlink-org/portolan/examples/auth/internal/application/user/usecases/get/dto"
	"github.com/shortlink-org/portolan/examples/auth/internal/domain/user"
	repo "github.com/shortlink-org/portolan/examples/auth/internal/infrastructure/repository/user"
	"github.com/shortlink-org/portolan/examples/auth/internal/infrastructure/storage/postgrestest"
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

func TestGet(t *testing.T) {
	ctx := context.Background()
	s := store(t)
	u, _, err := user.Register("u1", "Ada@Example.com", "Passw0rdish", now)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.Save(ctx, u); err != nil {
		t.Fatal(err)
	}

	out, err := get.New(s).Handle(ctx, dto.Input{UserID: "u1"})
	if err != nil {
		t.Fatal(err)
	}
	if out.UserID != "u1" || out.Email != "ada@example.com" || !out.CreatedAt.Equal(now) {
		t.Errorf("out = %+v, want the stored user", out)
	}
}

// Unlike authenticate, this one may admit that a user does not exist: the
// caller already knows the id, so nothing is disclosed by saying so.
func TestMissingIsSaidPlainly(t *testing.T) {
	_, err := get.New(store(t)).Handle(context.Background(), dto.Input{UserID: "nobody"})
	if !errors.Is(err, user.ErrNotFound) {
		t.Fatalf("= %v, want ErrNotFound", err)
	}
}
