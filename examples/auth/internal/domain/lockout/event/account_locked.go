package event

import "time"

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
	userID     string
	until      time.Time
	occurredAt time.Time
}

func NewAccountLocked(userID string, until, occurredAt time.Time) AccountLocked {
	return AccountLocked{userID: userID, until: until, occurredAt: occurredAt}
}

func (AccountLocked) Name() string { return TopicAccountLocked }

func (e AccountLocked) AggregateID() string { return e.userID }

func (e AccountLocked) OccurredAt() time.Time { return e.occurredAt }

func (e AccountLocked) UserID() string { return e.userID }

// Until is when the account accepts a password again.
func (e AccountLocked) Until() time.Time { return e.until }
