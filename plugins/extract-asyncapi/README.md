# extract-asyncapi

An AsyncAPI document in, the channels a service publishes on and listens to
out. The document is read as a YAML node tree, so the author's order survives
and keys the reader does not model are ignored rather than failed on.

## What it reads

One document: `spec`, relative to the input root, or - left out - the first
`asyncapi.yaml`/`asyncapi.yml` found walking the tree, with a warning when
there are several. Versions 2.x and 3.x are both read (`spec.go`):

- 3.x: `channels` declare an `address` (the key when absent) and messages;
  `operations` say which way each travels through `action: send|receive`. An
  operation naming no message carries every message of its channel.
- 2.x: the channel key is the address, and the two operations are written
  from the client's side: `subscribe` is what the application sends,
  `publish` is what it receives.

The protocol comes off the `servers` a channel names, or every server when it
names none; servers that disagree give no protocol. Only local `$ref`s are
followed.

## What it emits

A fragment with one context and one service `<context>.<service>` (no name;
another extractor says what the service is called) whose `channels` carry
`address`, `protocol`, `title`, `doc`, `source` (the document, spelled from
its repository) and `messages`: `name` (the message's `name`, else its key),
`title`, `doc` (summary, else description), `direction`, `contentType` (the
message's, else `defaultContentType`) and `encoding` (`msgpack` when the
content type says so).

Warnings name an operation with no action, one naming a channel or message
the document does not declare, a channel with no operation or no message, and
a document declaring no channels.

## Options

`context` and `service` (default to the input directory's name), `spec`,
`out` (`bus.json`). See `options.schema.json`.

## Manifest

```json
{
  "plugins": [{ "name": "asyncapi", "wasm": { "url": "file://plugins/portolan-go.wasm" } }],
  "extract": [
    { "plugin": "asyncapi", "in": "examples/shop/cart", "out": "examples/shop/cart/portolan",
      "options": { "context": "shop", "service": "cart", "spec": "src/infrastructure/transport/bus/asyncapi.yaml", "out": "bus.json" } }
  ]
}
```

## Runtime

Go, part of `plugins/portolan-go.wasm` (`npm run plugins:build`), run under the
manifest name `asyncapi`; or `go run ./plugins/cmd/portolan-go asyncapi`.

## Limits

- A `$ref` into another file is not followed; the message is reported as not
  in this document.
- Message payload schemas are not read into fields; the channel carries the
  message's name and prose.
- With several documents in a tree and no `spec`, the first by path is read.

## Tests

`go test ./plugins/extract-asyncapi/...`, with a 2.x and a 3.x document under
`testdata/`.
