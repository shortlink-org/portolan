# org.0002 — Domain event schema version is encoded in the package path (events/v1)

*Generated from the portolan catalog · commit `8 sources` · at 2026-08-29T09:14:22Z. Do not edit by hand.*

- **Status:** accepted
- **Date:** 2025-05-02
- **Scope:** org
- **Source:** `docs/adr/0002-event-version-in-package-path.md`

## Context and Problem Statement

A domain event outlives the code that published it. Consumers deserialize
messages written months earlier, and a consumer that is down for a day comes
back to a backlog of the *old* shape. We need a versioning scheme that a
consumer can act on before it parses a single byte.

## Decision Drivers

- A consumer must be able to decide "can I read this?" from routing information
  alone, without a registry lookup.
- Two versions of one event must be publishable at the same time during a
  migration.
- The version must be visible in the source tree, in the topic name and in the
  type URL — not only in a field.

## Considered Options

1. **Version in the package path**: `shop.events.v1.BasketCheckedOut`, file at
   `proto/shop/events/v1/basket.proto`.
2. **A `version` field inside the message.**
3. **A schema registry** with subject-level compatibility rules.

## Decision Outcome

Chosen option: **version in the package path**.

The version becomes part of the fully-qualified name, so it is part of the type
URL, part of the generated Go package, and part of the topic name
(`shop.events.v1.basket-checked-out`). A consumer subscribes to the versions it
understands and is structurally incapable of receiving one it does not.

Option 2 puts the version *inside* the payload, which means parsing an unknown
shape to discover that it is unknown. Option 3 is the right answer at a
different scale; it adds an operational dependency on the publish path that we
are not willing to take yet.

### Consequences

- Good: an unreadable version is never delivered — it is a different topic.
- Good: v1 and v2 publish side by side during a migration; the producer emits
  both until the v1 subscription drains.
- Bad: a breaking change means a new package, a new topic and a period of dual
  publishing. This is deliberate friction, and it is the point.
- Bad: additive changes still land in v1. "Is this additive?" stays a judgement
  call at review time, and the catalog's field diff per version is what makes
  that call reviewable.

## Relates to

- **Events:** [shop.cart.basket.BasketCheckedOut](../shop/cart/aggregates/basket.md)
