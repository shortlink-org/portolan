package check_credentials

// Command carries credentials to check. It is a command because the attempt
// also updates lockout state.
type Command struct {
	Email    string
	Password string
}

// Result identifies the user whose credentials were accepted.
type Result struct {
	UserID string
}
