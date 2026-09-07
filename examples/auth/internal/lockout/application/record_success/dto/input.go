// Package dto carries what crosses the edge of the record_success use case.
package dto

// Input names the account whose password was just checked and found right.
type Input struct {
	UserID string
}
