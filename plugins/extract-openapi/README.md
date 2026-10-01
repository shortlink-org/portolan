# extract-openapi

An OpenAPI document in, the HTTP interface a service provides out - or, for a
copy vendored from outside the estate, what a third party answers on. The
document is read as a YAML node tree so the author's order survives; ids are
spelled by `plugins/openapi`, the package the client-side readers share, so a
call and the method it lands on meet.

## What it reads

With `spec`: that one document (YAML or JSON), relative to the input root.
Without it, `discover.go` walks the tree for `openapi.yaml`/`.yml`,
`swagger.yaml`/`.yml`, `openapi.json`, `swagger.json` - one per directory,
YAML preferred - skipping `.git`, `vendor`, `node_modules`, `target`,
`build`, `dist`, `testdata` and `.claude`, and reads what sits beside each in
its directory and the one above:

- a server generated from it (`ServerInterface interface`,
  `func RegisterHandlers(`, `swag.Register(`, `SwaggerInfo` in Go; a source
  file named `server`, `handler`, `controller`, `router` or `routes`
  otherwise) means this service implements it;
- a client generated from it (`ClientInterface interface`,
  `ClientWithResponses`; a file named `client`) means this service calls it,
  and the document names a system outside the estate unless `peers` says the
  api is one of ours;
- neither is reported and left alone.

Swagger 2 (`definitions`, body parameters) and OpenAPI 3.x (3.1 type arrays,
`nullable`) are read; relative `$ref`s into other files are loaded.

## What it emits

One `RpcService` per document, id = `api` (the document's `x-portolan-api`,
else `<title>.v<major>`); tags organise operations and do not split the
contract. Each method: `name` (operationId, else `VERB /path`), `request`,
`response`, `http {method, path}`. `messages` are the schemas reached
transitively, with fields typed as `string (uuid)`, `[]T`, `map[string]T`,
`A | B`, `A & B`, `enum(a | b)`, `| null`; `required`; `rules` in the catalog's
vocabulary (`const`, `min_len`, `max_len`, `pattern`, `gte`, `lte`, `gt`,
`lt`, `multiple_of`, `min_items`, `max_items`, `unique`, `min_pairs`,
`max_pairs`, and `items.*`); and a `discriminator` with its variants.

Without `external`, the fragment holds one service `<context>.<service>` with
`provides`, plus `externals` for called documents in discover mode. With
`external`, it holds that external alone - `id`, `name`, `summary`, `url`,
`provides` - and no service.

Missing operationIds are warned once per contract, five routes shown.

## Options

`context`, `service`, `spec`, `peers`, `externals`, `api`, `external`,
`externalName`, `externalSummary`, `externalUrl`, `out` (`api.json`). See
`options.schema.json`.

## Manifest

```json
{
  "plugins": [{ "name": "openapi", "wasm": { "url": "file://plugins/portolan-go.wasm" } }],
  "extract": [
    { "plugin": "openapi", "in": "examples/auth", "out": "examples/auth/portolan",
      "options": { "context": "auth", "service": "auth", "spec": "internal/transport/http/gen/openapi.yaml", "out": "api.json" } },
    { "plugin": "openapi", "in": "examples/payments/ledger", "out": "examples/payments/ledger/portolan",
      "options": { "external": "stripe", "externalName": "Stripe", "externalUrl": "https://docs.stripe.com/api",
                   "spec": "src/main/java/org/portolan/payments/ledger/infrastructure/stripe/openapi/openapi.yaml", "out": "stripe.json" } }
  ]
}
```

## Runtime

Go, part of `plugins/portolan-go.wasm` (`npm run plugins:build`), run under the
manifest name `openapi`; or `go run ./plugins/cmd/portolan-go openapi`.

## Limits

- An external id must be a bare name with no dot.
- A called document with no title cannot name its system and is skipped
  until `externals` names it.
- With several documents and no `spec`, discovery decides by what sits
  beside each; a document with nothing beside it is a warning.

## Tests

`go test ./plugins/extract-openapi/...`, with `testdata/openapi.yaml`,
`testdata/swagger2` and a `testdata/discover` tree.
