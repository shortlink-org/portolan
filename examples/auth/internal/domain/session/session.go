// Package session holds the Session aggregate: proof that a user logged in,
// how long that proof is good for, and whether it has been taken away.
//
// It is a separate aggregate from User on purpose. A session is written far
// more often than a user, and it is revoked without the user changing at all,
// so the two do not belong under one lock. They are linked by UserID only.
package session

import (
	"errors"
	"time"

	"github.com/shortlink-org/portolan/examples/auth/internal/domain/session/event"
	"github.com/shortlink-org/portolan/examples/auth/internal/domain/session/vo/token"
)

var (
	ErrNotFound = errors.New("session: not found")
	ErrExpired  = errors.New("session: expired")
	ErrRevoked  = errors.New("session: revoked")
)

// TTL is how long a session is good for. One value, no per-user override.
const TTL = 24 * time.Hour

// Session is the aggregate root. Its identity is ID; the Token is a secret it
// carries, not what it is called.
type Session struct {
	ID        string
	UserID    string
	Token     token.Token
	IssuedAt  time.Time
	ExpiresAt time.Time
	RevokedAt time.Time // zero while live
}

// Start mints a session for a user who has already been authenticated, and
// returns the fact alongside it. This aggregate does not check passwords and
// never sees one.
func Start(id, userID string, now time.Time) (*Session, event.SessionStarted, error) {
	minted, err := token.New()
	if err != nil {
		return nil, event.SessionStarted{}, err
	}
	s := &Session{
		ID:        id,
		UserID:    userID,
		Token:     minted,
		IssuedAt:  now,
		ExpiresAt: now.Add(TTL),
	}
	return s, event.NewSessionStarted(id, userID, s.ExpiresAt, now), nil
}

// Live reports whether the session may still be used at `now`.
func (s *Session) Live(now time.Time) bool {
	return s.RevokedAt.IsZero() && now.Before(s.ExpiresAt)
}

// Validate is the read path: it says why a session cannot be used, or nothing.
func (s *Session) Validate(now time.Time) error {
	if !s.RevokedAt.IsZero() {
		return ErrRevoked
	}
	if !now.Before(s.ExpiresAt) {
		return ErrExpired
	}
	return nil
}

// Revoke ends the session and returns the fact. The bool is false when there
// was nothing to do: revoking twice is idempotent, and the second call did not
// end anything, so it must not announce that it did.
//
// A revoked session never comes back - logging in again produces a new one.
func (s *Session) Revoke(reason event.Reason, now time.Time) (event.SessionEnded, bool) {
	if !s.RevokedAt.IsZero() {
		return event.SessionEnded{}, false
	}
	s.RevokedAt = now
	return event.NewSessionEnded(s.ID, s.UserID, reason, now), true
}
