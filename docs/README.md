# Example estate

*Generated from the portolan catalog · commit `7 sources` · at 2026-08-29T09:14:22Z. Do not edit by hand.*


## Contexts

| Context | Class | Services | Summary |
| --- | --- | --- | --- |
| [Delivery](delivery/README.md) | supporting | [Delivery Core](delivery/core/README.md) | Routes, parcels and proof of delivery. Reacts to captured payments, never to placed orders. |
| [Authentication](auth/README.md) | core | [Authentication & Sessions](auth/auth/README.md) | Who someone is, and whether they are still logged in. The only service in the estate that stores credentials, and the only one allowed to mint or revoke a session. |
| [Payments](payments/README.md) | core | [Ledger](payments/ledger/README.md) | Money, and the record of every movement of it. Nothing here decides whether to charge - it is asked, and it writes down what happened either way. |
| [Shop](shop/README.md) | — | [Billing](shop/billing/README.md), [Shopping Cart](shop/cart/README.md), [Order Management](shop/oms/README.md), [Pricing](shop/pricing/README.md) | — |

## Flows

| Flow | Owner | Summary |
| --- | --- | --- |
| [Gateway webhook](flows/gateway-webhook.md) | [payments](payments/README.md) | The gateway's side of the story, arriving after the fact. One signed callback, four ways to read it: a replay to ignore, a capture to record, a charge with no local payment to adopt, and a failure to pass on. The adopt branch is the only repair for a checkout that timed out mid-authorization, and it is the one branch no test covers. |
| [Shipment tracking](flows/shipment-tracking.md) | [delivery](delivery/README.md) | Reconstructed from production traces over a 24 hour window: the tracking page, the carrier's scan webhook, and what each scan code sets off. Two things only the traces know about — a consumer no repository accounts for, and an exception path whose reader emits no spans at all. |
| [Change password](flows/auth-change-password.md) | [auth](auth/README.md) | Replaces the password of a user, given the current one. |
| [Get user](flows/auth-get-user.md) | [auth](auth/README.md) | Reads a user by id. |
| [Login](flows/auth-login.md) | [auth](auth/README.md) | Turns credentials into a session. |
| [Logout](flows/auth-logout.md) | [auth](auth/README.md) | Ends the session behind a token. |
| [Register user](flows/auth-register-user.md) | [auth](auth/README.md) | Creates a user from an email address and a password. |
| [Validate session](flows/auth-validate-session.md) | [auth](auth/README.md) | Resolves a token to a live session: who is calling, and how long the answer stays good. |
| [Revoke sessions on password change](flows/auth-revoke-sessions-on-password-change.md) | [auth](auth/README.md) | Ends the sessions issued against a password that has just been replaced. |
| [Authorize](flows/ledger-authorize.md) | [payments](payments/README.md) | Asks the gateway to hold the money for an order, and records either that it agreed or that it refused. |
| [Capture](flows/ledger-capture.md) | [payments](payments/README.md) | Moves the money the gateway was holding, writes the pair of postings for it, and says so on the bus. |
| [Get payment](flows/ledger-get-payment.md) | [payments](payments/README.md) | Reads one payment, for whoever is asking what happened to the money. |
| [Issue refund](flows/ledger-issue-refund.md) | [payments](payments/README.md) | Sends money back against a captured payment, in full or in part. |
| [List refunds](flows/ledger-list-refunds.md) | [payments](payments/README.md) | Every refund against one payment, newest first. |
| [Void payment on order cancelled](flows/ledger-void-payment-on-order-cancelled.md) | [payments](payments/README.md) | Gives back what was held once the order it was held for is gone. |
| [Invoice create](flows/billing-invoice-create.md) | [shop](shop/README.md) | Draws up a draft invoice for an order, with a line for each thing sold. |
| [Invoice destroy](flows/billing-invoice-destroy.md) | [shop](shop/README.md) | Ends an invoice nobody is going to pay. |
| [Invoice issue](flows/billing-invoice-issue.md) | [shop](shop/README.md) | Confirms the session, freezes the invoice and asks the customer to pay. |
| [Invoice retrieve](flows/billing-invoice-retrieve.md) | [shop](shop/README.md) | Reads one invoice and the lines it is made of. |
| [Close invoice on payment](flows/billing-close-invoice-on-payment.md) | [shop](shop/README.md) | Closes the invoice for an order once the ledger says the money arrived. |
| [Add item](flows/cart-add-item.md) | [shop](shop/README.md) | — |
| [Checkout](flows/cart-checkout.md) | [shop](shop/README.md) | — |
| [Create basket](flows/cart-create-basket.md) | [shop](shop/README.md) | — |
| [Get basket](flows/cart-get-basket.md) | [shop](shop/README.md) | — |
| [Merge baskets](flows/cart-merge-baskets.md) | [shop](shop/README.md) | — |
| [Remove item](flows/cart-remove-item.md) | [shop](shop/README.md) | — |
| [Cancel order](flows/oms-cancel-order.md) | [shop](shop/README.md) | Answers with the order as it is now; a cancelled order is still found. |
| [Get order](flows/oms-get-order.md) | [shop](shop/README.md) | Answers with the order as it is now; a cancelled order is still found. |
| [Confirm order on payment authorized](flows/oms-confirm-order-on-payment-authorized.md) | [shop](shop/README.md) | Confirms the order once the payment for it is authorised (ADR oms.0005). The publisher is `payments.ledger`, and the name is the one it puts on the message: every service on this bus names its events after itself. |
| [Place order on basket checked out](flows/oms-place-order-on-basket-checked-out.md) | [shop](shop/README.md) | Places the order the basket was checked out for (ADR oms.0002). The order takes the basket's id, so the same checkout heard twice places one order. |
| [Archive price list](flows/pricing-archive-price-list.md) | [shop](shop/README.md) | Package archive_price_list takes a price list out of use without losing it. |
| [Get quote](flows/pricing-get-quote.md) | [shop](shop/README.md) | Package get_quote reads one quote. |
| [Import price list](flows/pricing-import-price-list.md) | [shop](shop/README.md) | Package import_price_list takes in a whole price list. |
| [Issue quote](flows/pricing-issue-quote.md) | [shop](shop/README.md) | Package issue_quote prices a basket and promises the price for a while. |
| [List price lists](flows/pricing-list-price-lists.md) | [shop](shop/README.md) | Package list_price_lists reads every price list there is. |
| [Expire quote on checkout](flows/pricing-expire-quote-on-checkout.md) | [shop](shop/README.md) | Ends the promise once the basket it priced is checked out. |

## Decisions

| ADR | Title | Status | Date |
| --- | --- | --- | --- |
| [org.0001](adr/org.0001.md) | Client proto copies live in the consumer's infrastructure layer | accepted | 2025-03-11 |
| [org.0002](adr/org.0002.md) | Domain event schema version is encoded in the package path (events/v1) | accepted | 2025-05-02 |
| [payments.0004](adr/payments.0004.md) | Journal entries are idempotent by (order_id, attempt) | proposed | 2026-02-09 |
