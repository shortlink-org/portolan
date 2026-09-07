package logout

// Command carries the intent to end the session identified by Token.
type Command struct {
	Token string
}
