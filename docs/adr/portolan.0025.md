# portolan.0025 — An endpoint flow names the method it answers, and that is what pairs a call with its handler

*Generated from the portolan catalog. Do not edit by hand.*

- **Status:** accepted
- **Date:** 2026-09-16
- **Scope:** [portolan](../portolan/README.md)
- **Source:** [`adr/0025-an-endpoint-flow-names-the-method-it-answers-and-that-is-what-pairs-a-call-with-its-handler.md`](https://github.com/shortlink-org/portolan/blob/main/adr/0025-an-endpoint-flow-names-the-method-it-answers-and-that-is-what-pairs-a-call-with-its-handler.md)
- **Committed:** Victor Login, 2026-09-16 (`81c172f`)

### Context and Problem Statement

portolan.0024 made a path across services readable: a step that calls the next
service opens that service's flow under it. It worked on the example estate and
barely anywhere else.

The pairing was `continuesAt`/`reaches` — the identity of the source function a
step reaches, which one extractor knows because it read both the call site and
the handler in one repository. Between two services read separately there is no
such identity, and nothing else connected them: a caller's step says which
method it calls (`cart.v1/addItem`), and the flow on the other side said
nothing about which method it was. The handler's extractor knew the route and
the handler; the contract was the other extractor's business.

Measured on a real estate of five avia services: 343 flows, 316 outbound rpc
steps, of which 70 land on a service of the estate and 246 on systems outside
it. Three steps had a continuation. In the example estate, `cart-checkout`
had two, both from events; its calls to `auth` and `pricing` had none.

### Decision Drivers

- The two halves of the pairing live in two extractors' readings. Neither can
  state it; the merged catalog can.
- A wrong pairing is worse than no pairing: it would put another service's
  steps under a call that never makes it.
- The difference between "answers this call" and "makes the same call" is the
  direction, and the catalog already records it — an endpoint flow's opening
  step comes in from an actor lane and lands on the service that serves it.
- Eight extractors would each have to be taught the same thing, in five
  languages, and a ninth would forget.

### Considered Options

1. **Name the served method in `enrich`, pair on it in `continues`.** The
   opening step of an endpoint flow gains the `ref` of the interface method it
   answers; a call's step pairs with the flow whose opening step serves that
   method on that service.
2. **Each extractor writes it.** Every extractor knows its own operationId —
   and `extract-openapi`, which reads the contract, is not the one that reads
   the handler, so several of them would have to guess at the interface id.
3. **Pair on the trigger label, with no ref.** "POST /v1/baskets/{id}/items"
   against a call's route, at read time, every time, for every pair of flows.
4. **Compose the flows into one at enrich.** The machinery is there:
   `composeExecutionContinuations` already splices a flow into another when
   `continuesAt` matches an `entrypoint`.

### Decision Outcome

Chosen option: **1.**

`nameServedMethods` runs in the enrichment pipeline, before anything composes
or summarises. For a flow whose first step comes in from an actor lane and
carries no `ref` of its own, it finds the method of the service that step lands
on: by the name the trigger and the step already carry — an operationId, an
rpc, `GraphQL · Query.basket` — and failing that by the route the trigger
spells, matched against the provider's path the way a call is matched. Two
methods answering to one name is silence, not a guess. A flow with no trigger
is left alone: a recording of an endpoint running is an example of it, not a
second way in, and pairing a caller with a trace would make the recording look
like the handler.

`continues.ts` gains the rule that pairing rests on: a step of kind `rpc`
naming method `R` on service `S` continues in a flow whose opening step is `R`
being served on `S`. Confidence is high — both halves are the contract's word —
and the direction is what keeps two callers of one method from continuing each
other, which they never do.

##### Consequences

The path now crosses services that were read separately, which is every estate
made of more than one repository. On the example, `cart-checkout` goes from two
doors to four — `validateSession` into `auth` and `GetQuote` into `pricing`
join the two events — and 17 calls in total find their handler. On the avia
estate the three become 47: `aviacore`'s `POST /search` alone opens fourteen,
into `aviasupp`'s search, book and get-booking and back into `aviaadmin`. What
stays unpaired there is what should: 246 calls to avianotifier, mailota,
Amadeus and websky, which are outside the estate and end where the estate does.

A ref on an endpoint flow's opening step is a fact the rest of the app can read
too, and one reader already did: the command chain pairs a caller with the
server entry when exactly one flow serves the method, which now happens by
design rather than by luck.

Option 2 spreads one rule across five languages. Option 3 does the same
matching on every render instead of once, and leaves nothing on the step for
anything else to read. Option 4 is what portolan.0024 decided against, and at
this scale it would also make every endpoint flow swallow its callees': the
reader asked for a door, not for a hundred-step flow by default.
