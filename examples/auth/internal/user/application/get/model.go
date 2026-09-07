package get

import "time"

// Query identifies the user to read.
type Query struct {
	UserID string
}

// Result is the readable application view of a user.
type Result struct {
	UserID    string
	Email     string
	CreatedAt time.Time
}
