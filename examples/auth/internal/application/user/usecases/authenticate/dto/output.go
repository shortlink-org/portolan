package dto

// Output says who the credentials belong to, and nothing else. Deliberately
// thin: a caller that only needed to know whether the password was right must
// not walk away holding the user's address.
type Output struct {
	UserID string
}
