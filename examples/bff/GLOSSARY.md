# Glossary — storefront.bff

One vocabulary at the edge, the same in the schema, the ports and the pages.
Where a peer says it differently the adapter translates, and the peer's word
stops there (bff.0003).

**Adapter.** The one file that knows both a port and a peer's generated
client, and turns each into the other. Nothing else in the service knows a
peer exists.

**Basket.** What the customer is filling, as the cart holds it. The cart
calls its lines `items`; the storefront calls them lines, and neither is
wrong.

**Checkout.** Freezing a basket at the price it was frozen at. Not an order:
the order service places one when it hears the basket was checked out, and a
checkout that answered with an order id would be promising something that has
not happened.

**Line.** One SKU in a basket or an order, how many of it, and the unit price
it was added at.

**Money.** An amount in the smallest unit of a currency, and the currency.
Spelled once here, whichever of the three spellings the peers used.

**Order.** What a basket became. Read from the order service and never
written here.

**Order move.** One change of an order's state, as it happened. What a
subscription yields, and what the bus carried.

**Order state.** Placed, confirmed or cancelled — the three the order service
publishes, and no fourth invented for a screen.

**Peer.** Another service in the estate: auth, the cart, the order service,
delivery. The storefront talks to four and belongs to none.

**Port.** What a resolver may reach: an interface in `src/ports`, filled at
assembly. A resolver holds ports the way a use case elsewhere holds them.

**Shipment.** The parcel on its way, as delivery has it. Its state is
delivery's own word, passed on unchanged.

**Storefront.** The context this service belongs to: what a shopper sees, and
nothing that decides anything.

**Viewer.** Who the request belongs to. A live session, resolved by auth on
every call; nobody, for somebody browsing.
