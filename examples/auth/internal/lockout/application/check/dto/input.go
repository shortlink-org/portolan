// Package dto carries what crosses the edge of the check use case.
package dto

// Input names the account being asked about.
type Input struct {
	UserID string
}

// Output is the answer: whether a password may be checked for this account
// right now.
type Output struct {
	Allowed bool
}
