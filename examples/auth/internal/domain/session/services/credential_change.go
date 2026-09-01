// Package services holds the domain services of the session domain: decisions
// that belong to the domain but sit on no single aggregate.
//
// Everything here is pure. A service is handed the aggregates it reasons about
// and returns an answer; loading them and writing the outcome is the caller's
// job. That is what keeps a decision testable without a store, and what stops
// this package from becoming a second home for use cases.
//
// Note the direction: services imports session, never the other way round. An
// aggregate does not call its own domain service - somebody outside does.
package services

import (
	"time"

	"github.com/shortlink-org/portolan/examples/auth/internal/domain/session"
)

// CredentialChange is what replacing a user's credentials means for the
// sessions issued against them.
//
// It is a domain service rather than a loop in a use case because there is a
// decision in it, and the decision is not obvious. "Revoke everything" is the
// wrong answer for at least two reasons that only show up once written down.
type CredentialChange struct {
	// At is when the credentials changed - taken from the event, never from the
	// clock. The two differ once anything is delivered asynchronously, and the
	// difference is exactly the sessions started in between.
	At time.Time

	// Keep is a session to spare: the one the change was made from, so that
	// somebody changing their password is not signed out of the device they are
	// holding. Empty spares none, which is what an administrative reset wants.
	Keep string
}

// Ends returns the sessions this change puts an end to.
//
// Three kinds survive:
//
//   - the kept one, above;
//   - any session started AFTER the change, because it was issued against the
//     new credentials - somebody who signed in with the new password while this
//     was being delivered must not be thrown out by it;
//   - anything already dead, revoked or expired. Ending those again would
//     publish a SessionEnded that reports nothing, and an event for a non-event
//     is worse than no event.
func (c CredentialChange) Ends(sessions []*session.Session, now time.Time) []*session.Session {
	doomed := make([]*session.Session, 0, len(sessions))

	for _, s := range sessions {
		if s == nil || s.ID == c.Keep {
			continue
		}
		if !s.Live(now) {
			continue
		}
		if s.IssuedAt.Before(c.At) {
			doomed = append(doomed, s)
		}
	}

	return doomed
}
