# Glossary — Payments

*Generated from the portolan catalog · commit `6 sources` · at 2026-09-05T03:58:04Z. Do not edit by hand.*

- **Context:** [Payments](README.md)
- **Terms:** 12
- **Read from:** `examples/payments/ledger/GLOSSARY.md`

One meaning per word inside this context, as the glossary beside the code states it.

## Terms

- **Attempt** — Which try at charging one order a payment is. A declined hold is followed by a second, legitimate attempt on the same order, and each is its own payment; the pair of order and attempt is unique (payments.0004).
- **Capture** — Moving money the gateway was holding. Writes the pair of postings that accounts for it and says `PaymentCaptured`; the only thing anything waiting to be paid listens for.
- **Decline** — The money was not held. Its reason is a closed set: the card was refused, or the order was already cancelled. Not what the gateway said in its own words.
- **Gateway** — The card network, as this service asks it: hold, capture, void, refund. A third party behind a port; its own words for those four things stay in the adapter. When it does not answer, nothing is decided and nothing is written.
- **Hold** — The gateway has reserved the money against an instrument and given back a code that names the reservation. The code is the gateway's handle on the money and never leaves this service: not on an event, not on the wire.
- **Journal** — The postings, in the order they were written. Append-only; nothing in it is ever updated, and a correction is another pair.
- **Money** — An amount in the minor unit of a currency. The ledger never rounds.
- **Order** — What the payment is for. Another context owns it, so it is an id here and nothing more. Asked once, before a hold: a cancelled order is not charged.
- **Payment** — What one order owes on one attempt, and everything that has happened to that money. The aggregate root; its status moves only the way its lifecycle table allows.
- **Posting** — One side of one movement of money. Comes in balanced pairs.
- **Refund** — Money going back against a payment that was captured. Its own aggregate: asked for by somebody else, at another time, for a reason of its own, and there may be several per payment, never adding up to more than was captured.
- **Void** — Giving back a hold nobody is going to be charged for. Happens when the order is cancelled; touches nothing that was captured.
