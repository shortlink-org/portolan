package event

import "time"

// QuoteExpired says the price is no longer promised. Nothing is refunded and
// nothing is cancelled: whoever holds the quote has to ask for another one.
type QuoteExpired struct {
	quoteID    string
	basketID   string
	occurredAt time.Time
}

func NewQuoteExpired(quoteID, basketID string, occurredAt time.Time) QuoteExpired {
	return QuoteExpired{quoteID: quoteID, basketID: basketID, occurredAt: occurredAt}
}

func (QuoteExpired) Name() string { return "pricing.QuoteExpired" }

func (e QuoteExpired) AggregateID() string { return e.quoteID }

func (e QuoteExpired) OccurredAt() time.Time { return e.occurredAt }

func (e QuoteExpired) QuoteID() string { return e.quoteID }

func (e QuoteExpired) BasketID() string { return e.basketID }
