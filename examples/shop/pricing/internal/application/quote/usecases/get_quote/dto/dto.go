package dto

// Input names the quote, by its own id or by the basket it priced.
type Input struct {
	QuoteID  string
	BasketID string
}

// Output is the quote as a caller reads it.
type Output struct {
	QuoteID    string
	BasketID   string
	TotalMinor int64
	Currency   string
	State      string
	ExpiresAt  string
}
