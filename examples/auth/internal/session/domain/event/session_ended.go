package event

import (
	"time"

	ddd "github.com/shortlink-org/portolan/pkg/ddd/event"
)

// Reason says why a session stopped being usable. It is a closed set: a
// consumer that switches on it should not have to handle free text.
type Reason string

const (
	// ReasonLogout - the user asked.
	ReasonLogout Reason = "logout"
	// ReasonRevoked - somebody else ended it, support or an admin.
	ReasonRevoked Reason = "revoked"
	// ReasonPasswordChanged - the credentials it was issued against are gone.
	//
	// Worth telling apart from the others: a client that shows "you were signed
	// out because the password changed" is explaining something the person did,
	// while "your session expired" would be a lie.
	ReasonPasswordChanged Reason = "password-changed"
	// ReasonRiskBlocked - a login attempt was judged hostile, and every session
	// the account had is treated as the attacker's. Told apart from the rest
	// so that a client can say "sign in again" rather than "you signed out".
	ReasonRiskBlocked Reason = "risk-blocked"
)

// SessionEnded is published when a session is deliberately ended.
//
// Expiry does not produce one. Nothing happens when a session runs out of time:
// no code runs, nobody decided anything, and every consumer already knows the
// expiry from SessionStarted. An event here would be an invention, published by
// whichever sweep noticed first.
// See docs/adr/0003-expiry-publishes-nothing.md.
type SessionEnded struct {
	ddd.Base
	userID string
	reason Reason
}

func NewSessionEnded(sessionID, userID string, reason Reason, occurredAt time.Time) SessionEnded {
	return SessionEnded{
		Base:   ddd.New(sessionID, occurredAt),
		userID: userID,
		reason: reason,
	}
}

func (SessionEnded) Name() string { return TopicSessionEnded }

func (e SessionEnded) SessionID() string { return e.AggregateID() }

func (e SessionEnded) UserID() string { return e.userID }

func (e SessionEnded) Reason() Reason { return e.reason }
