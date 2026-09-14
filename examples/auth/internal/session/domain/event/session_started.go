package event

import (
	"time"

	ddd "github.com/shortlink-org/portolan/pkg/ddd/event"
)

// SessionStarted is published on a successful login. ExpiresAt is on the event
// so a consumer can reason about the session's lifetime without asking auth
// again on every check.
type SessionStarted struct {
	ddd.Base
	userID    string
	expiresAt time.Time
}

func NewSessionStarted(sessionID, userID string, expiresAt, occurredAt time.Time) SessionStarted {
	return SessionStarted{
		Base:      ddd.New(sessionID, occurredAt),
		userID:    userID,
		expiresAt: expiresAt,
	}
}

func (SessionStarted) Name() string { return TopicSessionStarted }

func (e SessionStarted) SessionID() string { return e.AggregateID() }

func (e SessionStarted) UserID() string { return e.userID }

func (e SessionStarted) ExpiresAt() time.Time { return e.expiresAt }
