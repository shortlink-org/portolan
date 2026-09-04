// Package dto carries what crosses the edge of the record_failure use case.
package dto

// Input names the account whose password was just checked and found wrong.
type Input struct {
	UserID string
}
