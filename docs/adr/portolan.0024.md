# portolan.0024 — A path across services is composed in the reading, not in the catalog

*Generated from the portolan catalog. Do not edit by hand.*

- **Status:** accepted
- **Date:** 2026-09-16
- **Scope:** [portolan](../portolan/README.md)
- **Source:** [`adr/0024-a-path-across-services-is-composed-in-the-reading-not-in-the-catalog.md`](https://github.com/shortlink-org/portolan/blob/main/adr/0024-a-path-across-services-is-composed-in-the-reading-not-in-the-catalog.md)

### Context and Problem Statement

A flow stops where its service stops. `cart-checkout` ends by publishing
`BasketCheckedOut`; what happens next is `oms`'s flow, and after that
`ledger`'s. The catalog has known where one ends and the next begins since
continuations were added — a step's `continuesAt`, its `reaches`, a handoff's
transport and channel, a shared event — and the rail said so with a link:
*continues in Place order on basket checked out*. The reader clicked it, and
the thread they were following stayed on the page behind them.

That is the common question and the expensive one. In the example estate a
checkout crosses four services; in a real one read into portolan — five avia
services, 343 flows — half of the 316 outbound calls have a flow on the other
side, and the other half end at a system outside the estate, correctly.
Answering "and then what?" three times in a row meant three pages, three
canvases and nothing that held them together.

### Decision Drivers

- The catalog is what the sources say. A path that crosses four services is
  not a fact any one of them states: it is an inference made by pairing a
  step with a flow, and the pairing already carries its own confidence.
- A composed flow written into a fragment would be a fifth service's claim
  about four other services' code, regenerated whenever any of them changed.
- A reading is worth sharing. Whatever the reader opened has to survive being
  pasted into a chat.
- 343 flows in one estate, median two steps: opening everything for everybody
  would make the common page worse to pay for the rare one.
- Following forever is not following: a service that calls back into its
  caller is a cycle, and four services deep the reader is asking a different
  question from the one they opened.

### Considered Options

1. **Compose in the reading.** `flow/journey.ts` takes the rail's rows and,
   under a step the reader opened, splices the rows of the flow it continues
   in — indented, marked with whose they are, and keyed by the door they came
   through. What is open lives in the address. Closed by default.
2. **Compose at generation, into the catalog.** The model already has the
   shape for it: `Flow.includes` and `Flow.composition` record fragments
   spliced into a root flow with the seam that proved each one. Composing
   across services would make one flow out of four services' code.
3. **A page of its own: the journey as an entity.** A third kind of page
   beside flows and services, listing end-to-end paths.
4. **Leave the link.** What was there.

### Decision Outcome

Chosen option: **1.**

A journey is a reading of the catalog, built where it is read. `journey.ts`
is pure: rows in, rows out, with two guards that say so on the row rather
than stopping quietly — a flow already on the path reads *already on this
path*, and the fourth flow deep reads *as deep as this goes*. Every row of a
followed flow carries which flow and which service it came from, and its key
is spelled from the door it came through, so two flows that both call their
first step `s1` stay apart.

The rail's continuation link becomes a door: **follow** opens the other
flow's steps under the step that calls it, **hide** closes them, and the link
to that flow's own page stays beside it. The toolbar says what the whole path
would cost before it is opened (`follow 2`) and what it added once it is
(`+99 steps · 4 services`). What is open is in the address — `?open=` with
the keys, or `?open=*` for "follow all", since the list of a deep estate is a
kilobyte of URL and what the reader asked for was one thing. Nothing is open
until the reader opens it.

Selecting a followed step selects it in the flow it belongs to, so the panel
that opens is that flow's; the canvas keeps drawing the flow the page is
about, because its picture is a generated LikeC4 view of that flow and the
path is a reading rather than a view. The Mermaid copy takes the opened path:
`journeyFlow` composes the same rows into one `Flow` object, participants
joined, and the existing sequence writer draws it — so what is copied is what
is on the rail.

##### Consequences

The question "and then what?" is answered without leaving the page, and the
answer can be sent to somebody as a link.

Option 2 was rejected because it puts an inference in the catalog, where it
would be regenerated on every change to any service on the path and where a
reader could no longer tell what one service's code says from what the pairing
guessed. The `composition` fields stay what they are: an extractor's record of
fragments it spliced into a root flow *within one service*, with the seam that
proved each one.

Option 3 was rejected because a journey has no identity of its own. It starts
at a flow, and which flow the reader started from is the whole of what makes
one path rather than another.

The canvas and the rail now disagree about how much is on screen. That is the
honest state of it — the picture is a generated view of one flow — and the
door rows are where the difference is visible rather than hidden.
