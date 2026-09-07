package change_password_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/stretchr/testify/mock"

	userapplication "github.com/shortlink-org/portolan/examples/auth/internal/user/application"
	"github.com/shortlink-org/portolan/examples/auth/internal/user/application/change_password"
	"github.com/shortlink-org/portolan/examples/auth/internal/user/domain"
	"github.com/shortlink-org/portolan/examples/auth/internal/user/domain/event"
	"github.com/shortlink-org/portolan/examples/auth/internal/user/domain/vo/password"
)

var now = time.Date(2026, 3, 1, 12, 0, 0, 0, time.UTC)

const (
	current = "Passw0rdish"
	next    = "NewPassw0rd"
)

func hashes(t testing.TB) (password.Hash, password.Hash) {
	t.Helper()
	currentHash, err := password.ParseHash("test$1$01$02")
	if err != nil {
		t.Fatal(err)
	}
	nextHash, err := password.ParseHash("test$1$03$04")
	if err != nil {
		t.Fatal(err)
	}
	return currentHash, nextHash
}

func existingUser(t testing.TB) *user.User {
	t.Helper()
	currentHash, _ := hashes(t)
	u, _, err := user.Register("u1", "ada@example.com", currentHash, now)
	if err != nil {
		t.Fatal(err)
	}
	return u
}

func TestChangePassword(t *testing.T) {
	u := existingUser(t)
	_, nextHash := hashes(t)
	repository := NewMockRepository(t)
	hasher := NewMockPasswordHasher(t)

	repository.EXPECT().ByID(mock.Anything, "u1").Return(u, nil).Once()
	hasher.EXPECT().Verify(current, u.Password).Return(true).Once()
	hasher.EXPECT().Hash(next).Return(nextHash, nil).Once()
	repository.EXPECT().Save(mock.Anything, mock.Anything, mock.Anything).
		RunAndReturn(func(_ context.Context, stored *user.User, events ...event.Event) error {
			if stored.Password != nextHash {
				t.Error("the replacement hash was not stored")
			}
			if len(events) != 1 {
				t.Fatalf("events = %v, want one PasswordChanged", events)
			}
			changed, ok := events[0].(event.PasswordChanged)
			if !ok || changed.By() != "s1" {
				t.Errorf("event = %#v, want PasswordChanged by s1", events[0])
			}
			return nil
		}).Once()

	err := change_password.New(repository, hasher, func() time.Time { return now }).Handle(
		context.Background(), change_password.Command{UserID: "u1", By: "s1", Current: current, New: next})
	if err != nil {
		t.Fatal(err)
	}
}

func TestWrongCurrentWritesNothing(t *testing.T) {
	u := existingUser(t)
	repository := NewMockRepository(t)
	hasher := NewMockPasswordHasher(t)
	repository.EXPECT().ByID(mock.Anything, "u1").Return(u, nil).Once()
	hasher.EXPECT().Verify("Wr0ngGuess", u.Password).Return(false).Once()

	err := change_password.New(repository, hasher, func() time.Time { return now }).Handle(
		context.Background(), change_password.Command{UserID: "u1", Current: "Wr0ngGuess", New: next})
	if !errors.Is(err, userapplication.ErrInvalidCredentials) || err.Error() != userapplication.ErrInvalidCredentials.Error() {
		t.Fatalf("= %v, want the plain credential refusal", err)
	}
}

func TestWeakNewPasswordWritesNothing(t *testing.T) {
	u := existingUser(t)
	repository := NewMockRepository(t)
	hasher := NewMockPasswordHasher(t)
	repository.EXPECT().ByID(mock.Anything, "u1").Return(u, nil).Once()
	hasher.EXPECT().Verify(current, u.Password).Return(true).Once()
	hasher.EXPECT().Hash("abc").Return(password.Hash{}, password.ErrInvalid).Once()

	err := change_password.New(repository, hasher, func() time.Time { return now }).Handle(
		context.Background(), change_password.Command{UserID: "u1", Current: current, New: "abc"})
	if !errors.Is(err, password.ErrInvalid) {
		t.Fatalf("= %v, want %v", err, password.ErrInvalid)
	}
}

func TestUnknownUser(t *testing.T) {
	repository := NewMockRepository(t)
	hasher := NewMockPasswordHasher(t)
	repository.EXPECT().ByID(mock.Anything, "nobody").Return(nil, user.ErrNotFound).Once()

	err := change_password.New(repository, hasher, time.Now).Handle(
		context.Background(), change_password.Command{UserID: "nobody", Current: current, New: next})
	if !errors.Is(err, user.ErrNotFound) {
		t.Fatalf("= %v, want ErrNotFound", err)
	}
}
