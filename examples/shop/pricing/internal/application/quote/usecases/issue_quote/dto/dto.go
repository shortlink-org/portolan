package dto

// Input is a basket and what is in it, as the caller sees it.
type Input struct {
	BasketID string
	SKUs     []Line
	Currency string
}

type Line struct {
	SKU      string
	Quantity int32
}

// Output is the quote, as little of it as a caller needs to hold on to.
type Output struct {
	QuoteID    string
	TotalMinor int64
	Currency   string
	ExpiresAt  string
}
