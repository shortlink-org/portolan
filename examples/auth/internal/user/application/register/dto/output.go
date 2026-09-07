package dto

import "time"

// Output is what a caller learns from a successful registration: enough to
// address the new user, and nothing about how they authenticate.
type Output struct {
	UserID    string
	Email     string
	CreatedAt time.Time
}
