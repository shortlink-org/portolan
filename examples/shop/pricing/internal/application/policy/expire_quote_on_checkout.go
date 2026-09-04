// Package policy holds the rules of the form "when X has happened, do Y", where
// X belongs to somebody else's aggregate.
//
// This is the only package in the tree, apart from assembly, that knows the
// cart exists.
package policy

import (
	"context"
	"errors"
	"time"

	"github.com/shortlink-org/portolan/examples/shop/pricing/internal/domain/quote"
	"github.com/shortlink-org/portolan/examples/shop/pricing/internal/infrastructure/cart"
)

// ExpireQuoteOnCheckout ends the promise once the basket it priced is checked
// out.
//
// It hangs off the fact rather than off a call from the cart: from checkout on,
// the order holds the price, and a quote still open would be a second answer to
// what the basket costs. A basket nobody priced is passed over rather than
// treated as an error - not every basket was quoted.
type ExpireQuoteOnCheckout struct {
	quotes quote.Repository
	now    func() time.Time
}

func NewExpireQuoteOnCheckout(quotes quote.Repository, now func() time.Time) *ExpireQuoteOnCheckout {
	return &ExpireQuoteOnCheckout{quotes: quotes, now: now}
}

// Handle reacts to one event. Anything else on the subject is not this policy's
// business and is passed over.
func (p *ExpireQuoteOnCheckout) Handle(ctx context.Context, e cart.Event) error {
	checkedOut, ok := e.(cart.BasketCheckedOut)
	if !ok {
		return nil
	}

	held, err := p.quotes.ByBasket(ctx, checkedOut.BasketID)
	if err != nil {
		return nil
	}

	raised, err := held.Expire(p.now())
	if err != nil {
		if errors.Is(err, quote.ErrNotIssued) {
			return nil
		}

		return err
	}

	return p.quotes.Save(ctx, held, raised)
}
