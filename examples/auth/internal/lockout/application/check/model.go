package check

// Query identifies the account whose lockout state should be read.
type Query struct {
	UserID string
}

// Result reports whether the account may have its password checked.
type Result struct {
	Allowed bool
}
