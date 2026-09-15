# core.0003 — Delivery asks the ledger to capture when it creates the shipment

*Generated from the portolan catalog. Do not edit by hand.*

- **Status:** accepted
- **Date:** 2026-09-15
- **Scope:** [delivery.core](../delivery/core/README.md)
- **Source:** [`examples/shop/delivery/core/docs/adr/0003-delivery-asks-for-the-capture-when-it-creates-the-shipment.md`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/delivery/core/docs/adr/0003-delivery-asks-for-the-capture-when-it-creates-the-shipment.md)

### Context and Problem Statement

The order service confirms an order once the ledger has authorized its
payment, and says `OrderConfirmed`. The shipment waits for `PaymentCaptured`
before anything leaves the warehouse (core.0002). Nothing in the estate asks
the ledger to capture, so nothing is ever released: the chain stops between
the order and the parcel.

Who asks for the capture, and when? The obvious answer - the order service,
the moment it confirms - puts the timing of the money in a service that does
not ship anything, and leaves the waiting room in delivery waiting for a
decision taken elsewhere.

### Decision Drivers

- The service that holds the parcel decides when the money for it moves; the
  service that holds the order decides whether there is an order.
- The capture must be asked of a shipment that already exists, because the
  fact the ledger answers with releases that shipment.
- Whatever is decided must be moveable later without the order service or
  the ledger changing.
- A repeated confirmation, or a ledger that did not answer, must neither lose
  the capture nor ask twice for money that already moved.

### Considered Options

1. **The order service captures on confirmation** — a second call from
   `confirm_order`, right after the authorization it already asks for.
2. **Delivery captures when it creates the shipment** — the policy that hears
   `OrderConfirmed` runs `create_shipment`, which stores the shipment waiting
   for the money and then asks the ledger to capture.
3. **Delivery captures when the shipment is packed** — a `packed` state
   between creation and release, entered once the parcels and the address are
   known, and the capture asked there.

### Decision Outcome

Chosen option: **delivery captures when it creates the shipment**.

| | who decides when money moves | new state | refund window | moveable by delivery alone |
|---|---|---|---|---|
| oms on confirmation | the order service | none | from confirmation | no |
| delivery on creation | delivery | none | from confirmation | yes |
| delivery when packed | delivery | `packed` | from packing | yes |

Option 1 was rejected because it makes the order service decide the moment a
fulfilment it does not perform commits the customer's money, and a warehouse
that wanted to capture later would need the order service to change. Option 3
is the right place for a real warehouse, and it is not taken because nothing
in the estate hands delivery the parcels or the address yet: a `packed` state
nobody can enter would be a row in the lifecycle table that no command makes.

What is given up is the window between confirmation and packing in which a
cancellation is a void rather than a refund: capturing on creation captures
almost at once. The mitigation is that the moment is delivery's own - moving
the capture to packing, once packing exists, is a change to `create_shipment`
and a new state here, with the order service and the ledger untouched.

The order of steps is the rule. The shipment is stored first, `ShipmentCreated`
with it, and only then is the ledger asked, because the ledger says
`PaymentCaptured` while answering and `release_shipment` must find the shipment.
The payment is named by the order id (oms.0006). Errors follow the estate's
convention: `NOT_FOUND` and `FAILED_PRECONDITION` from the ledger are refusals
the use case answers with and leaves the shipment waiting; every other status
decided nothing and fails the delivery of the fact, which is delivered again.

#### Consequences

- Good: `OrderConfirmed` → `create_shipment` → `payments.v1.PaymentService/Capture`
  → `PaymentCaptured` → `release_shipment` is one chain the catalog can draw
  across three services, each step owned by the service whose state it moves.
- Good: a repeated confirmation finds the shipment it made; a capture that was
  lost is asked again while the shipment waits, and the ledger answers a
  second capture with the first.
- Bad: a customer who cancels after confirmation is refunded, not voided -
  the ledger's `VoidPaymentOnOrderCancelled` meets a captured payment and is
  refused. Unwinding that is not decided here.
- Bad: a shipment is created with no parcels and no address, so the aggregate
  gives up "a shipment carries at least one parcel" at construction; the rule
  moves to dispatch, and planning a stop refuses a shipment with no address.
- Bad: two deliveries of the same confirmation racing each other can both find
  no shipment and create two; there is no unique key per order, because a
  written-off shipment is followed by a new one for the same order.
- Neutral: delivery now reads the bus, through the same kind of durable
  consumer the ledger uses (ledger.0002), which core.0002 was waiting for.
