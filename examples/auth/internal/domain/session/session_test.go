package session_test

import (
	"testing"
	"time"

	"github.com/shortlink-org/portolan/examples/auth/internal/domain/session"
	"github.com/shortlink-org/portolan/examples/auth/internal/domain/session/event"
)

var now = time.Date(2026, 3, 1, 12, 0, 0, 0, time.UTC)

func start(t *testing.T) (*session.Session, event.SessionStarted) {
	t.Helper()
	s, ev, err := session.Start("s1", "u1", now)
	if err != nil {
		t.Fatal(err)
	}
	return s, ev
}

func TestStart(t *testing.T) {
	s, ev := start(t)

	if s.UserID != "u1" {
		t.Errorf("userID = %q, want u1", s.UserID)
	}
	if s.Token.IsZero() {
		t.Error("a session should carry a token")
	}
	if want := now.Add(session.TTL); !s.ExpiresAt.Equal(want) {
		t.Errorf("expiresAt = %v, want %v", s.ExpiresAt, want)
	}
	if !s.RevokedAt.IsZero() {
		t.Error("a fresh session is not revoked")
	}
	if ev.SessionID() != "s1" || ev.UserID() != "u1" {
		t.Errorf("event = %+v, want it to describe the session", ev)
	}
	if !ev.ExpiresAt().Equal(s.ExpiresAt) {
		t.Error("the event should carry the same expiry as the session")
	}
}

// Two sessions never share a token, or one logout would end both.
func TestStartMintsAFreshToken(t *testing.T) {
	a, _, _ := session.Start("s1", "u1", now)
	b, _, _ := session.Start("s2", "u1", now)
	if a.Token.Equal(b.Token) {
		t.Fatal("two sessions were given the same token")
	}
}

func TestValidateAtTheExpiryBoundary(t *testing.T) {
	s, _ := start(t)
	expiry := s.ExpiresAt

	if err := s.Validate(expiry.Add(-time.Second)); err != nil {
		t.Errorf("a second before expiry the session is live: %v", err)
	}
	// The boundary itself is past: ExpiresAt is when it stops working, not the
	// last moment it works.
	if err := s.Validate(expiry); err != session.ErrExpired {
		t.Errorf("at expiry = %v, want ErrExpired", err)
	}
	if err := s.Validate(expiry.Add(time.Second)); err != session.ErrExpired {
		t.Errorf("after expiry = %v, want ErrExpired", err)
	}
}

func TestLiveAgreesWithValidate(t *testing.T) {
	s, _ := start(t)
	for _, at := range []time.Time{now, s.ExpiresAt.Add(-time.Second), s.ExpiresAt, s.ExpiresAt.Add(time.Hour)} {
		if live, err := s.Live(at), s.Validate(at); live != (err == nil) {
			t.Errorf("at %v: Live = %v but Validate = %v", at, live, err)
		}
	}
}

func TestRevoke(t *testing.T) {
	s, _ := start(t)

	ev, ended := s.Revoke(event.ReasonLogout, now)
	if !ended {
		t.Fatal("revoking a live session ends it")
	}
	if ev.SessionID() != "s1" || ev.Reason() != event.ReasonLogout {
		t.Errorf("event = %+v, want it to name the session and the reason", ev)
	}
	if err := s.Validate(now); err != session.ErrRevoked {
		t.Errorf("after revocation = %v, want ErrRevoked", err)
	}
}

// Revoking twice is not an error, but it is not a second ending either: the
// bool is what stops a duplicate event being published.
func TestRevokeIsIdempotent(t *testing.T) {
	s, _ := start(t)
	s.Revoke(event.ReasonLogout, now)

	first := s.RevokedAt
	_, ended := s.Revoke(event.ReasonRevoked, now.Add(time.Hour))

	if ended {
		t.Error("the second revocation ended nothing and must not say it did")
	}
	if !s.RevokedAt.Equal(first) {
		t.Error("the second revocation moved the revocation time")
	}
}

// Revocation beats expiry: a session that was taken away was not merely
// forgotten, and the two are answered differently.
func TestRevokedBeatsExpired(t *testing.T) {
	s, _ := start(t)
	s.Revoke(event.ReasonLogout, now)
	if err := s.Validate(s.ExpiresAt.Add(time.Hour)); err != session.ErrRevoked {
		t.Errorf("= %v, want ErrRevoked", err)
	}
}

func TestCloneSharesNothingMutable(t *testing.T) {
	s, _ := start(t)
	clone := s.Clone()

	if clone == s {
		t.Fatal("Clone returned the same pointer")
	}
	clone.Revoke(event.ReasonLogout, now)
	if !s.RevokedAt.IsZero() {
		t.Error("revoking the clone revoked the original")
	}
}

func TestCloneOfNil(t *testing.T) {
	var s *session.Session
	if s.Clone() != nil {
		t.Error("cloning nothing should give nothing")
	}
}
