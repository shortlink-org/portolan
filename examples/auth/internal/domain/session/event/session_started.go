package event

import "time"

// SessionStarted is published on a successful login. ExpiresAt is on the event
// so a consumer can reason about the session's lifetime without asking auth
// again on every check.
type SessionStarted struct {
	sessionID  string
	userID     string
	expiresAt  time.Time
	occurredAt time.Time
}

func NewSessionStarted(sessionID, userID string, expiresAt, occurredAt time.Time) SessionStarted {
	return SessionStarted{
		sessionID:  sessionID,
		userID:     userID,
		expiresAt:  expiresAt,
		occurredAt: occurredAt,
	}
}

func (SessionStarted) Name() string { return "auth.SessionStarted" }

func (e SessionStarted) AggregateID() string { return e.sessionID }

func (e SessionStarted) OccurredAt() time.Time { return e.occurredAt }

func (e SessionStarted) SessionID() string { return e.sessionID }

func (e SessionStarted) UserID() string { return e.userID }

func (e SessionStarted) ExpiresAt() time.Time { return e.expiresAt }
