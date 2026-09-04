package dto

// Input is a whole list: they are imported, never edited row by row.
type Input struct {
	Name      string
	Currency  string
	Rows      []Row
	ValidFrom string
}

type Row struct {
	SKU        string
	AmountMinor int64
}

type Output struct {
	PriceListID string
	Rows        int
}
