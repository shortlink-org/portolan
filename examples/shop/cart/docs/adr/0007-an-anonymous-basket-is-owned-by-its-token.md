# cart.0007 — An anonymous basket is owned by whoever holds its token

- **Status:** accepted
- **Date:** 2026-09-04
- **Scope:** shop.cart

## Context and Problem Statement

A visitor has no session. Something has to say which basket is theirs and
stop anyone else from changing it, without a login and without the cart
becoming an identity provider.

## Decision Outcome

Creating a basket answers with an opaque token, and the token is the
capability to read and change that basket: sent as `X-Basket-Token`, compared
in constant time, never listed. A signed-in customer's basket is theirs by
customer id, which `auth` vouched for at checkout and merge - the two
operations where being someone matters - and by the token everywhere else.

### Consequences

- Good: adding to a basket costs no call to `auth`, and a visitor never has
  to sign in to shop.
- Bad: a leaked token is a leaked basket; it is scoped to one basket and dies
  with it, which is the whole of the exposure.
