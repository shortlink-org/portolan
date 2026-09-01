package dto

import "time"

// Output is what a resource server needs in order to serve the request: who is
// calling, and how long the answer stays good.
type Output struct {
	UserID    string
	ExpiresAt time.Time

	// SessionID names the session the token belongs to.
	//
	// It is here and NOT on the wire. A caller inside the service needs it -
	// changing a password has to know which session to spare - while a client
	// has no use for it, and putting it in an HTTP response would invite
	// something to be built on it. The two shapes are separate types precisely
	// so that one can carry what the other must not.
	SessionID string
}
