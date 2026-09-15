package event

import (
	"time"

	ddd "github.com/shortlink-org/portolan/pkg/ddd/event"
)

// Method is how the person proved who they are before the session was issued.
// A closed set, like Reason: a consumer that switches on it should not have to
// handle free text.
type Method string

const (
	// MethodPassword - an address and a password the user domain vouched for.
	MethodPassword Method = "password"
	// MethodPasskey - an assertion signed by a passkey the verifier accepted.
	MethodPasskey Method = "passkey"
)

// SessionStarted is published on a successful login. ExpiresAt is on the event
// so a consumer can reason about the session's lifetime without asking auth
// again on every check; Method is on it so one can tell a passkey login from a
// password one without asking either.
type SessionStarted struct {
	ddd.Base
	userID    string
	method    Method
	expiresAt time.Time
}

func NewSessionStarted(sessionID, userID string, method Method, expiresAt, occurredAt time.Time) SessionStarted {
	return SessionStarted{
		Base:      ddd.New(sessionID, occurredAt),
		userID:    userID,
		method:    method,
		expiresAt: expiresAt,
	}
}

func (SessionStarted) Name() string { return TopicSessionStarted }

func (e SessionStarted) SessionID() string { return e.AggregateID() }

func (e SessionStarted) UserID() string { return e.userID }

func (e SessionStarted) Method() Method { return e.method }

func (e SessionStarted) ExpiresAt() time.Time { return e.expiresAt }
