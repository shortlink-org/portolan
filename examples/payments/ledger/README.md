# Ledger

Service `ledger` — bounded context **payments**. Java on Spring Boot.

Owns money. Every authorisation, capture and refund against an order passes
through here, and what it writes is the record the business is audited on.
Nothing it holds is updated in place: a movement of money is a pair of postings
that sum to zero, and a correction is another pair.

## What it does

- Asks the gateway to hold the money for an order, and records either the hold
  or the refusal — `PaymentAuthorized` or `PaymentDeclined`.
- Captures what was held, writes the pair of postings for it, and says
  `PaymentCaptured`. That is the message anything waiting to be paid listens for.
- Sends money back against a captured payment, in full or in part, and says
  `RefundIssued`.
- Gives back a hold nobody will be charged for, when the order it was held for
  is cancelled. The fact arrives from the order service over the bus.

## What it does not do

Does not decide *whether* to charge — that is the order's business, and the
ledger is asked; a cancelled order is the one thing it refuses to charge on
its own. Does not decide anything when the gateway does not answer: nothing
is recorded, and the caller is told to try again (ledger.0001). Does not issue invoices: what a customer is *asked* to pay is
`shop.billing`'s aggregate, and this one only says what happened to the money.
Does not store card data; the gateway holds the instrument and this holds a
token for it.

## Publishes

`PaymentAuthorized`, `PaymentCaptured`, `PaymentDeclined` on
`payments.ledger.payment`; `RefundIssued` on `payments.ledger.refund`.

## Provides

`payments.v1.PaymentService` — Authorize, Capture, GetPayment — and
`payments.v1.RefundService` — IssueRefund, ListRefunds. One contract per
aggregate, under the transport package that answers it, each its own buf
module with its own `buf.yaml`.

Both are published: `buf.build/shortlink-org/portolan-payments-payment` and
`buf.build/shortlink-org/portolan-payments-refund`, one module per aggregate.
A change to either is pushed from its own directory, and the estate reads the
module name off `portolan.json`:

```bash
cd src/main/java/org/portolan/payments/ledger/infrastructure/transport/grpc/payment/proto && buf push
cd ../../refund/proto && buf push
```

## How the catalog reads it

The vocabulary is [GLOSSARY.md](GLOSSARY.md). Nothing here is annotated for
the catalog, but plenty is annotated for the model: `@AggregateRoot`, `@Entity`, `@ValueObject`, `@Repository`,
`@SecondaryPort` and `@DomainEvent` are jMolecules, and `extract-java` reads
what they say rather than guessing from the layout. The rules are in
[plugins/extract-java/README.md](../../../plugins/extract-java/README.md).

Two things follow from that and are worth knowing when reading the pages:

- A `@Repository` is the store, and any other port goes wherever its adapter
  reaches. `PaymentGateway` is filled by `StripeGateway`, and the far end is a
  third party: nobody in the estate provides Stripe, and the catalog does not
  pretend otherwise. What it has is a narrow copy of Stripe's own OpenAPI
  document beside the adapter — the four operations the ledger calls — so each
  call lands on the operation the copy declares (`stripe.v1/PostPaymentIntents`)
  and is **declared**, while the lane says the far end is **outside the
  estate** (ledger.0003).
- The lifecycle is `PaymentStatus.TRANSITIONS`, not the branches of the methods.
  A move the table does not allow is a diagnostic, not a new arrow.

## Running it

```bash
docker compose up -d db
mvn -q spring-boot:run
```

`NATS_URL` picks the bus: with a server named, events leave on their channel
with their wire name in the headers; without one they are written to the log and
nothing leaves. `OMS_ADDRESS` is where `shop.v1.OrderService` answers.
`STRIPE_SECRET_KEY` is the account the money moves through — a test key
locally — and `STRIPE_URL` points the gateway at a stand-in that answers on
Stripe's routes instead of at Stripe.

## Decisions

- [payments.0004](../../../docs/adr/payments.0004.md) — journal rows are
  idempotent by `(order_id, attempt)`, which is why `payments` carries an
  `attempt` and a unique key over the pair. The attempt is minted here, one
  past the last recorded for the order, and the key's refusal is a sentinel.
- [ledger.0001](docs/adr/0001-a-gateway-outage-records-nothing.md) — a
  gateway that did not answer has not refused; nothing is recorded.
- [ledger.0002](docs/adr/0002-foreign-events-arrive-over-nats-and-are-republished-in-process.md)
  — the order service's events are read off the bus by an adapter and handed
  to the policies in process.
- [ledger.0003](docs/adr/0003-the-card-network-is-stripe-and-stays-outside-the-estate.md)
  — the gateway is Stripe, kept outside the estate with a narrow copy of its
  contract beside the adapter, so the calls resolve and nothing is invented.

## Status

A sketch for the catalog, not the reference service; `examples/auth` is
that. What it has: the aggregates with their lifecycle tables enforced, the
use cases with closed answers, a policy fed from the bus, and the records
above. What it deliberately does not have yet, and the review skill will
name: no version on the aggregates, so a stale copy is not refused; events
published after the save rather than with it, so there is no outbox and a
crash between the two loses the fact; no tests; no tracing. Each is a known
gap, not an oversight, and none of them changes what the catalog shows.
