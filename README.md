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

Facts carry a status (`verified` / `declared` / `unresolved`) and a provenance
(`authored` / `derived-from-test` / `derived-from-otel`), so a flow reconstructed
from an integration test reads differently from one someone wrote down.
