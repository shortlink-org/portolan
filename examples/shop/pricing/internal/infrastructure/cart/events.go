// Package cart is the shape of the cart's events, as this service reads them.
//
// A narrowed copy: only the fields pricing uses, and only the events it listens
// for. The manifest says which aggregate they belong to; without that line a
// policy names a type and the step resolves to nothing.
package cart

// Event is what the cart's events answer to, so a policy can be handed any of
// them and assert on the one it wants.
type Event interface {
	Name() string
}

// BasketCheckedOut is the cart's, and its name on the wire is the cart's too.
type BasketCheckedOut struct {
	BasketID string
	QuoteID  string
	Total    int64
	Currency string
}

func (BasketCheckedOut) Name() string { return "cart.BasketCheckedOut" }
