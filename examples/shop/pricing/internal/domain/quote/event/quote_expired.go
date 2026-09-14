package event

import (
	"time"

	ddd "github.com/shortlink-org/portolan/pkg/ddd/event"
)

// QuoteExpired says the price is no longer promised. Nothing is refunded and
// nothing is cancelled: whoever holds the quote has to ask for another one.
type QuoteExpired struct {
	ddd.Base
	basketID string
}

func NewQuoteExpired(quoteID, basketID string, occurredAt time.Time) QuoteExpired {
	return QuoteExpired{Base: ddd.New(quoteID, occurredAt), basketID: basketID}
}

func (QuoteExpired) Name() string { return "pricing.QuoteExpired" }

func (e QuoteExpired) QuoteID() string { return e.AggregateID() }

func (e QuoteExpired) BasketID() string { return e.basketID }
