// Package dto carries what crosses the edge of the login use case.
package dto

// Input is a login attempt. The credentials are checked by the user domain
// through a port; this use case never inspects them.
type Input struct {
	Email    string
	Password string
}
