# Glossary — shop.oms

One vocabulary for the order, the same in the code, the events and the pages.

| Term | Meaning |
| --- | --- |
| Order | What a basket became at checkout: the lines and the total the customer agreed to, under one lock. The aggregate root. |
| Line | One SKU of the order, how many, and the unit price it was added to the basket at. Copied, never repriced. |
| Money | An amount in the minor unit of a currency. |
| Placed | The order exists and is waiting for its payment to be authorised. Where every order starts. |
| Confirmed | The payment is authorised; the order may be fulfilled. |
| Cancelled | The order will not be fulfilled. Terminal. |
| Basket | The cart's aggregate. An order carries its basket's id and is placed from it exactly once. |
| Outbox | The table an event waits in, written in the transaction that produced it, until the relay puts it on the bus. |
| Relay | The loop that moves outbox rows to the bus and marks them published. |
| Bus | NATS JetStream when configured, in process otherwise. One stream per service, named for its subjects. |
| Payments | The ledger that authorises an order's total. A port here; nothing provides it yet. |
