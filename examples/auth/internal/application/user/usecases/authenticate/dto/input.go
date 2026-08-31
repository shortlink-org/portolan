// Package dto carries what crosses the edge of the authenticate use case.
package dto

// Input is a set of credentials to check.
type Input struct {
	Email    string
	Password string
}
