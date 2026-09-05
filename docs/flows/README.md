# Flows

*Generated from the portolan catalog · commit `5 sources` · at 2026-09-05T03:58:04Z. Do not edit by hand.*

| Flow | Owner | Summary |
| --- | --- | --- |
| [Change password](auth-change-password.md) | [auth](../auth/README.md) | Replaces the password of a user, given the current one. |
| [Get user](auth-get-user.md) | [auth](../auth/README.md) | Reads a user by id. |
| [Login](auth-login.md) | [auth](../auth/README.md) | Turns credentials into a session. |
| [Logout](auth-logout.md) | [auth](../auth/README.md) | Ends the session behind a token. |
| [Register user](auth-register-user.md) | [auth](../auth/README.md) | Creates a user from an email address and a password. |
| [Validate session](auth-validate-session.md) | [auth](../auth/README.md) | Resolves a token to a live session: who is calling, and how long the answer stays good. |
| [Revoke sessions on password change](auth-revoke-sessions-on-password-change.md) | [auth](../auth/README.md) | Ends the sessions issued against a password that has just been replaced. |
| [Query basket](bff-query-basket.md) | [storefront](../storefront/README.md) | The basket as the cart has it, in the storefront's words. |
| [Query shipment](bff-query-shipment.md) | [storefront](../storefront/README.md) | — |
| [Query order](bff-query-order.md) | [storefront](../storefront/README.md) | — |
| [Query viewer](bff-query-viewer.md) | [storefront](../storefront/README.md) | Who the request belongs to. Auth is asked on every call rather than a token being read here: this service holds no key and could not tell a forged one from a live one. |
| [Mutation add item](bff-mutation-add-item.md) | [storefront](../storefront/README.md) | Add a line. The price travels as the customer was shown it; the cart captures it and never recomputes it, and nothing here checks it - a storefront that priced things would be a second place prices live. |
| [Mutation checkout](bff-mutation-checkout.md) | [storefront](../storefront/README.md) | Freeze the basket and hand it on. |
| [Mutation remove item](bff-mutation-remove-item.md) | [storefront](../storefront/README.md) | — |
| [Mutation cancel order](bff-mutation-cancel-order.md) | [storefront](../storefront/README.md) | Cancel an order. Whether it is too late to is the order service's judgement and its refusal travels back unchanged; this service does not know what dispatch means. |
| [Subscription order status](bff-subscription-order-status.md) | [storefront](../storefront/README.md) | Every move of one order, for as long as somebody is watching it. |
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
| [Close route](core-close-route.md) | [delivery](../delivery/README.md) | Ends the day, whatever is left undone. |
| [Dispatch](core-dispatch.md) | [delivery](../delivery/README.md) | One shipment, for whoever is asking about an order. |
| [Get route](core-get-route.md) | [delivery](../delivery/README.md) | One route, as the depot reads it. |
| [Get shipment](core-get-shipment.md) | [delivery](../delivery/README.md) | One shipment, for whoever is asking about an order. |
| [Plan route](core-plan-route.md) | [delivery](../delivery/README.md) | Builds a van's day out of the shipments waiting to go out. |
| [Record delivery](core-record-delivery.md) | [delivery](../delivery/README.md) | Ends a shipment at the door. |
| [Record scan](core-record-scan.md) | [delivery](../delivery/README.md) | Writes down that a parcel was seen somewhere. |
| [Track shipment](core-track-shipment.md) | [delivery](../delivery/README.md) | What the customer sees when they paste a tracking code. |
| [Plan shipment on payment captured](core-plan-shipment-on-payment-captured.md) | [delivery](../delivery/README.md) | Nothing leaves the warehouse before the money has moved. |
| [Cancel order](oms-cancel-order.md) | [shop](../shop/README.md) | Reads one order by id. |
| [Get order](oms-get-order.md) | [shop](../shop/README.md) | Reads one order by id. |
| [Confirm order on payment authorized](oms-confirm-order-on-payment-authorized.md) | [shop](../shop/README.md) | Confirms the order once the payment for it is authorised (ADR oms.0005). The publisher is `payments.ledger`, and the name is the one it puts on the message: every service on this bus names its events after itself. |
| [Place order on basket checked out](oms-place-order-on-basket-checked-out.md) | [shop](../shop/README.md) | Places the order the basket was checked out for (ADR oms.0002). The order takes the basket's id, so the same checkout heard twice places one order. |
| [Archive price list](pricing-archive-price-list.md) | [shop](../shop/README.md) | Package archive_price_list takes a price list out of use without losing it. |
| [Get quote](pricing-get-quote.md) | [shop](../shop/README.md) | Package get_quote reads one quote. |
| [Import price list](pricing-import-price-list.md) | [shop](../shop/README.md) | Package import_price_list takes in a whole price list. |
| [Issue quote](pricing-issue-quote.md) | [shop](../shop/README.md) | Package issue_quote prices a basket and promises the price for a while. |
| [List price lists](pricing-list-price-lists.md) | [shop](../shop/README.md) | Package list_price_lists reads every price list there is. |
| [Expire quote on checkout](pricing-expire-quote-on-checkout.md) | [shop](../shop/README.md) | Ends the promise once the basket it priced is checked out. |
