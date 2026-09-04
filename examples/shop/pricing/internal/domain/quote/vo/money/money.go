// Package money is an amount in the minor unit of a currency.
package money

import "fmt"

// Money never rounds: everything is an integer of minor units, and two amounts
// are only added when they are in the same currency.
type Money struct {
	amountMinor int64
	currency    string
}

func New(amountMinor int64, currency string) (Money, error) {
	if len(currency) != 3 {
		return Money{}, fmt.Errorf("a currency is three letters of ISO 4217, got %q", currency)
	}

	return Money{amountMinor: amountMinor, currency: currency}, nil
}

func (m Money) AmountMinor() int64 { return m.amountMinor }

func (m Money) Currency() string { return m.currency }

func (m Money) Plus(other Money) (Money, error) {
	if m.currency != other.currency {
		return Money{}, fmt.Errorf("cannot add %s to %s", other.currency, m.currency)
	}

	return Money{amountMinor: m.amountMinor + other.amountMinor, currency: m.currency}, nil
}

func (m Money) Times(n int32) Money {
	return Money{amountMinor: m.amountMinor * int64(n), currency: m.currency}
}
