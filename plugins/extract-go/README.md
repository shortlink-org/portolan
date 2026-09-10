# Go domain and execution-flow extraction

The syntax extractor reads aggregates, events and use cases in the supported
DDD layouts. It also discovers registered HTTP execution roots without requiring
an aggregate, a `UseCase.Handle` method, an `internal` directory or a `scope`.

For conventional services, supported registrations include `net/http.HandleFunc`,
`ServeMux.HandleFunc`, and `ServeMux.Handle` with a `http.HandlerFunc` conversion.
The handler can be a function or a same-package method on an explicitly typed
parameter, receiver or local composite literal. Router verb registrations use
recognized router imports/types; the existing `http` package convention remains
available for syntax-only legacy fixtures. Concrete service methods and their
repository calls are followed by the existing flow walker. An unregistered
method does not become an HTTP root just because it resembles a handler.

`scope` still limits ownership to `internal/<scope>` in a shared module. Imported
local application methods can be followed across that boundary. Nested modules,
vendor, node_modules and testdata are excluded from package discovery. When a
DDD flow already covers the same handler, its richer domain flow is retained.

Assembly must not select the first of several use cases. Competing providers,
multiple adapter targets and unreadable multi-use-case providers leave the call
`unresolved`, with an `ambiguous-binding` warning and the candidate use cases.
A per-method adapter binding is retained only when all candidate providers agree.

This extractor remains syntax-only and runs in WASI. The shared native typed
analysis API lives in `internal/gocall`; its first consumer is the HTTP client
sidecar. Adopting that API in additional extractors is a separate migration,
without imposing a Go toolchain on this syntax path.

Go-domain, HTTP analysis and Go SQL readers now share `internal/goscan` for
source selection, imports, constants and package lookup. Each invocation reuses
its parsed AST across passes. Generated declarations remain available for
contract lookup but are marked separately. The index respects GOOS/GOARCH,
build constraints and nested module boundaries; it is not a cache shared across
plugin processes. Native type analysis still uses the Go package loader.

Flow steps carry structured `evidence`: source expressions, enclosing functions,
provider signatures and unresolved candidates. Provider signatures are marked as
inference, and static paths do not claim that a call ran. The detail panel also
explains older fragments from their recorded source and contract references.

For a service with plain SQL migrations, combine `go-domain` and `sql` with the
same context, service and store. SQL discovers `migrations`/`migration` directories
outside `internal` too. Without a matching domain root or an explicit
`-- aggregate: <id>` annotation, tables and views remain independent of aggregates;
their schema, foreign keys and SQL accesses are retained.
