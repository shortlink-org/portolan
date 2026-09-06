// Package dto is the row shape of a quote, and the topic its events go out on.
package dto

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/shortlink-org/portolan/examples/shop/pricing/internal/domain/quote/event"
)

// Topic is where this domain's events go: one subject per aggregate, dotted the
// way a NATS subject is. The catalog reads it as the channel of every event the
// quote raises.
const Topic = "shop.pricing.quote"

// Money is an amount as it travels: minor units and the currency code, the
// shape the cart uses for its own.
type Money struct {
	AmountMinor int64  `json:"amountMinor"`
	Currency    string `json:"currency"`
}

// QuoteIssuedWire is the event as the outbox row's payload holds it and a
// subscriber in any language reads it. camelCase, as the cart writes its own,
// so one reader serves the estate.
type QuoteIssuedWire struct {
	QuoteID    string    `json:"quoteId"`
	BasketID   string    `json:"basketId"`
	Total      Money     `json:"total"`
	ExpiresAt  time.Time `json:"expiresAt"`
	OccurredAt time.Time `json:"occurredAt"`
}

// QuoteExpiredWire says which promise lapsed and nothing about what it
// promised: whoever holds the quote has to ask for another one.
type QuoteExpiredWire struct {
	QuoteID    string    `json:"quoteId"`
	BasketID   string    `json:"basketId"`
	OccurredAt time.Time `json:"occurredAt"`
}

// Wire is the event as the outbox row holds it. An event with no wire form
// here is an error rather than an empty payload: a promise announced with
// nothing in it is worse than one not announced.
func Wire(raised event.Event) ([]byte, error) {
	switch e := raised.(type) {
	case event.QuoteIssued:
		return json.Marshal(QuoteIssuedWire{
			QuoteID:    e.QuoteID(),
			BasketID:   e.BasketID(),
			Total:      Money{AmountMinor: e.TotalMinor(), Currency: e.Currency()},
			ExpiresAt:  e.ExpiresAt(),
			OccurredAt: e.OccurredAt(),
		})
	case event.QuoteExpired:
		return json.Marshal(QuoteExpiredWire{QuoteID: e.QuoteID(), BasketID: e.BasketID(), OccurredAt: e.OccurredAt()})
	}

	return nil, fmt.Errorf("dto: no wire form for %s", raised.Name())
}
