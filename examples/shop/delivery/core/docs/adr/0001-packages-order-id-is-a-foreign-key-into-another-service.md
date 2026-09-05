# core.0001 — `packages.order_id` is a foreign key into the order service's table

- **Status:** accepted
- **Date:** 2026-09-05
- **Scope:** delivery.core

## Context and Problem Statement

A shipment is for an order that another service owns, in another database.
How does the shipment's row say which order, and what does the schema
promise about it?

The obvious answer - a plain text column - promises nothing: a shipment can
be written for an order that never existed, and nothing in either database
would notice. The stricter answer - a foreign key - promises a row exists on
the other side, at the cost of a constraint that crosses a boundary neither
service can migrate alone.

## Decision Drivers

- The catalog must show the coupling, not hide it.
- A shipment for an order that does not exist must be impossible, or at
  least visible.
- The cost of the coupling must be paid knowingly, in one place.

## Considered Options

1. **A plain column** — `order_id text`, no promise; the order service is
   asked at dispatch.
2. **A foreign key into the order service's table** — `REFERENCES orders
   (id)`, on the understanding that the two databases are one in this
   example estate.
3. **A projection of orders kept here** — the order service's events feed a
   local `orders` table, and the key points at that.

## Decision Outcome

Chosen option: **a foreign key into the order service's table**, for this
sketch, and named as the thing the catalog reports.

| | promise | who can migrate | catalog |
|---|---|---|---|
| plain column | none | either alone | nothing to show |
| foreign key | a row exists | neither alone | shown on Problems, deliberately |
| projection | a row exists here | delivery alone | a projection with `-- from:` |

The key is a claim the catalog can read and report, and reporting it is the
point: an estate that does this by accident should see it. What is given up
is independence of migration, which this example estate does not have
anyway. Option 3 is the right answer for a real estate and the shape
[ddd-cqrs] names; it is not in this sketch because nothing here reads the
bus yet.

### Consequences

- Good: the coupling is one line in one migration, with a comment, and the
  catalog draws it.
- Bad: neither service can drop or rename `orders` alone.
- Neutral: the address is not taken from that row; it is handed over with
  the dispatch and copied, because the order service holds no address.
