package validate_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/stretchr/testify/mock"

	"github.com/shortlink-org/portolan/examples/auth/internal/session/application/validate"
	"github.com/shortlink-org/portolan/examples/auth/internal/session/application/validate/dto"
	"github.com/shortlink-org/portolan/examples/auth/internal/session/domain"
	"github.com/shortlink-org/portolan/examples/auth/internal/session/domain/event"
)

var now = time.Date(2026, 3, 1, 12, 0, 0, 0, time.UTC)

func storedSession(t testing.TB) *session.Session {
	t.Helper()
	s, _, err := session.Start("s1", "u1", now)
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func TestValidate(t *testing.T) {
	s := storedSession(t)
	repository := NewMockRepository(t)
	repository.EXPECT().ByToken(mock.Anything, s.Token).Return(s, nil).Once()

	out, err := validate.New(repository, func() time.Time { return now }).Handle(
		context.Background(), dto.Input{Token: s.Token.String()})
	if err != nil {
		t.Fatal(err)
	}
	if out.UserID != "u1" || out.SessionID != "s1" || !out.ExpiresAt.Equal(s.ExpiresAt) {
		t.Errorf("out = %+v", out)
	}
}

func TestExpired(t *testing.T) {
	s := storedSession(t)
	repository := NewMockRepository(t)
	repository.EXPECT().ByToken(mock.Anything, s.Token).Return(s, nil).Once()

	_, err := validate.New(repository, func() time.Time { return now.Add(session.TTL + time.Second) }).Handle(
		context.Background(), dto.Input{Token: s.Token.String()})
	if !errors.Is(err, session.ErrExpired) {
		t.Fatalf("= %v, want ErrExpired", err)
	}
}

func TestRevoked(t *testing.T) {
	s := storedSession(t)
	s.Revoke(event.ReasonLogout, now)
	repository := NewMockRepository(t)
	repository.EXPECT().ByToken(mock.Anything, s.Token).Return(s, nil).Once()

	_, err := validate.New(repository, func() time.Time { return now }).Handle(
		context.Background(), dto.Input{Token: s.Token.String()})
	if !errors.Is(err, session.ErrRevoked) {
		t.Fatalf("= %v, want ErrRevoked", err)
	}
}

func TestMalformedIsReportedAsUnknown(t *testing.T) {
	uc := validate.New(NewMockRepository(t), func() time.Time { return now })
	for _, raw := range []string{"", "....", "YWJj"} {
		if _, err := uc.Handle(context.Background(), dto.Input{Token: raw}); !errors.Is(err, session.ErrNotFound) {
			t.Errorf("%q = %v, want ErrNotFound", raw, err)
		}
	}
}

func TestValidateDoesNotWrite(t *testing.T) {
	s := storedSession(t)
	repository := NewMockRepository(t)
	repository.EXPECT().ByToken(mock.Anything, s.Token).Return(s, nil).Once()

	if _, err := validate.New(repository, func() time.Time { return now }).Handle(
		context.Background(), dto.Input{Token: s.Token.String()}); err != nil {
		t.Fatal(err)
	}
}
