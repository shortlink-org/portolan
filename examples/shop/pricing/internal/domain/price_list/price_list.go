// Package price_list is what things cost before anybody asks.
package price_list

import (
	"errors"
	"time"

	"github.com/shortlink-org/portolan/examples/shop/pricing/internal/domain/quote/vo/money"
)

// PriceList is one import of prices, valid from a moment. Lists are never
// edited: a change is a new list, and what a quote was priced against stays
// readable for as long as the quote does.
type PriceList struct {
	id        string
	name      string
	currency  string
	rows      []Row
	validFrom time.Time
	archived  bool
}

// Row is one price in a list. An entity rather than a value: it is tracked over
// the life of the list, and a reader asks about this sku's price in that list.
type Row struct {
	sku   string
	price money.Money
}

func NewRow(sku string, price money.Money) Row {
	return Row{sku: sku, price: price}
}

func (r Row) SKU() string { return r.sku }

func (r Row) Price() money.Money { return r.price }

func Import(id, name, currency string, rows []Row, validFrom time.Time) (*PriceList, error) {
	if len(rows) == 0 {
		return nil, errors.New("a price list with no rows prices nothing")
	}
	for _, row := range rows {
		if row.price.Currency() != currency {
			return nil, errors.New("every row of a list is in the list's own currency")
		}
	}

	return &PriceList{id: id, name: name, currency: currency, rows: rows, validFrom: validFrom}, nil
}

// Restore rebuilds a list the store already holds.
func Restore(id, name, currency string, rows []Row, validFrom time.Time, archived bool) *PriceList {
	return &PriceList{id: id, name: name, currency: currency, rows: rows, validFrom: validFrom, archived: archived}
}

// Archive takes a list out of use without deleting it: quotes priced against it
// still point here.
func (l *PriceList) Archive() {
	l.archived = true
}

// PriceOf answers what one sku costs in this list.
func (l *PriceList) PriceOf(sku string) (money.Money, bool) {
	for _, row := range l.rows {
		if row.sku == sku {
			return row.price, true
		}
	}

	return money.Money{}, false
}

func (l *PriceList) ID() string { return l.id }

func (l *PriceList) Name() string { return l.name }

func (l *PriceList) Currency() string { return l.currency }

func (l *PriceList) Rows() []Row { return l.rows }

func (l *PriceList) ValidFrom() time.Time { return l.validFrom }

func (l *PriceList) Archived() bool { return l.archived }
