# Pricing

Service `pricing` — bounded context **shop**. Go.

Owns what things cost. It is asked, and it answers with a promise: a quote is a
price for one basket, good until a moment, and after that moment it is gone
rather than stale.

## What it does

- Prices a basket against the list in force and issues a quote — `QuoteIssued`.
- Answers what a quote says, by its id or by the basket it priced.
- Lets promises lapse: the sweep expires everything past its moment, and a
  basket checked out has its quote expired straight away, because from then on
  the order holds the price.
- Takes in price lists whole and archives them rather than editing them, so
  that what a quote was priced against stays readable.

## What it does not do

Does not decide what to buy, does not hold a basket and does not place an
order. It never recomputes a price it has already promised — a quote that
changed under the customer would not be a quote.

## Publishes

`QuoteIssued`, `QuoteExpired`, on `shop.pricing.quote`.

## Provides

`shop.v1.Pricing` — IssueQuote, GetQuote — and `shop.v1.PriceLists` —
ImportPriceList, ArchivePriceList, ListPriceLists. One contract per aggregate,
vendored under the transport package that answers it.

`Pricing` keeps its name rather than taking the `Service` suffix the lint rules
want: `shop.cart` has been calling `shop.v1.Pricing/GetQuote` since before this
service existed, and a naming rule is not worth breaking a consumer over. The
exception is written down in the module's `buf.yaml`.

## Running it

```bash
docker compose up -d db
make gen && go run ./cmd/pricing
```

`make gen` regenerates the stubs from the contracts in this tree — one call per
module, into the `gen` directory beside the code that uses it.
