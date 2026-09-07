package get_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/stretchr/testify/mock"

	"github.com/shortlink-org/portolan/examples/auth/internal/user/application/get"
	"github.com/shortlink-org/portolan/examples/auth/internal/user/application/get/dto"
	"github.com/shortlink-org/portolan/examples/auth/internal/user/domain"
	"github.com/shortlink-org/portolan/examples/auth/internal/user/domain/vo/password"
)

var now = time.Date(2026, 3, 1, 12, 0, 0, 0, time.UTC)

func storedUser(t testing.TB) *user.User {
	t.Helper()
	hash, err := password.ParseHash("test$1$01$02")
	if err != nil {
		t.Fatal(err)
	}
	u, _, err := user.Register("u1", "Ada@Example.com", hash, now)
	if err != nil {
		t.Fatal(err)
	}
	return u
}

func TestGet(t *testing.T) {
	repository := NewMockRepository(t)
	repository.EXPECT().ByID(mock.Anything, "u1").Return(storedUser(t), nil).Once()

	out, err := get.New(repository).Handle(context.Background(), dto.Input{UserID: "u1"})
	if err != nil {
		t.Fatal(err)
	}
	if out.UserID != "u1" || out.Email != "ada@example.com" || !out.CreatedAt.Equal(now) {
		t.Errorf("out = %+v, want the stored user", out)
	}
}

func TestMissingIsSaidPlainly(t *testing.T) {
	repository := NewMockRepository(t)
	repository.EXPECT().ByID(mock.Anything, "nobody").Return(nil, user.ErrNotFound).Once()

	_, err := get.New(repository).Handle(context.Background(), dto.Input{UserID: "nobody"})
	if !errors.Is(err, user.ErrNotFound) {
		t.Fatalf("= %v, want ErrNotFound", err)
	}
}
