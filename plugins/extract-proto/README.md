# extract-proto

`.proto` files in, what a service provides from the modules it publishes and
what it calls from the copies it vendors, out. One aspect of a service and
nothing else: the aggregates come from another extractor and the two meet in
the merge. No clock, no socket, no environment; fetching a module from a
registry is `fetch-bsr`'s job.

## What it reads

`.proto` files under the `paths` directories (owned: what the service
publishes) and the `vendored` directories (client copies: what it calls),
each relative to the input root and walked in sorted order. The parser
(`parse.go`) is tolerant by design: a narrowed vendored copy routinely
imports a file that was not vendored beside it, so an unrecognised construct
is skipped to the end of its block and named in a note, never fatal. Only a
file that cannot be tokenised or ends mid-declaration is skipped whole, with
a warning. It reads the `syntax`/`edition` line, `package`, imports, options,
messages with nested types and `oneof`, enums, and services with their
streaming.

Where a directory came from: a `bsr.lock.json` beside it (written by
`fetch-bsr`) names the module and commit; failing that the `modules` option;
failing that the directory gets a `local:<dir>` id and a warning.
Protovalidate options become field rules in the catalog's vocabulary
(`rules.go`): `(buf.validate.field).string.min_len = 1` is `min_len`,
well-known string shapes are `format`, flags such as `unique` stand alone,
and rules on list items or map keys and values keep `items.`, `keys.` or
`values.` in front. A custom option is kept under its own name.

## What it emits

A fragment with one context and one service `<context>.<service>`:

- `provides`: one `RpcService` per rpc service in the owned files, id
  `<package>.<Service>`, with its `module`, and methods carrying `request`,
  `response` (and refs), `streaming`, `doc`, `deprecated`; `messages` and
  `enums` reached transitively from the methods.
- `consumes`: one `RpcCall` per method in the vendored files, id
  `<package>.<Service>/<Method>`, `peer` from `peers` or the raw package name
  (warned), status always `declared`, note = the copy's header comment.
- `copies`: the vendored descriptors themselves, retained for drift checks,
  and `modules` the service touches.
- top-level `modules` (`ProtoModule`: id, slug, name, registry, packages,
  files, commit, digest, deps; `owner` only for owned modules) and `defs`,
  the messages imported from another file promoted to shared types unless
  `defs: off`.

With `external`, the fragment holds that external and what it answers on,
and no service, module or defs (`external.go`). A message named like an
event stays an `RpcMessage`: the file knows the package, not the aggregate.

## Options

`context`, `service`, `paths`, `vendored`, `peers`, `modules`, `defs`
(`shared`|`off`), `external`, `externalName`, `externalSummary`,
`externalUrl`, `out` (`proto.json`). See `options.schema.json`.

## Manifest

```json
{
  "plugins": [{ "name": "proto", "wasm": { "url": "file://plugins/portolan-go.wasm" } }],
  "extract": [
    { "plugin": "proto", "in": "examples/shop/pricing", "out": "examples/shop/pricing/portolan",
      "options": { "context": "shop", "service": "pricing",
                   "paths": ["internal/infrastructure/transport/grpc/quote/proto"],
                   "modules": { "internal/infrastructure/transport/grpc/quote/proto": "buf.build/shortlink-org/portolan-shop-quote" },
                   "out": "proto.json" } },
    { "plugin": "proto", "in": "examples/auth", "out": "examples/auth/portolan",
      "options": { "external": "risk", "externalName": "Risk", "paths": ["internal/session/infrastructure/risk/proto"], "out": "risk.json" } }
  ]
}
```

## Runtime

Go, part of `plugins/portolan-go.wasm` (`npm run plugins:build`), run under the
manifest name `proto`; or `go run ./plugins/cmd/portolan-go proto`.

## Limits

- No call is ever `verified`; a `.proto` proves a call was written down.
- A vendored package with no `peers` line is listed against the package name
  and its steps stay unresolved.
- A `paths` entry that does not exist is a warning; a lock naming several
  modules uses the first.

## Tests

`go test ./plugins/extract-proto/...`, with `testdata/golden` (a golden
fragment), `testdata/estate`, and `awkward.proto` for the tolerant parser.
