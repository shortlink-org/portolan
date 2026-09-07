package change_password

// Command carries the intent to replace a user's password.
// By identifies the session that initiated the change and should remain live.
type Command struct {
	UserID  string
	By      string
	Current string
	New     string
}
