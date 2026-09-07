package register_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/stretchr/testify/mock"

	"github.com/shortlink-org/portolan/examples/auth/internal/user/application/register"
	"github.com/shortlink-org/portolan/examples/auth/internal/user/application/register/dto"
	"github.com/shortlink-org/portolan/examples/auth/internal/user/domain"
	"github.com/shortlink-org/portolan/examples/auth/internal/user/domain/event"
	"github.com/shortlink-org/portolan/examples/auth/internal/user/domain/vo/email"
	"github.com/shortlink-org/portolan/examples/auth/internal/user/domain/vo/password"
)

var now = time.Date(2026, 3, 1, 12, 0, 0, 0, time.UTC)

const (
	address   = "Ada@Example.com"
	plaintext = "Passw0rdish"
)

func hash(t testing.TB, encoded string) password.Hash {
	t.Helper()
	h, err := password.ParseHash("test$1$01$" + encoded)
	if err != nil {
		t.Fatal(err)
	}
	return h
}

func TestRegister(t *testing.T) {
	repository := NewMockRepository(t)
	hasher := NewMockPasswordHasher(t)
	wantHash := hash(t, "02")

	repository.EXPECT().ByEmail(mock.Anything, "ada@example.com").Return(nil, user.ErrNotFound).Once()
	hasher.EXPECT().Hash(plaintext).Return(wantHash, nil).Once()
	repository.EXPECT().Save(mock.Anything, mock.Anything, mock.Anything).
		RunAndReturn(func(_ context.Context, stored *user.User, events ...event.Event) error {
			if stored.ID != "u1" || stored.Email.String() != "ada@example.com" || stored.Password != wantHash {
				t.Errorf("stored user = %+v", stored)
			}
			if len(events) != 1 || events[0].Name() != "auth.UserRegistered" {
				t.Errorf("events = %v, want one UserRegistered", events)
			}
			return nil
		}).Once()

	out, err := register.New(repository, hasher, func() time.Time { return now }, func() string { return "u1" }).
		Handle(context.Background(), dto.Input{Email: address, Password: plaintext})
	if err != nil {
		t.Fatal(err)
	}
	if out.UserID != "u1" || out.Email != "ada@example.com" || !out.CreatedAt.Equal(now) {
		t.Errorf("out = %+v", out)
	}
}

func TestSecondRegistrationIsRefused(t *testing.T) {
	repository := NewMockRepository(t)
	hasher := NewMockPasswordHasher(t)
	repository.EXPECT().ByEmail(mock.Anything, "ada@example.com").Return(&user.User{ID: "u1"}, nil).Once()

	_, err := register.New(repository, hasher, time.Now, func() string { return "unused" }).
		Handle(context.Background(), dto.Input{Email: address, Password: plaintext})
	if !errors.Is(err, user.ErrEmailTaken) {
		t.Fatalf("= %v, want ErrEmailTaken", err)
	}
}

func TestInvalidInputWritesNothing(t *testing.T) {
	t.Run("bad address", func(t *testing.T) {
		_, err := register.New(NewMockRepository(t), NewMockPasswordHasher(t), time.Now, func() string { return "u1" }).
			Handle(context.Background(), dto.Input{Email: "nope", Password: plaintext})
		if !errors.Is(err, email.ErrInvalid) {
			t.Fatalf("= %v, want %v", err, email.ErrInvalid)
		}
	})

	t.Run("bad password", func(t *testing.T) {
		repository := NewMockRepository(t)
		hasher := NewMockPasswordHasher(t)
		repository.EXPECT().ByEmail(mock.Anything, "ada@example.com").Return(nil, user.ErrNotFound).Once()
		hasher.EXPECT().Hash("abc").Return(password.Hash{}, password.ErrInvalid).Once()

		_, err := register.New(repository, hasher, time.Now, func() string { return "u1" }).
			Handle(context.Background(), dto.Input{Email: address, Password: "abc"})
		if !errors.Is(err, password.ErrInvalid) {
			t.Fatalf("= %v, want %v", err, password.ErrInvalid)
		}
	})
}
