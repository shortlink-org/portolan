package event

import (
	"time"

	ddd "github.com/shortlink-org/portolan/pkg/ddd/event"
)

// QuoteIssued says a basket has a price, and for how long. Whoever places the
// order needs both, so both are on the event rather than fetched again.
type QuoteIssued struct {
	ddd.Base
	basketID   string
	totalMinor int64
	currency   string
	expiresAt  time.Time
}

func NewQuoteIssued(quoteID, basketID string, totalMinor int64, currency string, expiresAt, occurredAt time.Time) QuoteIssued {
	return QuoteIssued{
		Base:       ddd.New(quoteID, occurredAt),
		basketID:   basketID,
		totalMinor: totalMinor,
		currency:   currency,
		expiresAt:  expiresAt,
	}
}

func (QuoteIssued) Name() string { return "pricing.QuoteIssued" }

func (e QuoteIssued) QuoteID() string { return e.AggregateID() }

func (e QuoteIssued) BasketID() string { return e.basketID }

func (e QuoteIssued) TotalMinor() int64 { return e.totalMinor }

func (e QuoteIssued) Currency() string { return e.currency }

func (e QuoteIssued) ExpiresAt() time.Time { return e.expiresAt }
