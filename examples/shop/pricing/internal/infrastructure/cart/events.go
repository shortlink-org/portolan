// Package cart is the shape of the cart's events, as this service reads them.
//
// A narrowed copy: only the fields pricing uses, and only the events it listens
// for. The cart names the event and the subject, and the shape is its wire
// form, camelCase as it writes it. The manifest says which aggregate the events
// belong to; without that line a policy names a type and the step resolves to
// nothing.
package cart

// Topic is the subject the cart publishes on: one per aggregate, dotted the way
// a NATS subject is. The catalog reads it as the channel this service listens
// on.
const Topic = "shop.cart.basket"

// Event is what the cart's events answer to, so a policy can be handed any of
// them and assert on the one it wants.
type Event interface {
	Name() string
}

// Money is the cart's, as it travels: minor units and the currency code.
type Money struct {
	AmountMinor int64  `json:"amountMinor"`
	Currency    string `json:"currency"`
}

// BasketCheckedOut is the cart's, and its name on the wire is the cart's too.
// The items travel on the message as well; this service does not read them.
type BasketCheckedOut struct {
	BasketID string `json:"basketId"`
	QuoteID  string `json:"quoteId"`
	Total    Money  `json:"total"`
}

func (BasketCheckedOut) Name() string { return "cart.BasketCheckedOut" }
