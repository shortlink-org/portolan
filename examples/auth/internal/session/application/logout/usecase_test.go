package logout_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/stretchr/testify/mock"

	"github.com/shortlink-org/portolan/examples/auth/internal/session/application/logout"
	"github.com/shortlink-org/portolan/examples/auth/internal/session/domain"
	"github.com/shortlink-org/portolan/examples/auth/internal/session/domain/event"
)

var now = time.Date(2026, 3, 1, 12, 0, 0, 0, time.UTC)

func liveSession(t testing.TB) *session.Session {
	t.Helper()
	s, _, err := session.Start("s1", "u1", now)
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func TestLogout(t *testing.T) {
	s := liveSession(t)
	repository := NewMockRepository(t)
	repository.EXPECT().ByToken(mock.Anything, s.Token).Return(s, nil).Once()
	repository.EXPECT().Save(mock.Anything, s, mock.Anything).
		RunAndReturn(func(_ context.Context, stored *session.Session, events ...event.Event) error {
			if err := stored.Validate(now); !errors.Is(err, session.ErrRevoked) {
				t.Errorf("Validate = %v, want ErrRevoked", err)
			}
			if len(events) != 1 || events[0].Name() != "auth.SessionEnded" {
				t.Errorf("events = %v, want one SessionEnded", events)
			}
			return nil
		}).Once()

	if err := logout.New(repository, func() time.Time { return now }).Handle(
		context.Background(), logout.Command{Token: s.Token.String()}); err != nil {
		t.Fatal(err)
	}
}

func TestUnknownTokensSucceedSilently(t *testing.T) {
	t.Run("malformed", func(t *testing.T) {
		if err := logout.New(NewMockRepository(t), time.Now).Handle(context.Background(), logout.Command{Token: "...."}); err != nil {
			t.Fatal(err)
		}
	})

	t.Run("unknown", func(t *testing.T) {
		s := liveSession(t)
		repository := NewMockRepository(t)
		repository.EXPECT().ByToken(mock.Anything, s.Token).Return(nil, session.ErrNotFound).Once()
		if err := logout.New(repository, time.Now).Handle(context.Background(), logout.Command{Token: s.Token.String()}); err != nil {
			t.Fatal(err)
		}
	})
}

func TestSecondLogoutAnnouncesNothing(t *testing.T) {
	s := liveSession(t)
	repository := NewMockRepository(t)
	repository.EXPECT().ByToken(mock.Anything, s.Token).Return(s, nil).Twice()
	repository.EXPECT().Save(mock.Anything, s, mock.Anything).Return(nil).Once()
	uc := logout.New(repository, func() time.Time { return now })

	if err := uc.Handle(context.Background(), logout.Command{Token: s.Token.String()}); err != nil {
		t.Fatal(err)
	}
	if err := uc.Handle(context.Background(), logout.Command{Token: s.Token.String()}); err != nil {
		t.Fatal(err)
	}
}
