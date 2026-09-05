# payments.0004 — Journal entries are idempotent by (order_id, attempt)

*Generated from the portolan catalog · commit `9 sources` · at 2026-08-29T09:14:22Z. Do not edit by hand.*

- **Status:** proposed
- **Date:** 2026-02-09
- **Scope:** [payments](../payments/README.md)
- **Source:** `data/adr/0004-idempotent-journal-entries.md`

### Context and Problem Statement

The ledger writes a journal entry when a capture succeeds. The capture path is
at-least-once end to end: the PSP retries its webhook, our own consumer retries
on redelivery, and an operator can replay a partition. Today a replayed capture
writes a second journal entry, and the ledger has to be repaired by hand.

The natural key is not `order_id` alone: a declined authorization is followed by
a second, legitimate attempt on the same order, and that attempt must produce
its own entry.

### Decision Drivers

- Replaying the capture consumer must be safe, always, with no operator
  ceremony.
- A genuine retry by the customer is a distinct financial fact and must not be
  collapsed into the first one.
- The guarantee should be enforced by the database, not by application code that
  can be bypassed by the next caller.

### Considered Options

1. **A unique constraint on `(order_id, attempt)`**, with `attempt` carried on
   the capture command and echoed on the event.
2. **A dedup table keyed by the message id** of the inbound event.
3. **Application-level "does an entry exist?" check** before insert.

### Decision Outcome

Proposed: **unique constraint on `(order_id, attempt)`**, with the insert
written as `INSERT ... ON CONFLICT (order_id, attempt) DO NOTHING`.

Option 2 dedups the *transport*, not the *fact*: the same capture arriving via a
webhook and via the event bus has two message ids and would write twice. Option
3 is a read-then-write race that fails exactly under the concurrency it is meant
to protect against.

#### Consequences

- Good: replay is a no-op at the storage layer, whatever the caller does.
- Good: the key is a domain fact, so it holds across transports.
- Bad: `attempt` has to be threaded through the capture command and onto
  `PaymentCaptured`; a producer that omits it cannot be made idempotent.
- Bad: existing rows have no `attempt`. The backfill assigns `attempt = 1` and
  is only correct if no order in history was captured twice — which has to be
  checked before this is accepted, not after.

### Open Questions

- Does the PSP guarantee a stable attempt identifier across its own retries, or
  do we mint it ourselves at authorization time?
- What is the correct behaviour when a capture arrives for an attempt that was
  never authorized? Currently it would insert; it should probably reject.

## Relates to

- **Events:** [payments.ledger.payment.PaymentCaptured](../payments/ledger/aggregates/payment.md)
