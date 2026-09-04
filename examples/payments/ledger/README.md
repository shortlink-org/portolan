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
  is cancelled.

## What it does not do

Does not decide *whether* to charge — that is the order's business, and the
ledger is asked. Does not issue invoices: what a customer is *asked* to pay is
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

Nothing here is annotated for the catalog, but plenty is annotated for the
model: `@AggregateRoot`, `@Entity`, `@ValueObject`, `@Repository`,
`@SecondaryPort` and `@DomainEvent` are jMolecules, and `extract-java` reads
what they say rather than guessing from the layout. The rules are in
[plugins/extract-java/README.md](../../../plugins/extract-java/README.md).

Two things follow from that and are worth knowing when reading the pages:

- A `@Repository` is the store, and any other port goes wherever its adapter
  reaches. `PaymentGateway` is filled by `PspGateway`, which has no vendored
  contract because the far end is a third party — so those calls are recorded
  and left **unresolved**, which is the true answer to "who answers this".
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

## Decisions

- [payments.0004](../../../docs/adr/payments.0004.md) — journal rows are
  idempotent by `(order_id, attempt)`, which is why `payments` carries an
  `attempt` and a unique key over the pair.
