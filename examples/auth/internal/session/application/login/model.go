package login

import "time"

// Command carries the intent to create a session from credentials.
type Command struct {
	Email    string
	Password string
	// UserAgent is what the client called itself; empty when it said nothing.
	UserAgent string
}

// Result contains the newly issued session credential.
type Result struct {
	Token     string
	ExpiresAt time.Time
}
