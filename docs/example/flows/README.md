# Flows

*Generated from the portolan catalog. Do not edit by hand.*

| Flow | Owner | Summary |
| --- | --- | --- |
| [Change password](auth-change-password.md) | [auth](../auth/README.md) | Replaces the password of a user, given the current one. Source-backed cross-protocol continuations are included. |
| [Get user](auth-get-user.md) | [auth](../auth/README.md) | Reads a user by id. Source-backed cross-protocol continuations are included. |
| [Login](auth-login.md) | [auth](../auth/README.md) | Turns credentials into a session. Source-backed cross-protocol continuations are included. |
| [Logout](auth-logout.md) | [auth](../auth/README.md) | Ends the session behind a token. Source-backed cross-protocol continuations are included. |
| [Register user](auth-register-user.md) | [auth](../auth/README.md) | Creates a user from an email address and a password. Source-backed cross-protocol continuations are included. |
| [Revoke sessions on password change](auth-revoke-sessions-on-password-change.md) | [auth](../auth/README.md) | Ends the sessions issued against a password that has just been replaced. |
| [Validate session](auth-validate-session.md) | [auth](../auth/README.md) | Resolves a token to a live session: who is calling, and how long the answer stays good. Source-backed cross-protocol continuations are included. |
| [Mutation add item](bff-mutation-add-item.md) | [storefront](../storefront/README.md) | Add a line. The price travels as the customer was shown it; the cart captures it and never recomputes it, and nothing here checks it - a storefront that priced things would be a second place prices live. |
| [Mutation cancel order](bff-mutation-cancel-order.md) | [storefront](../storefront/README.md) | Cancel an order. Whether it is too late to is the order service's judgement and its refusal travels back unchanged; this service does not know what dispatch means. |
| [Mutation checkout](bff-mutation-checkout.md) | [storefront](../storefront/README.md) | Freeze the basket and hand it on. |
| [Mutation remove item](bff-mutation-remove-item.md) | [storefront](../storefront/README.md) | Remove a line outright. |
| [Query basket](bff-query-basket.md) | [storefront](../storefront/README.md) | The basket as the cart has it, in the storefront's words. |
| [Query order](bff-query-order.md) | [storefront](../storefront/README.md) | The order, or null when the storefront has never been told of one. |
| [Query shipment](bff-query-shipment.md) | [storefront](../storefront/README.md) | Where the parcel is, or null when nothing has been handed to a carrier yet. |
| [Query viewer](bff-query-viewer.md) | [storefront](../storefront/README.md) | Who the request belongs to. Auth is asked on every call rather than a token being read here: this service holds no key and could not tell a forged one from a live one. |
| [Subscription order status](bff-subscription-order-status.md) | [storefront](../storefront/README.md) | Every move of one order, for as long as somebody is watching it. |
| [Remind unpaid invoice work](billing-celery-body-invoices-tasks-remind-unpaid-invoice.md) | [shop](../shop/README.md) | Nudges the customer about an invoice that has stayed unpaid. Observable work performed by the Celery task. |
| [Send invoice email work](billing-celery-body-invoices-tasks-send-invoice-email.md) | [shop](../shop/README.md) | Emails the customer the invoice they were asked to pay. Observable work performed by the Celery task. |
| [Remind Unpaid Invoice task](billing-celery-remind-unpaid-invoice.md) | [shop](../shop/README.md) | Celery task `invoices.tasks.remind_unpaid_invoice` is enqueued on `billing` and worked by `remind_unpaid_invoice`. Source-backed cross-protocol continuations are included. |
| [Send Invoice Email task](billing-celery-send-invoice-email.md) | [shop](../shop/README.md) | Celery task `invoices.tasks.send_invoice_email` is enqueued on `billing.mail` and worked by `send_invoice_email`. Source-backed cross-protocol continuations are included. |
| [Close invoice on payment](billing-close-invoice-on-payment.md) | [shop](../shop/README.md) | Closes the invoice for an order once the ledger says the money arrived. |
| [Invoice create](billing-invoice-create.md) | [shop](../shop/README.md) | Draws up a draft invoice for an order, with a line for each thing sold. Source-backed cross-protocol continuations are included. |
| [Invoice destroy](billing-invoice-destroy.md) | [shop](../shop/README.md) | Ends an invoice nobody is going to pay. Source-backed cross-protocol continuations are included. |
| [Invoice issue](billing-invoice-issue.md) | [shop](../shop/README.md) | Confirms the session, freezes the invoice and asks the customer to pay. Source-backed cross-protocol continuations are included. |
| [Invoice list](billing-invoice-list.md) | [shop](../shop/README.md) | Invoices over HTTP. Every action here runs one function of services.py. Source-backed cross-protocol continuations are included. |
| [Invoice partial update](billing-invoice-partial-update.md) | [shop](../shop/README.md) | Invoices over HTTP. Every action here runs one function of services.py. Source-backed cross-protocol continuations are included. |
| [Invoice retrieve](billing-invoice-retrieve.md) | [shop](../shop/README.md) | Reads one invoice and the lines it is made of. Source-backed cross-protocol continuations are included. |
| [Invoice update](billing-invoice-update.md) | [shop](../shop/README.md) | Invoices over HTTP. Every action here runs one function of services.py. Source-backed cross-protocol continuations are included. |
| [Add item](cart-add-item.md) | [shop](../shop/README.md) | Source-backed cross-protocol continuations are included. |
| [Checkout](cart-checkout.md) | [shop](../shop/README.md) | Source-backed cross-protocol continuations are included. |
| [Create basket](cart-create-basket.md) | [shop](../shop/README.md) | Source-backed cross-protocol continuations are included. |
| [Expire idle baskets](cart-expire-idle-baskets.md) | [shop](../shop/README.md) | Abandons every open basket nobody touched for a day, and says so for each. |
| [Get basket](cart-get-basket.md) | [shop](../shop/README.md) | Source-backed cross-protocol continuations are included. |
| [Merge baskets](cart-merge-baskets.md) | [shop](../shop/README.md) | Source-backed cross-protocol continuations are included. |
| [Remove item](cart-remove-item.md) | [shop](../shop/README.md) | Source-backed cross-protocol continuations are included. |
| [Close route](core-close-route.md) | [delivery](../delivery/README.md) | Ends the day, whatever is left undone. |
| [Dispatch](core-dispatch.md) | [delivery](../delivery/README.md) | One shipment, for whoever is asking about an order. |
| [Get route](core-get-route.md) | [delivery](../delivery/README.md) | One route, as the depot reads it. |
| [Get shipment](core-get-shipment.md) | [delivery](../delivery/README.md) | One shipment, for whoever is asking about an order. |
| [Plan route](core-plan-route.md) | [delivery](../delivery/README.md) | Builds a van's day out of the shipments waiting to go out. |
| [Record delivery](core-record-delivery.md) | [delivery](../delivery/README.md) | Ends a shipment at the door. |
| [Record scan](core-record-scan.md) | [delivery](../delivery/README.md) | Writes down that a parcel was seen somewhere. |
| [Release shipment on payment captured](core-release-shipment-on-payment-captured.md) | [delivery](../delivery/README.md) | Nothing leaves the warehouse before the money has moved (ADR core.0002). |
| [Start route](core-start-route.md) | [delivery](../delivery/README.md) | The van is out. |
| [Track shipment](core-track-shipment.md) | [delivery](../delivery/README.md) | What the customer sees when they paste a tracking code. |
| [Authorize](ledger-authorize.md) | [payments](../payments/README.md) | Asks the gateway to hold the money for an order, and records either that it agreed or that it refused. |
| [Capture](ledger-capture.md) | [payments](../payments/README.md) | Moves the money the gateway was holding, writes the pair of postings for it, and says so on the bus. |
| [Get payment](ledger-get-payment.md) | [payments](../payments/README.md) | Reads one payment, for whoever is asking what happened to the money. |
| [Issue refund](ledger-issue-refund.md) | [payments](../payments/README.md) | Sends money back against a captured payment, in full or in part. |
| [List refunds](ledger-list-refunds.md) | [payments](../payments/README.md) | Every refund against one payment, newest first. |
| [Void payment on order cancelled](ledger-void-payment-on-order-cancelled.md) | [payments](../payments/README.md) | Gives back what was held once the order it was held for is gone. |
| [Observed: CancelOrder](observed-oms-cancelorder.md) | [shop](../shop/README.md) | Read from 1 trace in telemetry/traces.jsonl. No flow in the catalog opens this way, so the sequence is written down as it was seen. |
| [Observed: GetOrder](observed-oms-getorder.md) | [shop](../shop/README.md) | Read from 2 traces in telemetry/traces.jsonl. No flow in the catalog opens this way, so the sequence is written down as it was seen. |
| [Cancel order](oms-cancel-order.md) | [shop](../shop/README.md) | Reads one order by id. |
| [Get order](oms-get-order.md) | [shop](../shop/README.md) | Reads one order by id. |
| [Place order on basket checked out](oms-place-order-on-basket-checked-out.md) | [shop](../shop/README.md) | Places the order the basket was checked out for (ADR oms.0002). The order takes the basket's id, so the same checkout heard twice places one order. |
| [Archive price list](pricing-archive-price-list.md) | [shop](../shop/README.md) | Package archive_price_list takes a price list out of use without losing it. |
| [Expire quote on checkout](pricing-expire-quote-on-checkout.md) | [shop](../shop/README.md) | Ends the promise once the basket it priced is checked out. |
| [Get quote](pricing-get-quote.md) | [shop](../shop/README.md) | Package get_quote reads one quote. |
| [Import price list](pricing-import-price-list.md) | [shop](../shop/README.md) | Package import_price_list takes in a whole price list. |
| [Issue quote](pricing-issue-quote.md) | [shop](../shop/README.md) | Package issue_quote prices a basket and promises the price for a while. |
| [List price lists](pricing-list-price-lists.md) | [shop](../shop/README.md) | Package list_price_lists reads every price list there is. |
| [oms-cdc · public.order_lines · CDC](oms-cdc-public-order-lines-shop-oms-public-order-lines-shop-oms-public-order-lines-envelope.md) | [shop](../shop/README.md) | Debezium captures public.order_lines and relays it to Kafka from the connector configuration. |
| [oms-cdc · public.orders · CDC](oms-cdc-public-orders-shop-oms-public-orders-shop-oms-public-orders-envelope.md) | [shop](../shop/README.md) | Debezium captures public.orders and relays it to Kafka from the connector configuration. |
