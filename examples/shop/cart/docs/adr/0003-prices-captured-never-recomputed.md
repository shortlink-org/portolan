# cart.0003 — Line prices are captured when added, never recomputed

- **Status:** accepted
- **Date:** 2026-09-04
- **Scope:** shop.cart

## Context and Problem Statement

A price can change between a customer adding an item and checking out. The
cart could hold SKUs and look prices up each time, or hold the price it was
given at the moment of adding.

## Considered Options

1. **Capture the price on the line** as `Money`, from what the storefront sent.
2. **Look prices up** from `pricing` on every read.

## Decision Outcome

Chosen option: **capture on the line**.

What the customer saw is what the basket holds. The total the customer is
charged is `pricing`'s business at checkout (cart.0004), and the difference
between the captured lines and the quote is the storefront's to show.

### Consequences

- Good: the cart calls nobody to render itself; a read is a read.
- Good: a price change is visible as a difference at checkout rather than as
  a basket that silently changed under the customer.
- Bad: the cart trusts the storefront's price at the moment of adding; the
  quote at checkout is what catches a stale or wrong one.
