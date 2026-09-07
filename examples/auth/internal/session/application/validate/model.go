package validate

import "time"

// Query carries the token whose session should be resolved.
type Query struct {
	Token string
}

// Result describes the live session for internal application callers.
type Result struct {
	UserID    string
	ExpiresAt time.Time
	SessionID string
}
