# portolan.0028 — A followed flow opens as a document of its own

- **Status:** accepted
- **Date:** 2026-09-16
- **Scope:** portolan
- **Supersedes:** portolan.0026

## Context and Problem Statement

A flow stops where its service stops. The step that calls the next one names
the flow that answers it (portolan.0025), and the reader wants to see that
answer without losing the flow they are reading.

Three shapes were tried for that, in order. A link, which left the page.
Unfolding the other flow's steps into this one's rail (portolan.0024), which
read well and drew badly: the rail said five services, the canvas drew one.
Then pictures for the path — the whole path generated for every flow that
continues (portolan.0026), and, when only part of it was open, a view composed
and laid out in the browser (portolan.0027).

The last one is where it ended. A picture has to be laid out before it is
drawn, LikeC4 lays out at generation time, and the generator is a language
service over the whole workspace. Asking for a view per door meant a second
language service inside the release build; that build ran out of a four
gigabyte heap and the release broke. The two commits were reverted.

What all three share is the assumption that the path is one drawing. It is
not: the reader opened a door to see another flow, and that flow has a picture
already — laid out, generated, on its own page.

## Decision Drivers

- A picture is laid out before it is drawn. Anything assembled while reading
  therefore has no picture of its own, and buying one costs a generated view
  per shape a reader might assemble.
- The flow being followed is a flow. Whatever is right for it on its own page
  is right for it here.
- Following is not one step deep. A call lands in a flow that calls further,
  and the reader wants both on screen without either replacing the other.
- The address should carry what is open, so a path can be sent.

## Considered Options

1. **Open the followed flow as another document beside this one**, with its
   own rail and its own canvas, drawn by the view it already has.
2. **Keep composing pictures** and pay for the layout — pre-generate more
   shapes, or run a layouter in the browser. The first is what portolan.0026
   and portolan.0027 did and what broke the build; the second is a second
   layout engine in the product.
3. **Leave the rail unfolding as portolan.0024 had it** and accept that the
   canvas shows one service while the rail shows five.

## Decision Outcome

Chosen option: **1.**

`flow/panes.ts` holds the whole of it. A door is named as the rail and the
address already name it, `<step id>><flow slug>`, and a door inside a document
is named from that document: `s2>auth-validate-session/t4>ledger-authorize`.
So the key says the chain, closing a document closes what was read through it,
and `?open=` carries the keys in the order they were opened. A key naming a
flow this catalog does not have is dropped rather than refused, so a link from
an older estate opens what it still can.

The page the reader came to is the first document, with its rail as it was.
The ones they open stack in the column beside it: the second opens the column,
the third goes under it, and so on, each a `FlowPane` with a header that folds
its steps open, fits its picture, opens the flow on its own page, or closes
the document. Their rails come folded — a document opened to see where a call
lands is looked at before it is read, and a list of steps under every window
would leave no room for the pictures that are the point of opening them.

The rail's doors no longer unfold anything. They say `open` and `close`, and
the toolbar counts documents rather than steps of an assembled path.

#### Consequences

Nothing is composed and nothing is generated. There is no view per path and
none per door, so the build has no second language service in it, the bundle
grows by nothing, and the class of problems that took the release down is
gone with the code that made it.

What portolan.0024 decided stands, and more plainly than before: a path across
services is a reading, and the catalog holds flows. What it decided about the
*shape* of that reading does not — the path is not unfolded into one rail.
portolan.0026 is superseded: the whole-path views it generated are what the
documents replace, and they are removed. portolan.0027 was reverted before
this was written.

Several documents means several canvases on one screen, each with a LikeC4
view in it. That is the cost, and it is the reader's to spend: nothing is open
until they open it, and closing a document closes what was read through it.
