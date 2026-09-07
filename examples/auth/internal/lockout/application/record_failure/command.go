package record_failure

// Command records a failed credential check for a user.
type Command struct {
	UserID string
}
