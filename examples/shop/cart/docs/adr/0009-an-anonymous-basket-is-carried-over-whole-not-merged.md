# cart.0009 — An anonymous basket is carried over whole, not merged

- **Status:** accepted
- **Date:** 2026-09-15
- **Scope:** shop.cart
- **Supersedes:** cart.0005

## Context and Problem Statement

cart.0005 merged a visitor's basket into the basket a customer already had,
line by line, all or nothing. In practice the storefront almost never has two
baskets at login, and when it does the customer is surprised by lines from a
session they forgot. The merge endpoint is the one call the storefront makes
that can refuse a login's basket for a reason the customer did not cause.

## Decision Outcome

There is no merge. At login the storefront keeps the visitor's basket and
claims it for the customer; a basket the customer had before stays where it
was until it is abandoned (cart.0006). `POST /v1/baskets/{basketId}/merge` and
the merge_baskets use case are removed.

The domain keeps `mergeInto` and `BasketMerged` for now: baskets already in the
merged state are still read, and the event is still in the bus contract.

### Consequences

- Good: login never refuses a basket.
- Bad: a customer with an older basket on another device sees two until one
  is abandoned.
