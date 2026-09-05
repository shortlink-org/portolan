# cart.0002 — A basket freezes its currency at the first item

*Generated from the portolan catalog · commit `4 sources` · at 2026-09-05T03:58:04Z. Do not edit by hand.*

- **Status:** accepted
- **Date:** 2026-09-04
- **Scope:** [shop.cart](../shop/cart/README.md)
- **Source:** `examples/shop/cart/docs/adr/0002-currency-frozen-at-the-first-item.md`

### Context and Problem Statement

A storefront can show prices in more than one currency, and a customer can
change the presentment currency mid-session. A basket with lines in two
currencies has no total.

### Considered Options

1. **Freeze the currency at the first line**; refuse a line in another.
2. **Convert** the incoming line at the current rate.
3. **Allow mixed lines** and convert at checkout.

### Decision Outcome

Chosen option: **freeze at the first line**. A line priced in another currency
is refused with `409` and the storefront empties the basket or asks.

A conversion is a rate, and a rate is a fact `pricing` owns and the cart has
no business inventing. Option 3 defers the same invention to checkout and
makes the running total shown on every page a lie until then.

#### Consequences

- Good: a basket always has one total that is a sum, not a computation.
- Bad: switching currency with a full basket means starting over; the
  storefront has to say so rather than quietly converting.
