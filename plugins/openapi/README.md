# openapi

A shared Go package, not a plugin: what two sides of an OpenAPI document
agree on. The server side reads a document to say what a service provides;
the client side reads the copy vendored beside a generated client to say
what a service calls. Both have to spell `auth.v1/login` the same way, or
the call would never resolve to the method, and one place is how they do.

## What it reads

One document, through `Read(path)`: its `info` (title, version,
`x-portolan-api`, description) and `externalDocs.url`, and every operation
under `paths` in verb order (`get`, `put`, `post`, `delete`, `options`,
`head`, `patch`, `trace`).

## What it emits

Go values, used by `plugins/extract-openapi`, `plugins/extract-go`
(`httpclient.go`) and `internal/gohttp`:

- `APIID(title, version)` - `auth` 1.0.0 is `auth.v1`;
  `DocumentAPIID(declared, title, version)` prefers the document's own
  `x-portolan-api`, the one place a vendored copy may carry the estate's
  name for a third party.
- `ExternalID(title)` - the system a document names when nothing else does:
  "Stripe API" is `stripe`, a trailing "API" dropped.
- `InterfaceID(api, tag)` - the contract's id; tags organise operations and
  do not create interfaces.
- `Operation` (`ID` = operationId or `VERB /path`, `Tag`, `Verb`, `Path`),
  `CallID` (`<interface>/<operationId>`), and `Spec.Find(verb, path)`, which
  compares path parameters by position so `{userId}` and `%s` match.
- `Title(name)` - `price_list` as `PriceList`.

## Options

None; it is a library.

## Manifest

Nothing in a manifest names it. The plugins that import it are declared as
themselves (`openapi`, `go-domain`, `http-clients`).

## Runtime

Go, compiled into whichever plugin imports it, including the wasm module.

## Limits

- Only `info`, `externalDocs` and the operations are read; schemas and
  parameters are the extractors' own concern.
- A YAML document only; the JSON spelling is read by `extract-openapi`.

## Tests

`go test ./plugins/openapi/...`.
