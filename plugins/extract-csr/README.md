# extract-csr

Schemas vendored out of a Confluent Schema Registry in, the topics they are
registered against and the shapes they declare out. The fetching is
`fetch-csr`'s job (a host plugin, `scripts/host-plugins/fetch-csr.mjs`); this
plugin reads what that step wrote and opens no socket.

## What it reads

Every `csr.lock.json` under the `paths` directories (the whole root when none
are named). A lock names exactly one subject - its version, schema id,
`schemaType`, `compatibility`, optional `history` of earlier versions, and the
files holding each - and the schema file beside it is read by type:

- `AVRO` (the default): the top record's full name and every named record
  inside it, as shapes with fields rendered as short type labels. No
  resolution, validation or compatibility checking.
- `JSON`: a JSON Schema, read the same way.
- `PROTOBUF`: the topic is read, the shape is not; a warning points at
  `extract-proto` for the fields.

A subject name says nothing about the strategy that produced it, so
`strategy` is told: `topic` reads `<topic>-value` and `<topic>-key`, `record`
reads the whole subject as the record's name and yields no topic,
`topic-record` reads `<topic>-<record full name>`.

## What it emits

A fragment with one context and one service `<context>.<service>` whose
`channels` are the topics (protocol `kafka`, address = topic, sorted). Each
message carries `name` (the record's full name), `doc` ("Registered as
`<subject>` version N."), `direction` from `direction` or the per-subject
`subjects` map, and `schema`: registry, subject, version, id, type,
compatibility, and `versions` as compact field snapshots when the lock held
history. A `-key` subject keeps its shape and is not put on the channel.
Named records land in `defs`; a field referring to a shape nobody vendored
keeps its label and loses its `ref`, with one warning listing them.

## Options

`context`, `service`, `paths`, `strategy`, `direction` (`send`), `subjects`,
`out` (`schemas.json`). See `options.schema.json`.

## Manifest

```json
{
  "plugins": [{ "name": "csr-schemas", "wasm": { "url": "file://plugins/portolan-go.wasm" } }],
  "extract": [
    { "plugin": "csr-schemas", "in": "services/oms", "out": "services/oms/portolan",
      "options": { "context": "shop", "service": "oms", "paths": ["vendor/schemas"],
                   "strategy": "topic", "subjects": { "shop.oms.order-value": "send", "payments.ledger.payment-value": "receive" } } }
  ]
}
```

## Runtime

Go, part of `plugins/portolan-go.wasm` (`npm run plugins:build`), run under the
manifest name `csr-schemas`; or `go run ./plugins/cmd/portolan-go csr-schemas`.

## Limits

- A registry records no producer and no consumer, so direction is told, not
  read.
- A lock naming no file is a warning; one naming more than one subject, or
  a named `paths` entry that does not exist, fails the run.
- Protobuf schemas contribute a topic only.

## Tests

`go test ./plugins/extract-csr/...`, with fixtures `testdata/estate` and
`testdata/dangling`.
