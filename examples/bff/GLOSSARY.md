# Glossary — storefront.bff

One vocabulary at the edge, the same in the schema, the ports and the pages.
Where a peer says it differently, the adapter translates and the peer's word
stops there (bff.0003).

| Term | Meaning |
| --- | --- |
| Storefront | The context this service belongs to: what a shopper sees, and nothing that decides anything. |
| Viewer | Who the request belongs to. A live session, resolved by auth on every call; null for somebody browsing. |
| Basket | What the customer is filling, as the cart holds it. Called `items` there and `lines` here. |
| Line | One SKU in a basket or an order, how many, and the unit price it was added at. |
| Money | An amount in the smallest unit of its currency, and the currency. Spelled once, whichever peer it came from. |
| Checkout | Freezing a basket and the quote it was frozen at. It is not an order: the order service places one when it hears the basket was checked out. |
| Order | What a basket became. Read from the order service; never written here. |
| Order state | Placed, confirmed or cancelled - the three the order service publishes. |
| Order move | One change of an order's state, as it happened. What a subscription yields. |
| Shipment | The parcel on its way, as delivery has it. Its state is delivery's word, passed on unchanged. |
| Port | What a resolver may reach: an interface in `src/ports`, filled at assembly. |
| Adapter | The one file that knows both a port and a peer's generated client, and translates between them. |
| Peer | Another service in the estate: auth, cart, oms, delivery. |
