# cart.0005 — A merge moves every line or none

- **Status:** accepted
- **Date:** 2026-09-04
- **Scope:** shop.cart

## Context and Problem Statement

After login the storefront holds two baskets: the visitor's, by token, and
whatever the customer already had. The lines have to end up in one basket,
and a line from the visitor's basket can break a rule of the customer's -
another currency, too many SKUs.

## Considered Options

1. **All or nothing**: refuse the merge at the first line that would break a
   rule, with nothing moved.
2. **Best effort**: move what fits, report the rest.
3. **Replace**: the visitor's basket wins, the customer's is dropped.

## Decision Outcome

Chosen option: **all or nothing**. The lines are moved one by one under the
same rules as `addItem`, inside one transaction; the first refusal rolls the
whole merge back and is answered with `409` naming the line.

A half-merged basket is worse than a refusal: the customer sees some of what
they picked and not the rest, with nothing saying which.

### Consequences

- Good: after a merge either both baskets are as they were, or one holds
  everything and the other is marked `merged` and says so with
  `BasketMerged`, naming the basket that now holds its lines - so a listener
  following a visitor's basket knows where it went, not only that it stopped.
- Bad: a customer with a basket in one currency and a visitor's basket in
  another has to choose; the storefront has to offer the choice.
