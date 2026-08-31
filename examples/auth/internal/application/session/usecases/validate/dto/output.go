package dto

import "time"

// Output is what a resource server needs in order to serve the request: who is
// calling, and how long the answer stays good.
type Output struct {
	UserID    string
	ExpiresAt time.Time
}
