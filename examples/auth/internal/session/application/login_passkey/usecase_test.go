package login_passkey_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/shortlink-org/portolan/examples/auth/internal/session/application/login"
	"github.com/shortlink-org/portolan/examples/auth/internal/session/application/login_passkey"
	"github.com/shortlink-org/portolan/examples/auth/internal/session/domain"
	"github.com/shortlink-org/portolan/examples/auth/internal/session/domain/event"
	"github.com/shortlink-org/portolan/examples/auth/internal/session/domain/vo/token"
)

var now = time.Date(2026, 9, 15, 12, 0, 0, 0, time.UTC)

type verifier struct {
	userID string
	err    error
}

func (v verifier) Verify(context.Context, login_passkey.Assertion) (string, error) {
	return v.userID, v.err
}

type risk struct{ verdict login.Verdict }

func (r risk) Assess(context.Context, login.Attempt) (login.Verdict, error) { return r.verdict, nil }

// repository records what was saved; nothing else is called by a passkey login.
type repository struct {
	saved  []*session.Session
	events []event.Event
}

func (r *repository) Save(_ context.Context, s *session.Session, events ...event.Event) error {
	r.saved = append(r.saved, s)
	r.events = append(r.events, events...)
	return nil
}

func (r *repository) ByID(context.Context, string) (*session.Session, error) { return nil, session.ErrNotFound }

func (r *repository) ByToken(context.Context, token.Token) (*session.Session, error) {
	return nil, session.ErrNotFound
}

func (r *repository) ByUserID(context.Context, string) ([]*session.Session, error) { return nil, nil }

func useCase(repo *repository, v verifier, verdict login.Verdict) *login_passkey.UseCase {
	return login_passkey.New(repo, v, risk{verdict: verdict}, func() time.Time { return now }, func() string { return "s1" })
}

func TestLoginWithPasskeyStartsAPasskeySession(t *testing.T) {
	repo := &repository{}
	out, err := useCase(repo, verifier{userID: "u1"}, login.VerdictAllow).Handle(context.Background(), login_passkey.Command{CredentialID: "c1", Challenge: "ch", Signature: "sig"})
	if err != nil {
		t.Fatal(err)
	}
	if out.Token == "" || !out.ExpiresAt.After(now) {
		t.Fatalf("result = %+v", out)
	}
	if len(repo.saved) != 1 || repo.saved[0].UserID != "u1" {
		t.Fatalf("saved = %+v", repo.saved)
	}
	started, ok := repo.events[0].(event.SessionStarted)
	if !ok || started.Method() != event.MethodPasskey {
		t.Fatalf("event = %#v", repo.events[0])
	}
}

func TestARejectedAssertionIssuesNothing(t *testing.T) {
	repo := &repository{}
	_, err := useCase(repo, verifier{err: login_passkey.ErrRejected}, login.VerdictAllow).Handle(context.Background(), login_passkey.Command{})
	if !errors.Is(err, login_passkey.ErrRejected) || len(repo.saved) != 0 {
		t.Fatalf("err = %v, saved = %d", err, len(repo.saved))
	}
}

func TestABlockedAttemptIssuesNothing(t *testing.T) {
	repo := &repository{}
	_, err := useCase(repo, verifier{userID: "u1"}, login.VerdictBlock).Handle(context.Background(), login_passkey.Command{})
	if !errors.Is(err, login.ErrBlocked) || len(repo.saved) != 0 {
		t.Fatalf("err = %v, saved = %d", err, len(repo.saved))
	}
}
