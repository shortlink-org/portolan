# Flows

*Generated from the portolan catalog · commit `2 sources` · at 2026-08-29T09:14:22Z. Do not edit by hand.*

| Flow | Owner | Summary |
| --- | --- | --- |
| [Order accepted](order-accepted.md) | [shop](../shop/README.md) | The narrow slice one integration test pins end to end: an order commits with its outbox row, the relay publishes it, the ledger picks it up and the authorization comes back. Every hop here is asserted, which is why this is the only flow with no gaps in it. |
| [Checkout](checkout.md) | [shop](../shop/README.md) | Basket to dispatch, as the e2e suite drives it: a priced basket, a risk call whose peer is not in the catalog, an outbox publish, an authorization at the gateway, a capture retried with backoff, and a shipment held until the money lands. Three branches and two hops are read from the code rather than observed. |
| [Refund requested](refund-requested.md) | [shop](../shop/README.md) | How a support-initiated refund is meant to travel: the window is read off the shipment, an undispatched parcel is recalled first, and the money is returned through the ledger. Written by hand from the design doc — not one step has been observed in a test or a trace, which is why every hop on this page is declared. |
| [Shipment tracking](shipment-tracking.md) | [delivery](../delivery/README.md) | Reconstructed from production traces over a 24 hour window: the tracking page, the carrier's scan webhook, and what each scan code sets off. Two things only the traces know about — a consumer no repository accounts for, and an exception path whose reader emits no spans at all. |
| [Gateway webhook](gateway-webhook.md) | [payments](../payments/README.md) | The gateway's side of the story, arriving after the fact. One signed callback, four ways to read it: a replay to ignore, a capture to record, a charge with no local payment to adopt, and a failure to pass on. The adopt branch is the only repair for a checkout that timed out mid-authorization, and it is the one branch no test covers. |
| [Order cancelled](order-cancelled.md) | [shop](../shop/README.md) | A customer cancels before the parcel moves, and two compensations run side by side: the money is unwound at the gateway, and the stop is taken off the route. Whether the money is voided or refunded depends on how far payment got, and the delivery half is declared everywhere and observed nowhere. |
| [Change password](auth-change-password.md) | [auth](../auth/README.md) | Replaces the password of a user, given the current one. |
| [Get user](auth-get-user.md) | [auth](../auth/README.md) | Reads a user by id. |
| [Login](auth-login.md) | [auth](../auth/README.md) | Turns credentials into a session. |
| [Logout](auth-logout.md) | [auth](../auth/README.md) | Ends the session behind a token. |
| [Register user](auth-register-user.md) | [auth](../auth/README.md) | Creates a user from an email address and a password. |
| [Validate session](auth-validate-session.md) | [auth](../auth/README.md) | Resolves a token to a live session: who is calling, and how long the answer stays good. |
| [Revoke sessions on password change](auth-revoke-sessions-on-password-change.md) | [auth](../auth/README.md) | Ends the sessions issued against a password that has just been replaced. |
