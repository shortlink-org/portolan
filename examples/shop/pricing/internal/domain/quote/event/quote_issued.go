package event

import "time"

// QuoteIssued says a basket has a price, and for how long. Whoever places the
// order needs both, so both are on the event rather than fetched again.
type QuoteIssued struct {
	quoteID     string
	basketID    string
	totalMinor  int64
	currency    string
	expiresAt   time.Time
	occurredAt  time.Time
}

func NewQuoteIssued(quoteID, basketID string, totalMinor int64, currency string, expiresAt, occurredAt time.Time) QuoteIssued {
	return QuoteIssued{
		quoteID:    quoteID,
		basketID:   basketID,
		totalMinor: totalMinor,
		currency:   currency,
		expiresAt:  expiresAt,
		occurredAt: occurredAt,
	}
}

func (QuoteIssued) Name() string { return "pricing.QuoteIssued" }

func (e QuoteIssued) AggregateID() string { return e.quoteID }

func (e QuoteIssued) OccurredAt() time.Time { return e.occurredAt }

func (e QuoteIssued) QuoteID() string { return e.quoteID }

func (e QuoteIssued) BasketID() string { return e.basketID }

func (e QuoteIssued) TotalMinor() int64 { return e.totalMinor }

func (e QuoteIssued) Currency() string { return e.currency }

func (e QuoteIssued) ExpiresAt() time.Time { return e.expiresAt }
