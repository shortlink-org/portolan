// Package dto carries what crosses the edge of the end-after-credential-change
// use case.
package dto

import "time"

// Input describes a credential change in the only terms this use case needs:
// whose it was, when, and which session made it.
//
// There is no mention of a password. This package knows that something about
// the user's credentials changed and nothing whatever about what.
type Input struct {
	UserID string

	// ChangedAt is when the credentials changed, taken from the event rather
	// than read off the clock here. Sessions started after it survive, so the
	// difference between the two matters as soon as anything is delivered late.
	ChangedAt time.Time

	// Keep is a session to spare, or empty to spare none.
	Keep string
}
