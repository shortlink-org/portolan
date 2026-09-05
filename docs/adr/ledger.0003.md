# ledger.0003 — The card network is Stripe, and stays outside the estate

*Generated from the portolan catalog · commit `7 sources` · at 2026-09-05T03:58:04Z. Do not edit by hand.*

- **Status:** accepted
- **Date:** 2026-09-06
- **Scope:** [payments.ledger](../payments/ledger/README.md)
- **Source:** `examples/payments/ledger/docs/adr/0003-the-card-network-is-stripe-and-stays-outside-the-estate.md`

### Context and Problem Statement

The ledger holds, captures, voids and refunds money through a card network.
The first cut called it `psp` and vendored nothing: the far end was a third
party, no service of ours answered on it, and the catalog recorded every call
as **unresolved** — which was true, and unhelpful. Four arrows on every
picture pointed into open water, the Problems page listed them beside real
defects, and a reader could not tell from the catalog which operation any of
them was.

The network is Stripe. Stripe publishes an OpenAPI document. How much of it
does the estate take, and where does Stripe sit in the catalog?

### Decision Drivers

- The catalog must not claim to own what it does not: Stripe is nobody's
  service here, has no context, no aggregates and no repository to read.
- A call should land on the operation that answers it, so the page can say
  what is sent and what comes back, and the arrow can be `declared` rather
  than a warning.
- Stripe's document is six megabytes and hundreds of operations; the ledger
  calls four. What is vendored has to be reviewable.
- Stripe's own naming — title "Stripe API", version "2026-08-26.dahlia" —
  must not become the estate's ids.

### Considered Options

1. **Stripe as a context of the estate**, with a service `stripe.api` produced
   by the OpenAPI extractor over the vendored copy. Everything existing works,
   and the estate gains a service card for a system it will never build.
2. **Stripe as an external with a contract.** A new kind at the root of the
   catalog beside the contexts, holding only what it answers on, read from the
   copy vendored beside the adapter. The caller's extractor is told the copy's
   api id belongs to it under `externals`, the lane is `external`, and the
   calls are `declared`.
3. **Leave it unresolved** and describe Stripe in prose.

### Decision Outcome

Option 2. Stripe is `stripe` in `catalog.externals`, provides `stripe.v1`, and
the ledger's four calls land on `PostPaymentIntents`,
`PostPaymentIntentsIntentCapture`, `PostPaymentIntentsIntentCancel` and
`PostRefunds`.

The copy is **narrow**: those four operations and the schemas they answer
with, every field verbatim, and nothing else. It sits at
`infrastructure/stripe/openapi/openapi.yaml`, is regenerated from Stripe's
repository when the version moves, and the narrowing is the only edit — the
same rule org.0001 sets for a proto vendored from a peer.

The copy carries one line Stripe's does not: `x-portolan-api: stripe.v1` in
`info`. A vendored copy is already the consumer's translation boundary, so it
is the one place the estate's name for the document may be written, and both
readers of it — the extractor that says what Stripe answers on and the one
that says what the ledger calls — take the id from there rather than from two
manifests that would have to agree.

#### Consequences

- Good: the four arrows are `declared` and named; the Problems page is about
  problems again; the Stripe page lists the shapes on either side of each call.
- Good: the estate's picture still draws Stripe as outside, muted, with no
  context around it — which is what it is.
- Bad: the copy is a fifth place Stripe's version is written down, and moving
  it is a deliberate commit. That is the cost of reviewability, and it is the
  same cost the protos already pay.
- Bad: an operation the adapter starts calling and the copy does not carry is
  reported by the extractor and left out until the copy is widened. Also the
  point.

## Relates to

- **Services:** [shop.oms](../shop/oms/README.md)
