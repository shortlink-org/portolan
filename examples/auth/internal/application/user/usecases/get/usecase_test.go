package get_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/shortlink-org/portolan/examples/auth/internal/application/user/usecases/get"
	"github.com/shortlink-org/portolan/examples/auth/internal/application/user/usecases/get/dto"
	"github.com/shortlink-org/portolan/examples/auth/internal/domain/user"
	repo "github.com/shortlink-org/portolan/examples/auth/internal/infrastructure/repository/user"
)

var now = time.Date(2026, 3, 1, 12, 0, 0, 0, time.UTC)

func TestGet(t *testing.T) {
	ctx := context.Background()
	store := repo.NewMemory()
	u, _, err := user.Register("u1", "Ada@Example.com", "Passw0rdish", now)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Save(ctx, u); err != nil {
		t.Fatal(err)
	}

	out, err := get.New(store).Handle(ctx, dto.Input{UserID: "u1"})
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
	_, err := get.New(repo.NewMemory()).Handle(context.Background(), dto.Input{UserID: "nobody"})
	if !errors.Is(err, user.ErrNotFound) {
		t.Fatalf("= %v, want ErrNotFound", err)
	}
}
