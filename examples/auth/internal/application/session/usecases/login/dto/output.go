package dto

import "time"

// Output is what a client needs to make its next request: the token, and when
// it stops working.
//
// The session id is not here. It names a record in auth's store, is of no use
// to a client, and putting it on the wire would invite somebody to build on it.
type Output struct {
	Token     string
	ExpiresAt time.Time
}
