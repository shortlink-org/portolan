# Example estate

*Generated from the portolan catalog · commit `5 sources` · at 2026-08-29T09:14:22Z. Do not edit by hand.*


## Contexts

| Context | Class | Services | Summary |
| --- | --- | --- | --- |
| [Shop](shop/README.md) | core | [Pricing](shop/pricing/README.md), [Shopping Cart](shop/cart/README.md), [Order Management](shop/oms/README.md) | Everything the customer touches before money moves: baskets, orders and prices. |
| [Payments](payments/README.md) | core | [Ledger](payments/ledger/README.md) | A double-entry ledger and the PSP integrations that feed it. Nothing here knows what an order is for. |
| [Delivery](delivery/README.md) | supporting | [Delivery Core](delivery/core/README.md) | Routes, parcels and proof of delivery. Reacts to captured payments, never to placed orders. |
| [Authentication](auth/README.md) | core | [Authentication & Sessions](auth/auth/README.md) | Who someone is, and whether they are still logged in. The only service in the estate that stores credentials, and the only one allowed to mint or revoke a session. |

## Flows

| Flow | Owner | Summary |
| --- | --- | --- |
| [Gateway webhook](flows/gateway-webhook.md) | [payments](payments/README.md) | The gateway's side of the story, arriving after the fact. One signed callback, four ways to read it: a replay to ignore, a capture to record, a charge with no local payment to adopt, and a failure to pass on. The adopt branch is the only repair for a checkout that timed out mid-authorization, and it is the one branch no test covers. |
| [Quote expired on checkout](flows/quote-expired-on-checkout.md) | [shop](shop/README.md) | A basket that has been checked out is a basket whose quote is spent. Pricing hears the event the cart publishes and expires the quote it issued for that basket, so a second checkout of the same basket has to be priced again rather than reuse a number the price list may have moved on from. |
| [Shipment tracking](flows/shipment-tracking.md) | [delivery](delivery/README.md) | Reconstructed from production traces over a 24 hour window: the tracking page, the carrier's scan webhook, and what each scan code sets off. Two things only the traces know about — a consumer no repository accounts for, and an exception path whose reader emits no spans at all. |
| [Change password](flows/auth-change-password.md) | [auth](auth/README.md) | Replaces the password of a user, given the current one. |
| [Get user](flows/auth-get-user.md) | [auth](auth/README.md) | Reads a user by id. |
| [Login](flows/auth-login.md) | [auth](auth/README.md) | Turns credentials into a session. |
| [Logout](flows/auth-logout.md) | [auth](auth/README.md) | Ends the session behind a token. |
| [Register user](flows/auth-register-user.md) | [auth](auth/README.md) | Creates a user from an email address and a password. |
| [Validate session](flows/auth-validate-session.md) | [auth](auth/README.md) | Resolves a token to a live session: who is calling, and how long the answer stays good. |
| [Revoke sessions on password change](flows/auth-revoke-sessions-on-password-change.md) | [auth](auth/README.md) | Ends the sessions issued against a password that has just been replaced. |
| [Add item](flows/cart-add-item.md) | [shop](shop/README.md) | — |
| [Checkout](flows/cart-checkout.md) | [shop](shop/README.md) | — |
| [Create basket](flows/cart-create-basket.md) | [shop](shop/README.md) | — |
| [Get basket](flows/cart-get-basket.md) | [shop](shop/README.md) | — |
| [Merge baskets](flows/cart-merge-baskets.md) | [shop](shop/README.md) | — |
| [Remove item](flows/cart-remove-item.md) | [shop](shop/README.md) | — |
| [Cancel order](flows/oms-cancel-order.md) | [shop](shop/README.md) | Answers with the order as it is now; a cancelled order is still found. |
| [Get order](flows/oms-get-order.md) | [shop](shop/README.md) | Answers with the order as it is now; a cancelled order is still found. |
| [Confirm order on payment authorized](flows/oms-confirm-order-on-payment-authorized.md) | [shop](shop/README.md) | Confirms the order once the payment for it is authorised (ADR oms.0005). Declared ahead of its publisher: nothing in the estate says `payments.PaymentAuthorized` yet, and the catalog says so. |
| [Place order on basket checked out](flows/oms-place-order-on-basket-checked-out.md) | [shop](shop/README.md) | Places the order the basket was checked out for (ADR oms.0002). The order takes the basket's id, so the same checkout heard twice places one order. |

## Decisions

| ADR | Title | Status | Date |
| --- | --- | --- | --- |
| [org.0001](adr/org.0001.md) | Client proto copies live in the consumer's infrastructure layer | accepted | 2025-03-11 |
| [org.0002](adr/org.0002.md) | Domain event schema version is encoded in the package path (events/v1) | accepted | 2025-05-02 |
| [payments.0004](adr/payments.0004.md) | Journal entries are idempotent by (order_id, attempt) | proposed | 2026-02-09 |
