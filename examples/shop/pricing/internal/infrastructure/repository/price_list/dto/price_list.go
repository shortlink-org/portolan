// Package dto is the row shape of a price list.
package dto

import "time"

// PriceList is the row.
type PriceList struct {
	ID        string
	Name      string
	Currency  string
	ValidFrom time.Time
	Archived  bool
}

// Row is one price of one list.
type Row struct {
	PriceListID string
	SKU         string
	AmountMinor int64
}
