# extract-flows

Flows written by hand in, a catalog fragment of `flows` out. One `.flow.md`
file is one journey: a design path, an incident reconstruction, an
integration scenario nobody's source extractor can state. The complete
grammar, with an executable example, is `docs/flows-authoring.md`; the
parser in `parse.go` is held to it.

## What it reads

`*.flow.md` directly under the input root, or the `files` globs. A file is a
head, a summary and two sections:

```
# Order accepted
owner: shop
source: services/oms/test/x_test.go     optional; the file itself when left out
slug: order-accepted                    optional; the file's name when left out
trigger: http high "POST /orders"       optional execution root

One or more paragraphs of summary.

## Participants
- oms-db: store in shop ref shop.oms.pg "orders database"

## Steps
shop.oms -> oms-db: insertOrder [verified] @order_repo.go:141 #a1
  > a note on the step above
shop.oms -> bus: event shop.oms.order.OrderPlaced
alt score below 40 #alt-risk
  ...
else
  stop
end
```

A hop is `from -> to: [call|rpc|event] label-or-ref`, `call` when no kind is
written, followed in any order by `as "label"`, `[declared|verified|unresolved]`,
`@file:line`, `via-store <id> <operation> [keyspace]` and `#id`. `alt`/`else`,
`par`/`and` and `loop` frames close with `end`; `stop` ends an alt branch.
Services are known by `context.service`; `bus` and `client` by name; every
other lane is declared under Participants in drawing order. Lines starting
with `//` are comments.

## What it emits

A fragment whose `contexts`, `defs` and `adrs` are empty and whose `flows`
hold one flow per file: `id`, `slug`, `name`, `owner`, `source` (the file,
spelled from its repository, unless the author named one), `trigger`
(kind, confidence, label), `summary`, `participants` and `steps` with their
frames, statuses, locations, store accesses and notes.

A file that does not parse fails the whole run, the way a compiler would,
with every mistake named by file and line; so does a slug declared twice. A
root matching no file is a warning.

## Options

`files`, `out` (`flows.json`). See `options.schema.json`.

## Manifest

```json
{
  "plugins": [{ "name": "flows", "wasm": { "url": "file://plugins/portolan-go.wasm" } }],
  "extract": [
    { "plugin": "flows", "in": "flows", "out": "portolan", "options": { "out": "flows.json" } }
  ]
}
```

## Runtime

Go, part of `plugins/portolan-go.wasm` (`npm run plugins:build`), run under the
manifest name `flows`; or `go run ./plugins/cmd/portolan-go flows`.

## Limits

- Nothing is resolved against the catalog here: a ref is carried as typed,
  and whether it names a real method or event is the merge's question.
- A route such as `POST /orders` is a label, never a ref.
- Generated step ids (`s1`, `s2`, …) change when lines are inserted; give
  important steps a `#id`.

## Tests

`go test ./plugins/extract-flows/...`. `testdata/golden.flow.md` is the
authoring guide's example and must parse.
