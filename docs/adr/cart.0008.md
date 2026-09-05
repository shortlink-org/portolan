# cart.0008 — Events leave the service over NATS JetStream, and the outbox stays

*Generated from the portolan catalog · commit `6 sources` · at 2026-09-05T03:58:04Z. Do not edit by hand.*

- **Status:** accepted
- **Date:** 2026-09-05
- **Scope:** [shop.cart](../shop/cart/README.md)
- **Source:** `examples/shop/cart/docs/adr/0008-events-leave-over-nats-jetstream.md`

### Context and Problem Statement

Until now every event the cart published was delivered in process: the relay
read the outbox and handed each row to subscribers in the same Node process,
of which there were none. `BasketCheckedOut` is the event the order service
is placed from, and that service is another process in another language. How
does an event get from this process to that one?

### Decision Drivers

- The outbox is the commit boundary (cart.0001): an event is recorded in the
  same transaction as the change that caused it, and nothing about crossing a
  process may weaken that.
- A consumer may be down when the event is published, and may start later.
- One request should read as one trace across both services.
- Without a broker the service must still run, alone, with the tests it has.

### Considered Options

1. NATS JetStream: the relay publishes each row to a stream; a consumer is a
   durable subscription.
2. Kafka, through Redpanda locally.
3. The consumer reads this service's outbox table.

### Decision Outcome

Option 1. One stream per service, `shop-cart`, over every subject under
`shop.cart.`; the outbox row's topic is the subject, so the same name is on
the row and on the wire and there is nothing to map. The row's uuid is the
message id: the relay stays at least once, and the stream drops a repeat
inside its two-hour window, so a crash between the publish and the mark is a
duplicate the broker absorbs rather than one a consumer has to. The row's
metadata rides as headers - the event's name and the trace context, the
latter under the keys the Go services use and as `traceparent` for a client
with a standard propagator - so a subscriber dispatches and continues the
trace without opening the payload.

The bus is an interface. `NATS_URL` set, it is the stream; unset, it is the
in-process bus it always was, and the relay cannot tell which it holds. The
tests that need a server start one in Docker and are skipped without it.

Option 3 was rejected because it makes the outbox a contract, and a table
somebody else reads is one this service can no longer change. Option 2 does
the job and costs a JVM-sized process for an estate of three services.

#### Consequences

- Good: a consumer that starts late reads what it missed, and the estate's
  first cross-service event hop is observable end to end.
- Good: the relay's span now says which bus it published to, and the consume
  span is opened by the bus around the subscriber: before this the relay
  opened it, and the catalog read the cart as a verified consumer of its own
  events.
- Bad: one more process to run, and one more thing to be told about in the
  environment.
- Note: the topic changed from `cart_basket` to `shop.cart.basket`. The
  outbox is local and short-lived, so no row was migrated.
