package event

import (
	"time"

	ddd "github.com/shortlink-org/portolan/pkg/ddd/event"
)

// SessionStarted is published on a successful login. ExpiresAt is on the event
// so a consumer can reason about the session's lifetime without asking auth
// again on every check. UserAgent is what the client called itself, so a
// person looking at their sessions can tell their laptop from their phone.
type SessionStarted struct {
	ddd.Base
	userID    string
	userAgent string
	expiresAt time.Time
}

func NewSessionStarted(sessionID, userID, userAgent string, expiresAt, occurredAt time.Time) SessionStarted {
	return SessionStarted{
		Base:      ddd.New(sessionID, occurredAt),
		userID:    userID,
		userAgent: userAgent,
		expiresAt: expiresAt,
	}
}

func (SessionStarted) Name() string { return TopicSessionStarted }

func (e SessionStarted) SessionID() string { return e.AggregateID() }

func (e SessionStarted) UserID() string { return e.userID }

func (e SessionStarted) UserAgent() string { return e.userAgent }

func (e SessionStarted) ExpiresAt() time.Time { return e.expiresAt }
