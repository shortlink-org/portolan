# Glossary — Shop

*Generated from the portolan catalog · commit `7 sources` · at 2026-09-05T03:14:52+07:00. Do not edit by hand.*

- **Context:** [Shop](README.md)
- **Terms:** 11
- **Read from:** `examples/shop/oms/GLOSSARY.md`

One meaning per word inside this context, as the glossary beside the code states it.

## Terms

- **Basket** — The cart's aggregate. An order carries its basket's id and is placed from it exactly once.
- **Bus** — NATS JetStream when configured, in process otherwise. One stream per service, named for its subjects.
- **Cancelled** — The order will not be fulfilled. Terminal.
- **Confirmed** — The payment is authorised; the order may be fulfilled.
- **Line** — One SKU of the order, how many, and the unit price it was added to the basket at. Copied, never repriced.
- **Money** — An amount in the minor unit of a currency.
- **Order** — What a basket became at checkout: the lines and the total the customer agreed to, under one lock. The aggregate root.
- **Outbox** — The table an event waits in, written in the transaction that produced it, until the relay puts it on the bus.
- **Payments** — The ledger that authorises an order's total. A port here; nothing provides it yet.
- **Placed** — The order exists and is waiting for its payment to be authorised. Where every order starts.
- **Relay** — The loop that moves outbox rows to the bus and marks them published.
