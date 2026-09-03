package event

import "time"

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
type SessionEnded struct {
	sessionID  string
	userID     string
	reason     Reason
	occurredAt time.Time
}

func NewSessionEnded(sessionID, userID string, reason Reason, occurredAt time.Time) SessionEnded {
	return SessionEnded{
		sessionID:  sessionID,
		userID:     userID,
		reason:     reason,
		occurredAt: occurredAt,
	}
}

func (SessionEnded) Name() string { return "auth.SessionEnded" }

func (e SessionEnded) AggregateID() string { return e.sessionID }

func (e SessionEnded) OccurredAt() time.Time { return e.occurredAt }

func (e SessionEnded) SessionID() string { return e.sessionID }

func (e SessionEnded) UserID() string { return e.userID }

func (e SessionEnded) Reason() Reason { return e.reason }
