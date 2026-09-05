# ledger.0002 — Another service's events are read off the bus by an adapter and republished in process

*Generated from the portolan catalog · commit `7 sources` · at 2026-09-05T03:58:04Z. Do not edit by hand.*

- **Status:** accepted
- **Date:** 2026-09-05
- **Scope:** [payments.ledger](../payments/ledger/README.md)
- **Source:** `examples/payments/ledger/docs/adr/0002-foreign-events-arrive-over-nats-and-are-republished-in-process.md`

### Context and Problem Statement

The policy that voids a hold when an order is cancelled was written as a
Spring listener on an in-process event. The order service publishes
`oms.OrderCancelled` on NATS. Nothing in this service read NATS, so the
listener never fired, and holds on cancelled orders were never released.

How does a fact from another service reach a policy here, and what does the
policy get to know about the wire it travelled on?

### Decision Drivers

- The policy must import nothing that knows about NATS, JSON or headers.
- A ledger that was down must read what it missed.
- The same fact arriving twice must not release two holds, or fail.
- The catalog must see the policy hang off the order service's event.

### Considered Options

1. **The policy subscribes to NATS itself** — one class, direct.
2. **An adapter subscribes and republishes in process; the policy listens in
   process** — the shape the other services on this bus use.
3. **The order service calls the ledger** — an rpc instead of an event.

### Decision Outcome

Chosen option: **an adapter subscribes and republishes in process**.

| | policy knows the wire | missed while down | catalog reads it |
|---|---|---|---|
| policy on NATS | yes | with a durable consumer | as an adapter, not a policy |
| adapter republishes | no | with a durable consumer | as a policy on the event |
| rpc from the order | no | lost | as a call, not a reaction |

The shape of the fact the policy needs - the order id, the reason - is
declared in the application layer, beside the policy, in this service's
words. The adapter holds a durable consumer on the order service's stream,
filtered on its subject, reads the event's name off the header the estate
agreed on, translates the JSON into that shape and hands it to Spring's
in-process publisher. The policy listens with a plain `@EventListener` and
calls a use case, which is idempotent because delivery is at least once.

Option 3 was rejected because a cancellation is a fact, not a request: the
order service does not know who needs to unwind what, and should not.

#### Consequences

- Good: the policy's imports are its own application layer and a use case.
- Good: at least once, with a durable name, so downtime is not loss.
- Bad: a second subscriber class per publishing service; the manifest has
  to say which aggregate the foreign shape belongs to.
- Neutral: with no bus configured the adapter reads nothing and says so once.
