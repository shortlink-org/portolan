// Package dto carries what crosses the edge of the logout use case.
//
// There is no Output. Logout has nothing to report: either the session is gone
// afterwards, or the call failed. A struct with no fields would only be here
// for symmetry with the other use cases, which is not a reason.
package dto

// Input names the session to end, by the token the client holds.
type Input struct {
	Token string
}
