# portolan.0014 — A recording is kept beside the code, and lays what it showed over the flow

- **Status:** accepted
- **Date:** 2026-09-12
- **Scope:** portolan

## Context and Problem Statement

`verify-otel` read a recording of traces and said which declared hops had
been seen running. That was all it said. A hop the recording showed that
the code did not declare was dropped; two recordings of one endpoint that
differed in the middle - a happy path and a refusal - became two observed
flows with one name each; and nothing of what the spans carried reached
the page, so a reader who wanted to know what a real run of the flow looked
like had to open the recording.

The recording itself lived wherever somebody had put it and was named in
the manifest by hand. Adding one meant a file, a glob and a run, on a
machine with the repository checked out. The page, which is where a reader
holds the flow and the recording side by side, could not take one.

## Decision Drivers

- A recording is evidence, and evidence must survive regeneration: the
  catalog is rebuilt from files by anyone, on any machine (portolan.0010).
- What a recording showed and the code did not declare is a fact about the
  system, not noise; a reader should see it on the flow, marked as such.
- Two recordings of one flow are one flow, more fully known.
- The catalog is published. A span attribute is somebody's data until shown
  otherwise.
- The page may propose; only a reviewed run writes (the preview-then-write
  rule every local write already follows).

## Considered Options

1. **A recording is a file beside the project; the verifier lays it over the
   flow and keeps it as an example.** Uploaded from the page or copied by
   hand, it lands under `<project root>/telemetry/recordings/`, and the
   project's `otel` verify step reads that directory. The verifier counts,
   per declared step, the recordings that showed it; puts an rpc or an event
   the code does not declare into the flow after the declared step it
   followed, as a step whose id the code never gave and whose `seen` says
   why it is there; lays every observed recording that opens the same way
   over one observed flow; and keeps up to a handful of recordings as
   `examples` of the flow, each naming the steps it showed with the span's
   name, its length and an allowlist of attributes.
2. **A recording is held by the dev server**, in `.portolan/`, and the page
   shows it live. Nothing to commit, nothing to review - and nothing the
   next regeneration knows about. A flow verified once, on one machine.
3. **A recording is an example only.** Kept, shown, never laid over the
   flow. The reader sees a run and a flow that disagree and is left to
   reconcile them by eye.
4. **Carry every attribute.** The most useful example is the fullest one -
   and the fullest one carries `db.query.text` with an email in it into a
   published catalog. Once.

## Decision Outcome

Option 1.

The recording is a file in the repository because that is the only place
regeneration can find it. The page takes an upload, runs the generator over
a copy of the workspace with the file in place, and shows what changed -
which flows the recording showed, what it raised and added, which names the
verifier could not place - before anything is written. Keeping it writes
the file, widens or adds the project's verify step, records the mappings
the reader gave for unplaced names, and regenerates through the same
write run every other local change goes through.

What the verifier writes is accepted by the merge under the one rule it
already had for a second declaration of a flow, widened: the second may
raise a status, and it may add a step that carries `seen` and an id the
first does not have, a lane after the declared ones, and examples. It may
not move or remove anything declared. A store call is never added: a
`SELECT` ran, which is not the claim that `ByEmail` was called, and the
code's word on which repository method it was is the better one. A
consumer met inside a trace opens a flow of its own and belongs there.

An example carries a closed allowlist of attributes - routes, verbs, status
codes, operation and service names, destinations, the host a call went to.
The list is in `plugins/verify-otel/examples.go` with the argument for each
entry, and an attribute not on it is not carried, whatever it is called.
Query text, headers, full URLs and paths with ids in them are not on it and
are not going to be. A flow keeps five examples unless the step's options
say otherwise: the recordings that show the most of it, earliest first, so
that a day of traffic does not become the page.

### Consequences

- A declared flow can now carry steps no source file declares. They are
  marked - `seen` on the step, `seen<n>` as the id, a note saying in how
  many recordings - and the page says so next to them.
- `Step.seen` and `Flow.examples` are in the model, the Go mirror and the
  validator: an example must name steps the flow has, once each.
- An observed flow is keyed by how it opens, not by its whole shape. Two
  observed flows that used to differ only in the middle are one flow now,
  and their old ids are gone.
- A recording uploaded from the page is committed like any other source.
  The reviewer of that commit sees a `.jsonl` under `telemetry/recordings/`
  and a widened verify step; the data the fragment carries is bounded by
  the allowlist, but the recording itself is whatever the collector wrote,
  and is the reviewer's to read before it is pushed.
- The local API takes one upload, as bytes with the project and file name
  in headers, up to 32 MB. Everything else it takes is still JSON.
