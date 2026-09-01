# Example estate

*Generated from the portolan catalog · commit `2 sources` · at 2026-08-29T09:14:22Z. Do not edit by hand.*


## Contexts

| Context | Class | Services | Summary |
| --- | --- | --- | --- |
| [Shop](shop/README.md) | core | [Order Management](shop/oms/README.md), [Pricing](shop/pricing/README.md) | Everything the customer touches before money moves: baskets, orders and prices. |
| [Payments](payments/README.md) | core | [Ledger](payments/ledger/README.md) | A double-entry ledger and the PSP integrations that feed it. Nothing here knows what an order is for. |
| [Delivery](delivery/README.md) | supporting | [Delivery Core](delivery/core/README.md) | Routes, parcels and proof of delivery. Reacts to captured payments, never to placed orders. |
| [Authentication](auth/README.md) | core | [Authentication & Sessions](auth/auth/README.md) | Who someone is, and whether they are still logged in. The only service in the estate that stores credentials, and the only one allowed to mint or revoke a session. |

## Flows

| Flow | Provenance | Summary |
| --- | --- | --- |
| [Order accepted](flows/order-accepted.md) | derived-from-test | The narrow slice one integration test pins end to end: an order commits with its outbox row, the relay publishes it, the ledger picks it up and the authorization comes back. Every hop here is asserted, which is why this is the only flow with no gaps in it. |
| [Checkout](flows/checkout.md) | derived-from-test | Basket to dispatch, as the e2e suite drives it: a priced basket, a risk call whose peer is not in the catalog, an outbox publish, an authorization at the gateway, a capture retried with backoff, and a shipment held until the money lands. Three branches and two hops are read from the code rather than observed. |
| [Refund requested](flows/refund-requested.md) | authored | How a support-initiated refund is meant to travel: the window is read off the shipment, an undispatched parcel is recalled first, and the money is returned through the ledger. Written by hand from the design doc — not one step has been observed in a test or a trace, which is why every hop on this page is declared. |
| [Shipment tracking](flows/shipment-tracking.md) | derived-from-otel | Reconstructed from production traces over a 24 hour window: the tracking page, the carrier's scan webhook, and what each scan code sets off. Two things only the traces know about — a consumer no repository accounts for, and an exception path whose reader emits no spans at all. |
| [Gateway webhook](flows/gateway-webhook.md) | derived-from-test | The gateway's side of the story, arriving after the fact. One signed callback, four ways to read it: a replay to ignore, a capture to record, a charge with no local payment to adopt, and a failure to pass on. The adopt branch is the only repair for a checkout that timed out mid-authorization, and it is the one branch no test covers. |
| [Order cancelled](flows/order-cancelled.md) | derived-from-test | A customer cancels before the parcel moves, and two compensations run side by side: the money is unwound at the gateway, and the stop is taken off the route. Whether the money is voided or refunded depends on how far payment got, and the delivery half is declared everywhere and observed nowhere. |

## Decisions

| ADR | Title | Status | Date |
| --- | --- | --- | --- |
| [shop.oms.0007](adr/shop.oms.0007.md) | Cart reads go through CartRepository, not Temporal Queries | accepted | 2026-04-23 |
| [shop.oms.0003](adr/shop.oms.0003.md) | Read cart state via Temporal QueryWorkflow | superseded | 2025-06-18 |
| [org.0001](adr/org.0001.md) | Client proto copies live in the consumer's infrastructure layer | accepted | 2025-03-11 |
| [org.0002](adr/org.0002.md) | Domain event schema version is encoded in the package path (events/v1) | accepted | 2025-05-02 |
| [payments.0004](adr/payments.0004.md) | Journal entries are idempotent by (order_id, attempt) | proposed | 2026-02-09 |
