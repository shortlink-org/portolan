# portolan.0031 — A verifier is handed the flows as declared, not as enriched

*Generated from the portolan catalog. Do not edit by hand.*

- **Status:** accepted
- **Date:** 2026-09-18
- **Scope:** [portolan](../portolan/README.md)
- **Source:** [`adr/0031-a-verifier-is-handed-the-flows-as-declared-not-as-enriched.md`](https://github.com/shortlink-org/portolan/blob/main/adr/0031-a-verifier-is-handed-the-flows-as-declared-not-as-enriched.md)
- **Committed:** Victor Login, 2026-09-18 (`e83eafc`)

### Context and Problem Statement

A verifier reads evidence against the catalog and writes back a fragment. For
`verify-otel` that fragment is the flow a recording opened, with the steps the
recording showed raised and counted and the hops the code does not declare laid
in (portolan.0014). The merge lays that flow over the declaration step for step
and refuses it when the two disagree about anything but what a recording can
vouch for.

The generator handed verifiers the catalog after enrichment. Enrichment writes
into flows: the opening step of an endpoint flow gains the method it answers
(portolan.0025), the exits of a synchronous handler gain synthesized response
steps, a callee a step continues into is composed in. The verifier copied the
flow it was handed, so its overlay carried all of it, and the merge found an
opening with a ref the code never gave and steps with ids the code never gave
that carried no `seen`. It refused the overlay. On the example estate that was
twelve flows of `auth` and `cart` - every recording of them thrown away, the
`seen` counts, the raised statuses and the examples with it - reported as
twelve `merge-conflict` errors.

### Decision Drivers

- An overlay says what the evidence saw. What the enrichment derived is said
  again at every read; written into a source it would be said twice, and a
  derived fact frozen into a fragment goes stale when the rule deriving it
  changes.
- The merge's rule for a second declaration of a flow is narrow on purpose:
  it may raise, count and add what a recording witnessed, and nothing else.
- Every verifier should be fixed at once, not each taught which enrichments
  to strip.
- A verifier still needs the enriched estate to name what it saw: a call is
  known by the id the flows imply, an event by the consumers the flows imply.

### Considered Options

1. **Hand verifiers the enriched estate with the flows as declared.**
   `loadCatalog` returns `verifierCatalog` - the enriched catalog whose `flows`
   are the merged sources' - and the verify phase passes that.
2. **Hand verifiers the catalog before enrichment.** The flows come out
   right, and the calls and consumers the flows imply are gone from the
   estate a recording is matched against.
3. **Strip enrichment in `verify-otel`.** A synthesized response has a shape
   one could recognise; a derived ref has none, and `oms` writes the same ref
   itself. The next enrichment that writes into a flow would break it again.
4. **Let the merge tolerate it.** Accept an incoming ref where the code has
   none on an opening from an actor lane, and skip unseen steps with new ids.
   The merge would then accept a flow that says something the code does not,
   which is the one thing its rule exists to refuse.

### Decision Outcome

Option 1. The verify phase of `gen.mjs` and the site's reading of the
work-items verifier both take `verifierCatalog`, so a verifier sees one
catalog wherever it runs.

`verify-otel` also counts an opening that names its method as the call in:
an endpoint flow's first step is keyed by the route or operation it answers
whether or not it carries the ref. It used to be keyed by the ref when it had
one, which no recording ever matches - `oms`'s openings, whose extractor
writes the ref, were never counted as seen.

#### Consequences

- The twelve flows keep what their recordings showed: on the example estate
  `merge-conflict` goes from 12 to none, and `flow-observed-coverage-low`
  from 66 to 60.
- `observed.json` says only what the recordings saw on top of what the code
  declared; the ref of an opening and the responses are derived at read time
  as for every other flow.
- A verifier that links evidence to steps (work-items) no longer sees the
  steps composed into a flow from its callee, only the callee's own flow,
  which is where those steps' source lines belong.
