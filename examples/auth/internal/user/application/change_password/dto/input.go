// Package dto carries what crosses the edge of the change password use case.
//
// There is no Output. A password either changed or the call failed; there is
// nothing to report back, and certainly nothing about the password itself.
package dto

// Input names the user, what they are proving with, and what they want instead.
//
// By is whoever is making the change - here, the session it was made from. It
// is recorded on the event and travels no further into the user domain, which
// has no idea what it refers to.
type Input struct {
	UserID  string
	By      string
	Current string
	New     string
}
