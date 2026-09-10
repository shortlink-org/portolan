# oms.0006 — OrderPlaced requests ledger authorization; confirmation applies a fact

*Generated from the portolan catalog. Do not edit by hand.*

- **Status:** accepted
- **Date:** 2026-09-10
- **Scope:** [shop.oms](../shop/oms/README.md)
- **Source:** [`examples/shop/oms/docs/adr/0006-order-placed-requests-ledger-authorization.md`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/oms/docs/adr/0006-order-placed-requests-ledger-authorization.md)
- **Committed:** Victor Login, 2026-09-10 (`2431809`)
- **Supersedes:** [oms.0005](oms.0005.md)

### Context and Problem Statement

The ledger now provides PaymentService, but OMS's old narrowed proto has
incompatible field numbers and its authorization subscription disagrees with
the producer's event name. Nothing requests payment after placement, while the
old authorization-event policy calls Authorize again.

### Decision Drivers

- Start payment only after the order is committed and readable by ledger.
- Use the provider's real public contract and preserve refusal versus outage.
- Retrying delivery must reuse one payment id and must not reconfirm an order.

### Considered Options

1. Ask ledger inside the checkout subscriber immediately after placing the order.
2. React to the durable OrderPlaced and apply either the RPC answer or the ledger fact.
3. Introduce a durable workflow engine for the entire fulfilment process now.

### Decision Outcome

Choose option 2. OrderPlaced is already in the transactional outbox and survives
an OMS crash after placement. Its policy invokes request_payment using the order
id as payment id for this one checkout attempt. The adapter consumes payment_id,
authorized and the closed refusal set from ledger's actual proto.

The separate confirm_order operation has no payment port. Both a successful
RPC answer and ledger.PaymentAuthorized reach it, validating the payment/order
identity and amount. Confirmed or cancelled orders do not transition again.
Optimistic conflicts fail delivery, which can be retried against current state.
The existing OrderConfirmed authorizationId field carries the public payment id
for compatibility; it never carries the private gateway handle.

A confirmed decline is acknowledged and leaves the order placed. A timeout or
unknown contract outcome remains an error. A new payment attempt, capture,
compensation and fulfilment orchestration are separate decisions.

### Consequences

- State is committed before ledger's GetOrder call.
- Repeated checkout, OrderPlaced and authorization deliveries cannot emit another confirmation.
- Confirmation from the RPC answer can recover a stored ledger result even if
  its event publication failed; ledger still needs its own outbox for other consumers.
- This does not resolve an external gateway success lost before ledger persisted
  it, concurrent ledger requests, or cancellation racing a remote authorization.
  Those require gateway idempotency and durable compensation, not a proto change.
