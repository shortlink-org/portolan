package dto

type Input struct{}

type Output struct {
	Lists []Summary
}

type Summary struct {
	PriceListID string
	Name        string
	Currency    string
	Rows        int
	Archived    bool
}
