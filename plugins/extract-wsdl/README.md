# extract-wsdl

WSDL contracts and their local XSD graph in, structured SOAP interfaces in
the catalog out. The reading is `internal/wsdl`, which is also what the HTTP
client extractor joins SOAP calls against; this package turns one result into
a fragment.

## What it reads

With `spec`: one WSDL 1.1 document relative to the input root and every
local WSDL/XSD import or include it reaches. Without it, every `*.wsdl` in
the tree (skipping dot directories and `node_modules`); a document that only
declares port types and is imported by another completes its parent and is
not emitted twice. Nothing is fetched: a remote import is returned as a
warning, never followed.

A contract is one WSDL service, or one standalone port type when the
document declares no service. Each port bound to a SOAP binding is kept as
its own interface, so distinct endpoints and SOAP versions survive. An
operation joins the abstract port-type operation to its binding: action,
documentation, request and response messages, faults and headers. Messages
and the XSD complex types reachable from them become fields with a compact
type.

## What it emits

In `service` mode (the default), one context and one service
`<context>.<service>` whose `provides` has one `RpcService` per interface,
id derived from the WSDL service name plus `.soap` (or `api` for a single
contract), with methods carrying `request`, `response` and `soap {action,
version, style, endpoint, binding, faults, headers}`, and `messages` with
their fields. `source` is the document, spelled from its repository.

In `external` mode, or whenever `external` is set, the same interfaces land
on `externals`: one external per contract (id derived from the contract,
overridden per api by `externals`, or one id for all by `external`), named
by the contract or `externalName`, with the first endpoint as its URL when
`externalUrl` is not given.

A tree with no service or port type is a warning.

## Options

`context`, `service`, `spec`, `api`, `mode` (`service`|`external`),
`external`, `externals`, `externalName`, `externalSummary`, `externalUrl`,
`out` (`wsdl.json`). See `options.schema.json`.

## Manifest

```json
{
  "plugins": [{ "name": "wsdl", "wasm": { "url": "file://plugins/portolan-go.wasm" } }],
  "extract": [
    { "plugin": "wsdl", "in": "services/gateway", "out": "services/gateway/portolan",
      "options": { "context": "booking", "service": "gateway", "spec": "contracts/booking.wsdl", "api": "booking.soap" } },
    { "plugin": "wsdl", "in": "services/gateway", "out": "services/gateway/portolan",
      "options": { "mode": "external", "spec": "vendor/provider.wsdl", "external": "booking-provider", "out": "provider.json" } }
  ]
}
```

## Runtime

Go, part of `plugins/portolan-go.wasm` (`npm run plugins:build`), run under the
manifest name `wsdl`; or `go run ./plugins/cmd/portolan-go wsdl`.

## Limits

- WSDL 1.1 only, with SOAP bindings; a remote import is a warning.
- An external id must be a bare name with no dot; `mode` must be `service`
  or `external`.
- A duplicate name within a namespace is reported with where the kept one
  came from.

## Tests

`go test ./plugins/extract-wsdl/...` and `go test ./internal/wsdl/...`.
