package dto

import "time"

// Output is the readable side of a user. It has the same shape as register's
// Output today and is a separate type on purpose: the two answer different
// questions and are free to diverge the moment either one needs to.
type Output struct {
	UserID    string
	Email     string
	CreatedAt time.Time
}
