# Flows

*Generated from the portolan catalog · commit `6 sources` · at 2026-08-29T09:14:22Z. Do not edit by hand.*

| Flow | Owner | Summary |
| --- | --- | --- |
| [Checkout](checkout.md) | [shop](../shop/README.md) | Basket to dispatch, as the e2e suite drives it: a priced basket, a risk call whose peer is not in the catalog, an outbox publish, an authorization at the gateway, a capture retried with backoff, and a shipment held until the money lands. Three branches and two hops are read from the code rather than observed. |
| [Gateway webhook](gateway-webhook.md) | [payments](../payments/README.md) | The gateway's side of the story, arriving after the fact. One signed callback, four ways to read it: a replay to ignore, a capture to record, a charge with no local payment to adopt, and a failure to pass on. The adopt branch is the only repair for a checkout that timed out mid-authorization, and it is the one branch no test covers. |
| [Order accepted](order-accepted.md) | [shop](../shop/README.md) | The narrow slice one integration test pins end to end: an order commits with its outbox row, the relay publishes it, the ledger picks it up and the authorization comes back. Every hop here is asserted, which is why this is the only flow with no gaps in it. |
| [Order cancelled](order-cancelled.md) | [shop](../shop/README.md) | A customer cancels before the parcel moves, and two compensations run side by side: the money is unwound at the gateway, and the stop is taken off the route. Whether the money is voided or refunded depends on how far payment got, and the delivery half is declared everywhere and observed nowhere. |
| [Quote expired on checkout](quote-expired-on-checkout.md) | [shop](../shop/README.md) | A basket that has been checked out is a basket whose quote is spent. Pricing hears the event the cart publishes and expires the quote it issued for that basket, so a second checkout of the same basket has to be priced again rather than reuse a number the price list may have moved on from. |
| [Refund requested](refund-requested.md) | [shop](../shop/README.md) | How a support-initiated refund is meant to travel: the window is read off the shipment, an undispatched parcel is recalled first, and the money is returned through the ledger. Written by hand from the design doc — not one step has been observed in a test or a trace, which is why every hop on this page is declared. |
| [Shipment tracking](shipment-tracking.md) | [delivery](../delivery/README.md) | Reconstructed from production traces over a 24 hour window: the tracking page, the carrier's scan webhook, and what each scan code sets off. Two things only the traces know about — a consumer no repository accounts for, and an exception path whose reader emits no spans at all. |
| [Change password](auth-change-password.md) | [auth](../auth/README.md) | Replaces the password of a user, given the current one. |
| [Get user](auth-get-user.md) | [auth](../auth/README.md) | Reads a user by id. |
| [Login](auth-login.md) | [auth](../auth/README.md) | Turns credentials into a session. |
| [Logout](auth-logout.md) | [auth](../auth/README.md) | Ends the session behind a token. |
| [Register user](auth-register-user.md) | [auth](../auth/README.md) | Creates a user from an email address and a password. |
| [Validate session](auth-validate-session.md) | [auth](../auth/README.md) | Resolves a token to a live session: who is calling, and how long the answer stays good. |
| [Revoke sessions on password change](auth-revoke-sessions-on-password-change.md) | [auth](../auth/README.md) | Ends the sessions issued against a password that has just been replaced. |
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
