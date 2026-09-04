# Quote expired on checkout
owner: shop
source: services/pricing/internal/policy/expire_quote.go

A basket that has been checked out is a basket whose quote is spent. Pricing
hears the event the cart publishes and expires the quote it issued for that
basket, so a second checkout of the same basket has to be priced again rather
than reuse a number the price list may have moved on from.

## Participants
- bus: broker
- shop.pricing: service
- pricing-db: store in shop "pricing-db (postgres)"

## Steps
bus -> shop.pricing: event shop.cart.basket.BasketCheckedOut @internal/policy/expire_quote.go:24 #s1
  > One consumer group, the basket id as the routing key. A basket with no
  > quote on file is ignored, not an error: not every basket was priced.
shop.pricing -> pricing-db: expireQuote @internal/adapter/postgres/quotes.go:71 #s2
shop.pricing -> bus: event shop.pricing.quote.QuoteExpired @internal/policy/expire_quote.go:31 #s3
  > Published for the audit trail; nothing in the estate acts on it yet.
