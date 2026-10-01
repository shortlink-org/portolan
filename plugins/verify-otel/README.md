# verify-otel

OpenTelemetry traces against the catalog, answering which hops have been seen
running. A verifier, not an extractor: it runs after the merge, is handed the
catalog, and answers with a fragment that re-declares the flows it can prove
with `verified` on the steps a trace shows, plus the consumers and calls the
traces prove and the sequences nobody declared (portolan.0014).

What a trace can say is kept strict. A span is a message going one way; it
says the hop happened. It does not say a repository method was called, so
`call` steps stay declared; and it does not put a service in the catalog, so
a call whose far end is not there stays unresolved however often it ran.

## What it reads

The recordings matched by the `traces` globs under the input root: OTLP JSON,
one batch per file or one per line (`otlp.go`). Each span is flattened to its
ids, name, kind (server, client, producer, consumer, internal), the
resource's `service.name`, start and end, and string attributes. Spans are
rebuilt into trees by parent id and read root first (`verify.go`).

A resource's `service.name` is matched to the one catalog service whose slug
it is, or through `services`. A server span is somebody calling in, matched
to an operation by verb and `http.route` shape (`{id}` and `:id` alike) or
through `routes`; a client span is an rpc or an HTTP call named by the route
it hit; producer and consumer spans are events, matched by the event's
declared wire name, by the last segment of `event.name`, or through
`events`. A relayed publish is one hop.

## What it emits

A fragment (`observed.json` by default) holding:

- every declared flow a recording opened, with the steps it showed raised to
  `verified`, hops the code does not declare hung after the declared step
  they followed (as a frame when recordings part ways), and up to `examples`
  recordings kept as examples - the ones showing the most of the flow,
  earliest first;
- an observed flow per opening nobody declared, laid over across the
  recordings that opened alike;
- on the services that made them, the `consumes` edges the traces prove, and
  per event the consumers seen.

An example carries only a closed list of span attributes - methods, routes,
status codes, rpc and messaging names, `event.name`, server address - never
a query, a header, a URL with an id in it (`examples.go`).

Warnings name a glob matching no file, a service a resource names that the
catalog does not hold, and a call to nobody.

## Options

`traces` (required), `services`, `events`, `routes`, `examples` (five when
unset; zero keeps none), `out`. See `options.schema.json`.

## Manifest

```json
{
  "plugins": [{ "name": "otel", "wasm": { "url": "file://plugins/portolan-go.wasm" } }],
  "verify": [
    { "plugin": "otel", "in": "examples/auth", "out": "examples/auth/portolan",
      "options": { "traces": ["telemetry/traces.jsonl"], "routes": { "POST /api/v1/sessions": "login" }, "out": "observed.json" } }
  ]
}
```

The site's trace-recording upload runs the same step as a trial before the
recording is kept beside the code.

## Runtime

Go, part of `plugins/portolan-go.wasm` (`npm run plugins:build`), run under the
manifest name `otel` in the `verify` phase; or `go run ./plugins/cmd/portolan-go otel`.
It is handed the flows as declared, not as enriched (portolan.0031).

## Limits

- A `call` step is never verified by a trace.
- A span naming a service the catalog lacks is reported, not invented.
- An example whose recording is stamped before 2000-01-01 - one written by
  hand or by a test - carries a duration but no `recordedAt`.

## Tests

`go test ./plugins/verify-otel/...`: raising, overlaying, observed flows,
examples without anybody's data, JSON lines and single-value files.
