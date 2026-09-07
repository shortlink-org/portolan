package register

import "time"

// Command carries the intent to register a user.
type Command struct {
	Email    string
	Password string
}

// Result is the application result of a successful registration.
type Result struct {
	UserID    string
	Email     string
	CreatedAt time.Time
}
