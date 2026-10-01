# extract-http-clients

Outbound HTTP and SOAP calls in Go, joined to the routes, handlers,
factories and providers that reach them, out as consumer edges, externals
and source-backed flows. The analysis is `internal/gohttp`; this package
turns its result into a fragment. It is the one built-in Go extractor that
is not a wasm module (portolan.0009).

## What it reads

The Go tree under the input root. Syntax first, always: raw `net/http`
requests, resty requests, calls through an `oapi-codegen` client (joined to
the OpenAPI document beside it, so the call is the document's operation),
and SOAP `Call`/`CallContext` sites with their `SOAPAction` or SOAP 1.2
content type (joined to WSDL bindings). URL-shaped configuration is followed
through constructors, client fields and functional options to the request;
conditions guarding a call are carried as notes.

Inbound roots are read too: registered HTTP routes, callback handlers
(including Swagger `@Router` annotations), `main → Run/Start/Bootstrap`
startup paths, and `AddFunc`/`AfterFunc`/`Schedule` registrations. When a
provider branch still ends before its transport, the module is loaded with
`go/packages`, SSA is built and `x/tools` VTA resolves calls through
interface parameters, function values and interface-typed fields - only after
a concrete factory branch is selected. A type error, a missing private
dependency or a timeout keeps the syntax result with a warning.

## What it emits

A fragment with one context and one service `<context>.<service>`:

- `consumes`: one entry per call identity - the contract operation for a
  generated client, the observed operation under an adapter, else the raw
  method, path and host - with `peer`, `status` (`declared`, or `unresolved`
  when nothing names the far end), `source`, `note`, `destination` (call
  site, base URL source, joins) and `evidence`.
- `externals`: the systems hand-written adapters and vendored contracts reach,
  given the operations seen going out (`<id>.http` with `POST /v1/book`,
  `<id>.soap` with the action's last segment).
- `flows`: endpoint flows (`flow.<svc>.endpoint.<slug>`, trigger `http`,
  provider branches as an `alt`), root flows (`flow.<svc>.root.<slug>`,
  trigger `http`, `callback`, `startup` or `scheduled`), and standalone
  groups per function (`flow.<svc>.http-client.<fn>`, trigger `unproven`,
  low confidence, whose summary says whether callers exist).

## Options

`context`, `service`, `peers`, `externals`, `adapters`, `clients`, `out`
(`http-clients.json`). See `options.schema.json` for what each maps.

## Manifest

```json
{
  "plugins": [{ "name": "http-clients", "process": { "command": "go", "args": ["run", "-mod=mod", "./plugins/cmd/portolan-http-clients"] } }],
  "extract": [
    { "plugin": "http-clients", "in": "services/billing", "out": "services/billing/portolan",
      "options": { "context": "avia", "service": "billing", "peers": { "auth.v1": "auth.auth" },
                   "adapters": { "internal/pkg/connector/websky": { "external": "websky", "name": "Websky" } } } }
  ]
}
```

## Runtime

A process plugin: `go run ./plugins/cmd/portolan-http-clients` needs the Go
toolchain because `go/packages` loads the project's build tags and
dependencies. It runs with the project as its working directory; module
loading is read-only and bounded.

## Limits

- A raw call whose peer and contract cannot be proved stays `unresolved`
  with its method, path and line, rather than being assigned to a guess.
- Two constructor-wired implementations of one interface are not chosen
  between.
- A tree with no outbound call is a warning.

## Tests

`go test ./plugins/extract-http-clients/...` (fixtures inline) and
`go test ./internal/gohttp/...`.
