package end_after_credential_change_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/stretchr/testify/mock"

	"github.com/shortlink-org/portolan/examples/auth/internal/session/application/end_after_credential_change"
	"github.com/shortlink-org/portolan/examples/auth/internal/session/domain"
	"github.com/shortlink-org/portolan/examples/auth/internal/session/domain/event"
)

var change = time.Date(2026, 3, 1, 12, 0, 0, 0, time.UTC)

func started(t testing.TB, id string, at time.Time) *session.Session {
	t.Helper()
	s, _, err := session.Start(id, "u1", at)
	if err != nil {
		t.Fatal(err)
	}
	s.Version = 1
	return s
}

func TestEndsWhatTheServiceSelected(t *testing.T) {
	laptop := started(t, "laptop", change.Add(-time.Hour))
	phone := started(t, "phone", change.Add(-time.Hour))
	fresh := started(t, "fresh", change.Add(time.Minute))
	repository := NewMockRepository(t)
	repository.EXPECT().ByUserID(mock.Anything, "u1").Return([]*session.Session{laptop, phone, fresh}, nil).Once()
	repository.EXPECT().ByID(mock.Anything, "phone").Return(phone.Clone(), nil).Once()
	repository.EXPECT().Save(mock.Anything, mock.MatchedBy(func(s *session.Session) bool {
		return s.ID == "phone" && !s.RevokedAt.IsZero()
	}), mock.Anything).RunAndReturn(func(_ context.Context, _ *session.Session, events ...event.Event) error {
		ended, ok := events[0].(event.SessionEnded)
		if !ok || ended.Reason() != event.ReasonPasswordChanged {
			t.Errorf("event = %#v, want password-changed", events[0])
		}
		return nil
	}).Once()

	err := end_after_credential_change.New(repository, func() time.Time { return change.Add(time.Hour) }).Handle(
		context.Background(), end_after_credential_change.Command{UserID: "u1", ChangedAt: change, Keep: "laptop"})
	if err != nil {
		t.Fatal(err)
	}
}

func TestEachSessionIsSavedOnItsOwn(t *testing.T) {
	a := started(t, "a", change.Add(-time.Hour))
	b := started(t, "b", change.Add(-time.Hour))
	repository := NewMockRepository(t)
	repository.EXPECT().ByUserID(mock.Anything, "u1").Return([]*session.Session{a, b}, nil).Once()
	for _, s := range []*session.Session{a, b} {
		repository.EXPECT().ByID(mock.Anything, s.ID).Return(s.Clone(), nil).Once()
		repository.EXPECT().Save(mock.Anything, mock.MatchedBy(func(got *session.Session) bool {
			return got.ID == s.ID
		}), mock.Anything).Return(nil).Once()
	}

	if err := end_after_credential_change.New(repository, func() time.Time { return change }).Handle(
		context.Background(), end_after_credential_change.Command{UserID: "u1", ChangedAt: change}); err != nil {
		t.Fatal(err)
	}
}

func TestConflictReloadsTheSession(t *testing.T) {
	initial := started(t, "phone", change.Add(-time.Hour))
	winner := initial.Clone()
	winner.Version++
	repository := NewMockRepository(t)
	repository.EXPECT().ByUserID(mock.Anything, "u1").Return([]*session.Session{initial}, nil).Once()
	repository.EXPECT().ByID(mock.Anything, "phone").Return(initial.Clone(), nil).Once()
	repository.EXPECT().Save(mock.Anything, mock.Anything, mock.Anything).Return(session.ErrConflict).Once()
	repository.EXPECT().ByID(mock.Anything, "phone").Return(winner, nil).Once()
	repository.EXPECT().Save(mock.Anything, mock.Anything, mock.Anything).Return(nil).Once()

	if err := end_after_credential_change.New(repository, func() time.Time { return change }).Handle(
		context.Background(), end_after_credential_change.Command{UserID: "u1", ChangedAt: change}); err != nil {
		t.Fatal(err)
	}
}

func TestSessionEndedBySomebodyElseIsLeftAlone(t *testing.T) {
	s := started(t, "phone", change.Add(-time.Hour))
	s.Revoke(event.ReasonLogout, change.Add(-time.Minute))
	repository := NewMockRepository(t)
	repository.EXPECT().ByUserID(mock.Anything, "u1").Return([]*session.Session{s}, nil).Once()

	if err := end_after_credential_change.New(repository, func() time.Time { return change }).Handle(
		context.Background(), end_after_credential_change.Command{UserID: "u1", ChangedAt: change}); err != nil {
		t.Fatal(err)
	}
}

func TestUserWithNothingOpen(t *testing.T) {
	repository := NewMockRepository(t)
	repository.EXPECT().ByUserID(mock.Anything, "nobody").Return(nil, nil).Once()
	if err := end_after_credential_change.New(repository, func() time.Time { return change }).Handle(
		context.Background(), end_after_credential_change.Command{UserID: "nobody", ChangedAt: change}); err != nil {
		t.Fatal(err)
	}
}

func TestRepositoryFailureIsReturned(t *testing.T) {
	boom := errors.New("store is down")
	repository := NewMockRepository(t)
	repository.EXPECT().ByUserID(mock.Anything, "u1").Return(nil, boom).Once()
	if err := end_after_credential_change.New(repository, time.Now).Handle(
		context.Background(), end_after_credential_change.Command{UserID: "u1", ChangedAt: change}); !errors.Is(err, boom) {
		t.Fatalf("= %v, want %v", err, boom)
	}
}
