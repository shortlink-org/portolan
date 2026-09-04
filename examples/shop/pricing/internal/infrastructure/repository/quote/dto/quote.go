package dto

import "time"

// Quote is the row. Kept apart from the domain's Quote: this one is flat,
// nullable where the schema says so, and knows nothing about promises.
type Quote struct {
	ID         string
	BasketID   string
	TotalMinor int64
	Currency   string
	State      string
	IssuedAt   time.Time
	ExpiresAt  time.Time
}

// Line is one row of quote_lines.
type Line struct {
	QuoteID        string
	SKU            string
	Quantity       int32
	UnitPriceMinor int64
	Currency       string
}
