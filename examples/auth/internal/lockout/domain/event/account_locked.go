package event

import (
	"time"

	ddd "github.com/shortlink-org/portolan/pkg/ddd/event"
)

// AccountLocked is published when an account starts refusing logins because
// of too many wrong passwords in a row. Until says when it stops.
//
// It is the only event this domain has. A wrong password that did not lock
// anything is a count, not a fact with a consumer; the lock running out is
// time passing, and nothing runs when it does - see docs/adr/0003 for the same
// reasoning about session expiry. A consumer who wants to know when the
// account is usable again reads Until.
//
// It carries no password, right or wrong, and nothing about which guesses
// were made.
type AccountLocked struct {
	ddd.Base
	until time.Time
}

func NewAccountLocked(userID string, until, occurredAt time.Time) AccountLocked {
	return AccountLocked{Base: ddd.New(userID, occurredAt), until: until}
}

func (AccountLocked) Name() string { return TopicAccountLocked }

func (e AccountLocked) UserID() string { return e.AggregateID() }

// Until is when the account accepts a password again.
func (e AccountLocked) Until() time.Time { return e.until }
