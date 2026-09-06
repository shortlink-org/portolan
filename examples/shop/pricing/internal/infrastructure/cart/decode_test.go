package cart

import "testing"

// The payload is the cart's wire form of a checkout, field for field.
const checkedOut = `{
  "basketId": "b-1",
  "customerId": "c-1",
  "items": [{"sku": "sku-1", "quantity": 2, "unitPrice": {"amountMinor": 500, "currency": "EUR"}}],
  "total": {"amountMinor": 1000, "currency": "EUR"},
  "quoteId": "q-1",
  "occurredAt": "2026-09-06T10:00:00Z"
}`

func TestDecodeBasketCheckedOut(t *testing.T) {
	got, err := Decode("cart.BasketCheckedOut", []byte(checkedOut))
	if err != nil {
		t.Fatal(err)
	}

	e, ok := got.(BasketCheckedOut)
	if !ok {
		t.Fatalf("got %T, want BasketCheckedOut", got)
	}
	if e.BasketID != "b-1" || e.QuoteID != "q-1" {
		t.Errorf("ids: got basket %q, quote %q", e.BasketID, e.QuoteID)
	}
	if e.Total != (Money{AmountMinor: 1000, Currency: "EUR"}) {
		t.Errorf("total: got %+v", e.Total)
	}
}

func TestDecodePassesOverWhatItDoesNotRead(t *testing.T) {
	got, err := Decode("cart.BasketCreated", []byte(`{"basketId": "b-1"}`))
	if err != nil || got != nil {
		t.Errorf("got %v, %v; want nil, nil", got, err)
	}
}

func TestDecodeRefusesACheckoutWithoutABasket(t *testing.T) {
	if _, err := Decode("cart.BasketCheckedOut", []byte(`{"quoteId": "q-1"}`)); err == nil {
		t.Error("no error for a checkout with no basketId")
	}
}
