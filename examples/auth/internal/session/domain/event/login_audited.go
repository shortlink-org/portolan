package event

import (
	"time"

	ddd "github.com/shortlink-org/portolan/pkg/ddd/event"
)

// LoginAudited is the audit record of a login that issued a session: who, from
// what client, when. It is its own fact rather than a field of SessionStarted
// because the audit trail is kept by somebody else, for longer, and must not
// change shape when the session does.
//
// It carries no credential and nothing about how the credential was checked.
type LoginAudited struct {
	ddd.Base
	userID    string
	userAgent string
}

func NewLoginAudited(sessionID, userID, userAgent string, occurredAt time.Time) LoginAudited {
	return LoginAudited{Base: ddd.New(sessionID, occurredAt), userID: userID, userAgent: userAgent}
}

func (LoginAudited) Name() string { return TopicLoginAudited }

func (e LoginAudited) SessionID() string { return e.AggregateID() }

func (e LoginAudited) UserID() string { return e.userID }

func (e LoginAudited) UserAgent() string { return e.userAgent }
