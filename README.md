# portolan

A browser for an event-driven system's architecture catalog. It reads one JSON
file describing bounded contexts, services, aggregates, events, flows and ADRs,
and renders it as a navigable site: entity pages, C4 and dependency diagrams,
and step-by-step flow walkthroughs.

Everything is static — no backend, no runtime queries. The catalog is the input,
the site is the output.

`data/catalog.json` is the single source of truth. On startup the app validates
it and builds lookup indexes; if validation fails the shell renders the error
instead of a blank page. At build time the LikeC4 model is generated from the
same JSON — a C4 view per context and service, plus a dynamic view per flow.
The app never draws these diagrams itself.

Facts carry a status (`verified` / `declared` / `unresolved`) and a provenance
(`authored` / `derived-from-test` / `derived-from-otel`), so a flow reconstructed
from an integration test reads differently from one someone wrote down.
