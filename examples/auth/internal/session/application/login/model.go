package login

import "time"

// Command carries the intent to create a session from credentials.
type Command struct {
	Email    string
	Password string
}

// Result contains the newly issued session credential.
type Result struct {
	Token     string
	ExpiresAt time.Time
}
