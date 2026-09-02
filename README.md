# portolan

A browser for an event-driven system's architecture catalog. It reads one JSON
file describing bounded contexts, services, aggregates, events, flows, ADRs and
the stores they are kept in, and renders it as a navigable site: entity pages,
C4 and dependency diagrams, ER canvases, and step-by-step flow walkthroughs.

Everything is static — no backend, no runtime queries. The catalog is the input,
the site is the output.

`data/catalog.json` is the single source of truth. On startup the app validates
it and builds lookup indexes; if validation fails the shell renders the error
instead of a blank page. At build time the LikeC4 model is generated from the
same JSON — a C4 view per context and service, plus a dynamic view per flow.
The app never draws these diagrams itself.

A store belongs to exactly one service and holds tables, and a table says which
aggregate it persists and which domain field each column carries. That is what
lets the schema be read next to the model rather than beside it — and what lets
the Problems page name a foreign key that crosses a service boundary, a database
with a second writer, or a column whose type has drifted from its field's.

A store also holds views. A view is kept apart from a table rather than folded
in behind a flag: it has no key, no constraints and no rows of its own, and what
it has instead is what it reads. Any column — of a view, of a projection, of an
outbox — may name the columns it is computed from in `from`, and that is the
lineage the canvas draws: dashed, source on the left, arrow pointing the way the
data travels, next to the solid crow's feet of the keys. Hovering a column lights
the whole chain rather than the next hop, because the question is where a value
originally came from. Lineage that leaves the store is a warning on the Problems
page: copying is how a service stays out of someone else's database, but nothing
on the far side records that the copy exists.

Facts carry a status (`verified` / `declared` / `unresolved`), so a reference
that resolves reads differently from one nothing in the catalog answers. Flows
carry no such mark about where they came from: every one of them is read out of
source the same way, and a field with one possible value is not a fact. What a
flow does say is the file it was read out of, and which context owns it.
