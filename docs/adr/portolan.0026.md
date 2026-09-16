# portolan.0026 — The whole path is drawn; a partly opened one is not

*Generated from the portolan catalog. Do not edit by hand.*

- **Status:** accepted
- **Date:** 2026-09-16
- **Scope:** [portolan](../portolan/README.md)
- **Source:** [`adr/0026-the-whole-path-is-drawn-a-partly-opened-one-is-not.md`](https://github.com/shortlink-org/portolan/blob/main/adr/0026-the-whole-path-is-drawn-a-partly-opened-one-is-not.md)
- **Committed:** Victor Login, 2026-09-16 (`388a085`)

### Context and Problem Statement

portolan.0024 put the path on the rail and left the canvas alone, and said so
in its consequences: "the canvas and the rail now disagree about how much is on
screen". A reader who opened three services deep read the sequence in the list
and looked at a picture of one service.

The reason given was that a flow's picture is a LikeC4 dynamic view generated
and laid out at build time, and a path is opened at read time, one door at a
time — there is nothing to generate a view *for*. That is true of a path the
reader is part-way through. It is not true of the whole path: "follow
everything" is one answer, `openEverything` computes it from the catalog, and
the same answer is available to the generator.

### Decision Drivers

- The rail and the picture are two readings of one thing; they should not
  disagree about what the thing is.
- A view has to be laid out before it is drawn, so only a shape decided
  beforehand can have one. Every subset of doors a reader might open is not
  that; the full path is.
- Two thousand views is a slow build and a big bundle. The cost has to be
  proportional to what it buys.
- A picture that is not of what the reader opened is worse than no picture, so
  a partly opened path must keep the flow's own view rather than pretend.

### Considered Options

1. **Generate one more view per flow that continues somewhere: the whole
   path.** The canvas switches to it when, and only when, the reader has the
   whole path open.
2. **Render the sequence ourselves** — mermaid, or our own SVG — so any
   partial opening can be drawn. Two sequence renderers in one product, and
   the second one would have to learn everything LikeC4's already does.
3. **Leave it as portolan.0024 had it.**

### Decision Outcome

Chosen option: **1.**

`fullJourney` composes a flow with every continuation the guards allow
followed, deterministically; `gen-likec4` draws it as
`flow_<slug>_journey`, titled "— the whole path", for each flow that
continues somewhere. In the example estate that is 28 views over 72 flows; in
a five-service avia estate, 45 over 343. The page uses it when `?open=*` is on
and the flow has a path, and keeps the flow's own view for a partly opened one
— the picture is then honestly of the flow, and the rail is where the rest of
the path is.

Composing for a picture made two things visible that the rail had been getting
away with, and both are now fixed in the composition itself, so the rail and
the picture say the same:

- **The answered call is one hop, not two.** A flow that answers a call opens
  with that call seen from the other side. Following it drew the call again —
  on the canvas as a second arrow out of nowhere. The opening step of a flow
  entered through a contract continuation is dropped; an event's send and
  receive are two hops and are both kept.
- **The callee's caller is whoever is calling.** A flow read on its own names
  its caller `client`, because from where it was read that is who calls.
  Inside a path the caller is the service one hop up, so that lane is renamed
  to it — otherwise the picture puts a browser where a service stands, and
  `auth.auth -> client` reads as an answer to the end user.

##### Consequences

The reader who follows everything gets a sequence diagram of the whole path,
laid out by the same generator as every other picture, with the lanes of every
service on it. `?open=*` is what the address already carried, so the link that
shares the path shares the picture.

What portolan.0024 decided still stands: nothing is composed into the catalog,
and a path is a reading. A generated view is a rendering of that reading, not a
fact about the estate — which is why the journey view carries no ids of its own
and is rebuilt from the catalog on every generation.

A partly opened path still has no picture of itself. That is the one case where
rail and canvas differ, and the difference is now the exception rather than the
rule.
