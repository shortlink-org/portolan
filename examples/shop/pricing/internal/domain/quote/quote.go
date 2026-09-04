// Package quote is what a basket costs, promised until it runs out.
package quote

import (
	"errors"
	"time"

	"github.com/shortlink-org/portolan/examples/shop/pricing/internal/domain/quote/event"
	"github.com/shortlink-org/portolan/examples/shop/pricing/internal/domain/quote/vo/line"
	"github.com/shortlink-org/portolan/examples/shop/pricing/internal/domain/quote/vo/money"
)

var (
	// ErrExpired is what a caller gets for a quote whose moment has passed. It
	// says nothing about which quote or whose: a price that has run out is the
	// same answer for everybody.
	ErrExpired = errors.New("the quote has expired")
	// ErrNotIssued is a move the table does not allow from where the quote is.
	ErrNotIssued = errors.New("the quote is not open")
)

// Quote is one basket, priced. The lines are captured at issue and never
// recomputed: a quote that changed under the customer would not be a quote.
type Quote struct {
	id        string
	basketID  string
	lines     []line.Line
	total     money.Money
	state     string
	issuedAt  time.Time
	expiresAt time.Time
}

// Issue prices a basket and promises the price until expiresAt.
func Issue(id, basketID string, lines []line.Line, issuedAt, expiresAt time.Time) (*Quote, event.QuoteIssued, error) {
	if len(lines) == 0 {
		return nil, event.QuoteIssued{}, errors.New("a quote with no lines prices nothing")
	}

	total := lines[0].Total()
	for _, l := range lines[1:] {
		sum, err := total.Plus(l.Total())
		if err != nil {
			return nil, event.QuoteIssued{}, err
		}
		total = sum
	}

	q := &Quote{
		id:        id,
		basketID:  basketID,
		lines:     lines,
		total:     total,
		state:     StateIssued,
		issuedAt:  issuedAt,
		expiresAt: expiresAt,
	}

	return q, event.NewQuoteIssued(id, basketID, total.AmountMinor(), total.Currency(), expiresAt, issuedAt), nil
}

// Restore rebuilds a quote the store already holds. No move is made and nothing
// is published.
func Restore(id, basketID string, lines []line.Line, total money.Money, state string, issuedAt, expiresAt time.Time) *Quote {
	return &Quote{
		id:        id,
		basketID:  basketID,
		lines:     lines,
		total:     total,
		state:     state,
		issuedAt:  issuedAt,
		expiresAt: expiresAt,
	}
}

// Take marks the quote as used by the order it priced.
func (q *Quote) Take(at time.Time) error {
	next, ok := Rules[q.state][EventTake]
	if !ok {
		return ErrNotIssued
	}
	if at.After(q.expiresAt) {
		return ErrExpired
	}
	q.state = next

	return nil
}

// Expire lets the promise lapse. The event is what the rest of the estate
// hears; the state is what this service will answer with afterwards.
func (q *Quote) Expire(at time.Time) (event.QuoteExpired, error) {
	next, ok := Rules[q.state][EventExpire]
	if !ok {
		return event.QuoteExpired{}, ErrNotIssued
	}
	q.state = next

	return event.NewQuoteExpired(q.id, q.basketID, at), nil
}

func (q *Quote) ID() string { return q.id }

func (q *Quote) BasketID() string { return q.basketID }

func (q *Quote) Lines() []line.Line { return q.lines }

func (q *Quote) Total() money.Money { return q.total }

func (q *Quote) State() string { return q.state }

func (q *Quote) IssuedAt() time.Time { return q.issuedAt }

func (q *Quote) ExpiresAt() time.Time { return q.expiresAt }
