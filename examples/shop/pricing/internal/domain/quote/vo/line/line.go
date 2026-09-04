// Package line is one line of a quote: what was priced, and at what.
package line

import "github.com/shortlink-org/portolan/examples/shop/pricing/internal/domain/quote/vo/money"

// Line is a value: two lines with the same sku, quantity and price are the same
// line. The price is captured when the quote is issued and never recomputed -
// that is the whole point of quoting.
type Line struct {
	sku       string
	quantity  int32
	unitPrice money.Money
}

func New(sku string, quantity int32, unitPrice money.Money) Line {
	return Line{sku: sku, quantity: quantity, unitPrice: unitPrice}
}

func (l Line) SKU() string { return l.sku }

func (l Line) Quantity() int32 { return l.quantity }

func (l Line) UnitPrice() money.Money { return l.unitPrice }

func (l Line) Total() money.Money { return l.unitPrice.Times(l.quantity) }
