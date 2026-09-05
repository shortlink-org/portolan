# ledger.0001 — A gateway that did not answer has not refused

- **Status:** accepted
- **Date:** 2026-09-05
- **Scope:** payments.ledger

## Context and Problem Statement

What does the ledger write down when the card network cannot be reached?

The first answer was nothing in particular: the HTTP client turned every
failure - a timeout, a refused connection, a 502 - into an empty string, and
the use case read an empty string as "the gateway refused the card". A
network outage produced a `PaymentDeclined` on the bus and a DECLINED row in
the record the business is audited on. The order service heard a refusal and
cancelled; the customer was told their card was declined. Nothing of the
sort had happened.

## Decision Drivers

- The record must say what happened, and an outage is not a decision about a
  card.
- A consumer switching on a decline reason must be able to trust that a
  reason was given by somebody.
- The difference between "no" and "no answer" must be a type, not a string
  the next reader has to know to check.

## Considered Options

1. **Record a decline** — the outage becomes a refusal; simplest to code, and
   what the code did.
2. **Record nothing and answer UNAVAILABLE** — the gateway port throws when it
   gets no answer; no row, no event; the caller retries.
3. **Record a PENDING row and reconcile later** — the attempt is written
   before the gateway is asked and a sweep resolves it.

## Decision Outcome

Chosen option: **record nothing and answer UNAVAILABLE**.

| | audit record | caller | code |
|---|---|---|---|
| record a decline | false | told the card failed | one line |
| record nothing | true, by omission | told to try again | a sentinel and a sealed answer |
| pending and reconcile | true, later | told to wait | a sweep and a state |

The port answers with a closed set - held with its code, or refused with a
reason - and throws `GatewayUnavailable` for everything else. The use case
lets that pass through untouched: no save, no event, and the transport says
UNAVAILABLE with a sentence that nothing was recorded. What is given up is
an audit trail of attempts that never reached the network; that is the
cheaper loss, because a false decline is worse than a missing attempt, and
option 3 is the way to get the trail back if it is ever wanted.

### Consequences

- Good: a `PaymentDeclined` on the bus was said by the network, every time.
- Good: the refusal and the silence are different types, so a use case
  cannot confuse them without the compiler noticing.
- Bad: a hold the network made and a save that then failed is a hold the
  ledger does not know about. The window is the same as before this
  decision; an outbox and a reconciliation are the fix, and are not in this
  sketch.
- Neutral: the PSP's own words for a refusal never reach the domain; the
  reason is this service's closed set.
