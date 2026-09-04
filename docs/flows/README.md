# Flows

*Generated from the portolan catalog · commit `7 sources` · at 2026-08-29T09:14:22Z. Do not edit by hand.*

| Flow | Owner | Summary |
| --- | --- | --- |
| [Gateway webhook](gateway-webhook.md) | [payments](../payments/README.md) | The gateway's side of the story, arriving after the fact. One signed callback, four ways to read it: a replay to ignore, a capture to record, a charge with no local payment to adopt, and a failure to pass on. The adopt branch is the only repair for a checkout that timed out mid-authorization, and it is the one branch no test covers. |
| [Shipment tracking](shipment-tracking.md) | [delivery](../delivery/README.md) | Reconstructed from production traces over a 24 hour window: the tracking page, the carrier's scan webhook, and what each scan code sets off. Two things only the traces know about — a consumer no repository accounts for, and an exception path whose reader emits no spans at all. |
| [Change password](auth-change-password.md) | [auth](../auth/README.md) | Replaces the password of a user, given the current one. |
| [Get user](auth-get-user.md) | [auth](../auth/README.md) | Reads a user by id. |
| [Login](auth-login.md) | [auth](../auth/README.md) | Turns credentials into a session. |
| [Logout](auth-logout.md) | [auth](../auth/README.md) | Ends the session behind a token. |
| [Register user](auth-register-user.md) | [auth](../auth/README.md) | Creates a user from an email address and a password. |
| [Validate session](auth-validate-session.md) | [auth](../auth/README.md) | Resolves a token to a live session: who is calling, and how long the answer stays good. |
| [Revoke sessions on password change](auth-revoke-sessions-on-password-change.md) | [auth](../auth/README.md) | Ends the sessions issued against a password that has just been replaced. |
| [Authorize](ledger-authorize.md) | [payments](../payments/README.md) | Asks the gateway to hold the money for an order, and records either that it agreed or that it refused. |
| [Capture](ledger-capture.md) | [payments](../payments/README.md) | Moves the money the gateway was holding, writes the pair of postings for it, and says so on the bus. |
| [Get payment](ledger-get-payment.md) | [payments](../payments/README.md) | Reads one payment, for whoever is asking what happened to the money. |
| [Issue refund](ledger-issue-refund.md) | [payments](../payments/README.md) | Sends money back against a captured payment, in full or in part. |
| [List refunds](ledger-list-refunds.md) | [payments](../payments/README.md) | Every refund against one payment, newest first. |
| [Void payment on order cancelled](ledger-void-payment-on-order-cancelled.md) | [payments](../payments/README.md) | Gives back what was held once the order it was held for is gone. |
| [Invoice create](billing-invoice-create.md) | [shop](../shop/README.md) | Draws up a draft invoice for an order, with a line for each thing sold. |
| [Invoice destroy](billing-invoice-destroy.md) | [shop](../shop/README.md) | Ends an invoice nobody is going to pay. |
| [Invoice issue](billing-invoice-issue.md) | [shop](../shop/README.md) | Confirms the session, freezes the invoice and asks the customer to pay. |
| [Invoice retrieve](billing-invoice-retrieve.md) | [shop](../shop/README.md) | Reads one invoice and the lines it is made of. |
| [Close invoice on payment](billing-close-invoice-on-payment.md) | [shop](../shop/README.md) | Closes the invoice for an order once the ledger says the money arrived. |
| [Add item](cart-add-item.md) | [shop](../shop/README.md) | — |
| [Checkout](cart-checkout.md) | [shop](../shop/README.md) | — |
| [Create basket](cart-create-basket.md) | [shop](../shop/README.md) | — |
| [Get basket](cart-get-basket.md) | [shop](../shop/README.md) | — |
| [Merge baskets](cart-merge-baskets.md) | [shop](../shop/README.md) | — |
| [Remove item](cart-remove-item.md) | [shop](../shop/README.md) | — |
| [Cancel order](oms-cancel-order.md) | [shop](../shop/README.md) | Answers with the order as it is now; a cancelled order is still found. |
| [Get order](oms-get-order.md) | [shop](../shop/README.md) | Answers with the order as it is now; a cancelled order is still found. |
| [Confirm order on payment authorized](oms-confirm-order-on-payment-authorized.md) | [shop](../shop/README.md) | Confirms the order once the payment for it is authorised (ADR oms.0005). The publisher is `payments.ledger`, and the name is the one it puts on the message: every service on this bus names its events after itself. |
| [Place order on basket checked out](oms-place-order-on-basket-checked-out.md) | [shop](../shop/README.md) | Places the order the basket was checked out for (ADR oms.0002). The order takes the basket's id, so the same checkout heard twice places one order. |
| [Archive price list](pricing-archive-price-list.md) | [shop](../shop/README.md) | Package archive_price_list takes a price list out of use without losing it. |
| [Get quote](pricing-get-quote.md) | [shop](../shop/README.md) | Package get_quote reads one quote. |
| [Import price list](pricing-import-price-list.md) | [shop](../shop/README.md) | Package import_price_list takes in a whole price list. |
| [Issue quote](pricing-issue-quote.md) | [shop](../shop/README.md) | Package issue_quote prices a basket and promises the price for a while. |
| [List price lists](pricing-list-price-lists.md) | [shop](../shop/README.md) | Package list_price_lists reads every price list there is. |
| [Expire quote on checkout](pricing-expire-quote-on-checkout.md) | [shop](../shop/README.md) | Ends the promise once the basket it priced is checked out. |
