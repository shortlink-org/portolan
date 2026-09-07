package login_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/stretchr/testify/mock"

	"github.com/shortlink-org/portolan/examples/auth/internal/session/application/login"
	"github.com/shortlink-org/portolan/examples/auth/internal/session/application/login/dto"
	"github.com/shortlink-org/portolan/examples/auth/internal/session/domain"
	"github.com/shortlink-org/portolan/examples/auth/internal/session/domain/event"
)

var now = time.Date(2026, 3, 1, 12, 0, 0, 0, time.UTC)

var errInvalidCredentials = errors.New("invalid credentials")

func sessionAt(t testing.TB, id, userID string, at time.Time) *session.Session {
	t.Helper()
	s, _, err := session.Start(id, userID, at)
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func TestLogin(t *testing.T) {
	repository := NewMockRepository(t)
	authenticator := NewMockAuthenticator(t)
	risk := NewMockRisk(t)
	authenticator.EXPECT().Authenticate(mock.Anything, "ada@example.com", "Passw0rdish").Return("u1", nil).Once()
	risk.EXPECT().Assess(mock.Anything, login.Attempt{UserID: "u1"}).Return(login.VerdictAllow, nil).Once()
	repository.EXPECT().Save(mock.Anything, mock.Anything, mock.Anything).
		RunAndReturn(func(_ context.Context, stored *session.Session, events ...event.Event) error {
			if stored.ID != "s1" || stored.UserID != "u1" || !stored.IssuedAt.Equal(now) {
				t.Errorf("stored = %+v", stored)
			}
			if len(events) != 1 || events[0].Name() != "auth.SessionStarted" {
				t.Errorf("events = %v, want SessionStarted", events)
			}
			return nil
		}).Once()

	out, err := login.New(repository, authenticator, risk, func() time.Time { return now }, func() string { return "s1" }).
		Handle(context.Background(), dto.Input{Email: "ada@example.com", Password: "Passw0rdish"})
	if err != nil {
		t.Fatal(err)
	}
	if out.Token == "" || !out.ExpiresAt.Equal(now.Add(session.TTL)) {
		t.Errorf("out = %+v", out)
	}
}

func TestNoSessionWithoutTheAuthenticator(t *testing.T) {
	repository := NewMockRepository(t)
	authenticator := NewMockAuthenticator(t)
	risk := NewMockRisk(t)
	authenticator.EXPECT().Authenticate(mock.Anything, "ada@example.com", "wrong").
		Return("", errInvalidCredentials).Once()

	out, err := login.New(repository, authenticator, risk, time.Now, func() string { return "unused" }).
		Handle(context.Background(), dto.Input{Email: "ada@example.com", Password: "wrong"})
	if !errors.Is(err, errInvalidCredentials) || out.Token != "" {
		t.Fatalf("out = %+v, err = %v", out, err)
	}
}

func TestAuthenticatorFailureIsNotRewritten(t *testing.T) {
	boom := errors.New("the identity store is down")
	repository := NewMockRepository(t)
	authenticator := NewMockAuthenticator(t)
	risk := NewMockRisk(t)
	authenticator.EXPECT().Authenticate(mock.Anything, "a@b.co", "x").Return("", boom).Once()

	_, err := login.New(repository, authenticator, risk, time.Now, func() string { return "unused" }).
		Handle(context.Background(), dto.Input{Email: "a@b.co", Password: "x"})
	if !errors.Is(err, boom) {
		t.Fatalf("= %v, want %v", err, boom)
	}
}

func TestEachLoginIsItsOwnSession(t *testing.T) {
	repository := NewMockRepository(t)
	authenticator := NewMockAuthenticator(t)
	risk := NewMockRisk(t)
	authenticator.EXPECT().Authenticate(mock.Anything, mock.Anything, mock.Anything).Return("u1", nil).Twice()
	risk.EXPECT().Assess(mock.Anything, login.Attempt{UserID: "u1"}).Return(login.VerdictAllow, nil).Twice()

	var tokens []string
	repository.EXPECT().Save(mock.Anything, mock.Anything, mock.Anything).
		RunAndReturn(func(_ context.Context, stored *session.Session, _ ...event.Event) error {
			tokens = append(tokens, stored.Token.String())
			return nil
		}).Twice()

	ids := 0
	uc := login.New(repository, authenticator, risk, func() time.Time { return now }, func() string {
		ids++
		return string(rune('0' + ids))
	})
	for range 2 {
		if _, err := uc.Handle(context.Background(), dto.Input{Email: "a", Password: "b"}); err != nil {
			t.Fatal(err)
		}
	}
	if len(tokens) != 2 || tokens[0] == tokens[1] {
		t.Fatalf("tokens = %v, want two independent credentials", tokens)
	}
}

func TestABlockedAttemptEndsEverySessionFirst(t *testing.T) {
	existing := sessionAt(t, "s1", "u1", now.Add(-time.Hour))
	repository := NewMockRepository(t)
	authenticator := NewMockAuthenticator(t)
	risk := NewMockRisk(t)
	authenticator.EXPECT().Authenticate(mock.Anything, mock.Anything, mock.Anything).Return("u1", nil).Once()
	risk.EXPECT().Assess(mock.Anything, login.Attempt{UserID: "u1"}).Return(login.VerdictBlock, nil).Once()
	repository.EXPECT().ByUserID(mock.Anything, "u1").Return([]*session.Session{existing}, nil).Once()
	repository.EXPECT().Save(mock.Anything, existing, mock.Anything).
		RunAndReturn(func(_ context.Context, stored *session.Session, events ...event.Event) error {
			if stored.RevokedAt.IsZero() {
				t.Error("the existing session is still live")
			}
			ended, ok := events[0].(event.SessionEnded)
			if !ok || ended.Reason() != event.ReasonRiskBlocked {
				t.Errorf("event = %#v, want risk-blocked", events[0])
			}
			return nil
		}).Once()

	out, err := login.New(repository, authenticator, risk, func() time.Time { return now }, func() string { return "unused" }).
		Handle(context.Background(), dto.Input{})
	if !errors.Is(err, login.ErrBlocked) || out.Token != "" {
		t.Fatalf("out = %+v, err = %v", out, err)
	}
}

func TestRiskBeingDownIssuesNothing(t *testing.T) {
	boom := errors.New("risk is down")
	repository := NewMockRepository(t)
	authenticator := NewMockAuthenticator(t)
	risk := NewMockRisk(t)
	authenticator.EXPECT().Authenticate(mock.Anything, mock.Anything, mock.Anything).Return("u1", nil).Once()
	risk.EXPECT().Assess(mock.Anything, login.Attempt{UserID: "u1"}).Return(login.Verdict(""), boom).Once()

	_, err := login.New(repository, authenticator, risk, time.Now, func() string { return "unused" }).
		Handle(context.Background(), dto.Input{})
	if !errors.Is(err, boom) {
		t.Fatalf("= %v, want %v", err, boom)
	}
}
